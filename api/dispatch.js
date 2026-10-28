// Dispatch queue API — Supabase Postgres backend (migrated from GitHub file backend).
// Tables: tasks (id PK, status, data jsonb), messages (id PK, data jsonb),
//         notices (key PK, data jsonb), heartbeats (worker PK, data jsonb).
// Internal path mapping (kept so route logic is untouched):
//   queue/tasks/<status>/<taskId>.json -> tasks row (status column is authoritative)
//   queue/messages/<messageId>.json     -> messages row
//   queue/notices/<key>.json            -> notices row
//   queue/heartbeats/<worker>.json      -> heartbeats row
//
// Same API contract as before — workers need no changes.
// Legacy GitHub implementation is preserved below in a comment block for rollback.

/*
 * LEGACY GitHub file backend — kept for rollback only (not executed).
 * To roll back: delete the Supabase block below and uncomment this block
 * (renaming *_legacy back), then set GITHUB_QUEUE_TOKEN again.
 *
const GH_API_LEGACY = 'https://api.github.com';
const GH_OWNER_LEGACY = 'Iswardahal142';
const GH_REPO_LEGACY = 'dispatch-queue';
const GH_BRANCH_LEGACY = 'main';

function ghToken_legacy() {
  const t = process.env.GITHUB_QUEUE_TOKEN;
  if (!t) throw new Error('GITHUB_QUEUE_TOKEN env var missing');
  return t;
}

async function ghFetch_legacy(path, method, body) {
  const res = await fetch(GH_API_LEGACY + path, {
    method: method || 'GET',
    headers: {
      'Authorization': 'Bearer ' + ghToken_legacy(),
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'dispatch-queue',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-json * / }
  return { status: res.status, data };
}

// Read a file from the repo. Returns {exists, sha, content (parsed json or null)}.
async function ghReadFile_legacy(repoPath) {
  const { status, data } = await ghFetch_legacy(
    `/repos/${GH_OWNER_LEGACY}/${GH_REPO_LEGACY}/contents/${repoPath}?ref=${GH_BRANCH_LEGACY}`
  );
  if (status === 404) return { exists: false };
  if (status !== 200) throw new Error(`GitHub read failed ${status}: ${repoPath}`);
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  let parsed = null;
  try { parsed = JSON.parse(content); } catch (e) { parsed = null; }
  return { exists: true, sha: data.sha, content: parsed, raw: content };
}

// Write (create or update) a file. Retries on SHA conflict (409).
async function ghWriteFile_legacy(repoPath, obj, message, maxRetries) {
  maxRetries = maxRetries || 3;
  const content = Buffer.from(JSON.stringify(obj, null, 2)).toString('base64');
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const existing = await ghReadFile_legacy(repoPath);
    const body = {
      message: message || `queue: update ${repoPath}`,
      content,
      branch: GH_BRANCH_LEGACY,
    };
    if (existing.exists) body.sha = existing.sha;
    const { status, data } = await ghFetch_legacy(
      `/repos/${GH_OWNER_LEGACY}/${GH_REPO_LEGACY}/contents/${repoPath}`,
      'PUT',
      body
    );
    if (status === 200 || status === 201) return { ok: true, sha: data.content.sha };
    if ((status === 409 || status === 422) && attempt < maxRetries - 1) continue; // conflict, retry
    throw new Error(`GitHub write failed ${status}: ${repoPath}`);
  }
  throw new Error(`GitHub write conflict retries exhausted: ${repoPath}`);
}

// Delete a file. Returns true if deleted, false if already gone.
async function ghDeleteFile_legacy(repoPath, message) {
  const existing = await ghReadFile_legacy(repoPath);
  if (!existing.exists) return false;
  const { status } = await ghFetch_legacy(
    `/repos/${GH_OWNER_LEGACY}/${GH_REPO_LEGACY}/contents/${repoPath}`,
    'DELETE',
    { message: message || `queue: delete ${repoPath}`, sha: existing.sha, branch: GH_BRANCH_LEGACY }
  );
  if (status === 200) return true;
  if (status === 404 || status === 409 || status === 422) return false;
  throw new Error(`GitHub delete failed ${status}: ${repoPath}`);
}

// List files in a directory. Returns array of {name, path}.
async function ghListDir_legacy(dirPath) {
  const { status, data } = await ghFetch_legacy(
    `/repos/${GH_OWNER_LEGACY}/${GH_REPO_LEGACY}/contents/${dirPath}?ref=${GH_BRANCH_LEGACY}`
  );
  if (status === 404) return [];
  if (status !== 200) throw new Error(`GitHub list failed ${status}: ${dirPath}`);
  if (!Array.isArray(data)) return [];
  return data.filter((f) => f.type === 'file').map((f) => ({ name: f.name, path: f.path }));
}

 */

// --- Supabase Postgres backend (PostgREST over fetch, no npm deps) ---
// Config: SUPABASE_URL (https://<ref>.supabase.co), SUPABASE_SERVICE_KEY (service_role).
// service_role bypasses RLS, so no per-table policies are needed.

const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';

function sbCheck() {
  if (!SB_URL || !SB_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY env vars missing');
}

async function sbFetch(path, method, body, extraHeaders) {
  sbCheck();
  const res = await fetch(SB_URL + '/rest/v1/' + path, {
    method: method || 'GET',
    headers: Object.assign(
      {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
      },
      extraHeaders || {}
    ),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-json */ }
  return { status: res.status, data };
}

// Map a legacy queue repo path to its Supabase table + key.
//   queue/tasks/<status>/<id>.json -> {table:'tasks', status, key:id}
//   queue/messages/<id>.json        -> {table:'messages', key:id}
//   queue/notices/<key>.json        -> {table:'notices', key}
//   queue/heartbeats/<worker>.json  -> {table:'heartbeats', key:worker}
function parseQueuePath(repoPath) {
  const m = /^queue\/(tasks|messages|notices|heartbeats)\/(?:(pending|claimed|done|failed)\/)?([^/]+)\.json$/.exec(repoPath);
  if (!m) throw new Error('bad queue path: ' + repoPath);
  return { table: m[1], status: m[2] || null, key: m[3] };
}

function pkOf(table) {
  if (table === 'notices') return 'key';
  if (table === 'heartbeats') return 'worker';
  return 'id'; // tasks, messages
}

// Read a queue object. Returns {exists, sha, content} — same shape as the GitHub version.
// (sha is now the row's updated_at; callers only pass it through, never compare it.)
async function ghReadFile(repoPath) {
  const { table, status, key } = parseQueuePath(repoPath);
  const pk = pkOf(table);
  const tsCol = table === 'messages' ? 'created_at' : 'updated_at'; // messages has no updated_at
  let q = `${table}?${pk}=eq.${encodeURIComponent(key)}&select=data,${tsCol}`;
  if (table === 'tasks' && status) q += `&status=eq.${encodeURIComponent(status)}`;
  const { status: st, data } = await sbFetch(q);
  if (st !== 200) throw new Error(`Supabase read failed ${st}: ${repoPath}`);
  if (!Array.isArray(data) || data.length === 0) return { exists: false };
  return { exists: true, sha: data[0][tsCol] || '', content: data[0].data };
}

// Write (create or update) a queue object. Returns {ok, sha} — same shape as before.
// Supabase upsert (Prefer: resolution=merge-duplicates) is atomic, so the old
// GitHub SHA-conflict retry loop is unnecessary. Signature kept for compatibility.
async function ghWriteFile(repoPath, obj, message, maxRetries) {
  const { table, status, key } = parseQueuePath(repoPath);
  const pk = pkOf(table);
  const now = new Date().toISOString();
  const row = { [pk]: key, data: obj };
  if (table !== 'messages') row.updated_at = now; // messages uses created_at default
  if (table === 'tasks') row.status = status || (obj && obj.status) || 'pending';
  const { status: st } = await sbFetch(table, 'POST', row, { 'Prefer': 'resolution=merge-duplicates' });
  if (st !== 200 && st !== 201) throw new Error(`Supabase write failed ${st}: ${repoPath}`);
  return { ok: true, sha: now };
}

// Delete a queue object. Returns true if deleted, false if already gone — same as before.
async function ghDeleteFile(repoPath, message) {
  const { table, status, key } = parseQueuePath(repoPath);
  const existing = await ghReadFile(repoPath);
  if (!existing.exists) return false;
  const pk = pkOf(table);
  let q = `${table}?${pk}=eq.${encodeURIComponent(key)}`;
  if (table === 'tasks' && status) q += `&status=eq.${encodeURIComponent(status)}`;
  const { status: st } = await sbFetch(q, 'DELETE');
  if (st === 200 || st === 204 || st === 404) return true;
  throw new Error(`Supabase delete failed ${st}: ${repoPath}`);
}

// List queue objects in a "directory". Returns array of {name, path} — same shape as before.
// NOTE on moveTask(): write-to-new-status + delete-from-old-status now collapses into a
// single atomic status UPDATE on the same row; the follow-up delete then no-ops
// (ghReadFile finds no row with the old status → returns false). Net effect identical.
async function ghListDir(dirPath) {
  const m = /^queue\/(tasks|messages|notices|heartbeats)(?:\/(pending|claimed|done|failed))?$/.exec(dirPath);
  if (!m) throw new Error('bad queue dir: ' + dirPath);
  const table = m[1];
  const status = m[2] || null;
  const pk = pkOf(table);
  let q = `${table}?select=${pk}`;
  if (table === 'tasks' && status) q += `&status=eq.${encodeURIComponent(status)}`;
  if (table === 'messages') q += '&order=created_at.asc'; // oldest-first, like GitHub name order
  const { status: st, data } = await sbFetch(q);
  if (st !== 200) throw new Error(`Supabase list failed ${st}: ${dirPath}`);
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r) => {
    const name = r[pk] + '.json';
    const path = status ? `queue/${table}/${status}/${name}` : `queue/${table}/${name}`;
    return { name, path };
  });
}

// --- Auth (same as before: env tokens) ---
function getRole(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) return null;
  if (process.env.DISPATCH_MAIN_TOKEN && token === process.env.DISPATCH_MAIN_TOKEN) return 'main';
  // Owner (2026-10-26): video-3, the Reel Factory dispatcher, gets its own
  // DISPATCH_OWNER_TOKEN. It maps to 'main' so cancel/edit/delete/resubmit/
  // rework + task create/list all work for it, without sharing DISPATCH_MAIN_TOKEN.
  if (process.env.DISPATCH_OWNER_TOKEN && token === process.env.DISPATCH_OWNER_TOKEN) return 'main';
  const workers = (process.env.DISPATCH_WORKER_TOKENS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (workers.indexOf(token) !== -1) return 'worker';
  // labeled format: "video-1:TOKEN1,video-2:TOKEN2"
  // bridge format: "bridge-<name>:TOKEN" -> role 'bridge' (messages/notices only).
  // A bridge token can NEVER claim/complete tasks: the router only allows role
  // 'worker' on task routes, so this is enforced in code, not just by convention.
  for (const w of workers) {
    const i = w.indexOf(':');
    if (i > 0 && w.slice(i + 1) === token) return w.slice(0, i).startsWith('bridge-') ? 'bridge' : 'worker';
  }
  return null;
}

// Permanent fix (2026-10-06): worker identity comes from its token, not from the
// client-supplied worker= param. Tokens are labeled "name:TOKEN" in DISPATCH_WORKER_TOKENS.
// Unlabeled tokens fall back to the old behavior (name from query/body).
function getWorkerName(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) return null;
  const workers = (process.env.DISPATCH_WORKER_TOKENS || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const w of workers) {
    const i = w.indexOf(':');
    if (i > 0 && w.slice(i + 1) === token) return w.slice(0, i);
  }
  return null;
}

function getQuery(req) {
  try {
    const u = new URL(req.url, 'http://localhost');
    return Object.fromEntries(u.searchParams.entries());
  } catch (e) { return {}; }
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

async function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { resolve({}); }
    });
  });
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// --- Task helpers ---
const TASK_DIRS = ['pending', 'claimed', 'done', 'failed'];

async function findTask(taskId) {
  // Single indexed lookup (was: up to 4 file reads across status dirs).
  const { status: st, data } = await sbFetch(
    `tasks?id=eq.${encodeURIComponent(taskId)}&select=status,data,updated_at`
  );
  if (st !== 200) throw new Error(`Supabase find failed ${st}: ${taskId}`);
  if (!Array.isArray(data) || data.length === 0) return null;
  const row = data[0];
  return { dir: row.status, task: row.data, sha: row.updated_at || '' };
}

async function listTasksByStatus(status) {
  // Single query (was: 1 dir list + N file reads).
  const { status: st, data } = await sbFetch(
    `tasks?status=eq.${encodeURIComponent(status)}&select=data`
  );
  if (st !== 200) throw new Error(`Supabase list failed ${st}: tasks/${status}`);
  const tasks = [];
  for (const r of Array.isArray(data) ? data : []) {
    if (r && r.data) tasks.push(r.data);
  }
  return tasks;
}

// Move a task file from one status dir to another (with updated content).
async function moveTask(taskId, fromDir, toDir, updatedTask) {
  await ghWriteFile(`queue/tasks/${toDir}/${taskId}.json`, updatedTask, `queue: task ${taskId} ${fromDir}→${toDir}`);
  await ghDeleteFile(`queue/tasks/${fromDir}/${taskId}.json`, `queue: task ${taskId} moved to ${toDir}`);
}

// --- Route handlers ---

async function handleTasks(req, res, q, body) {
  // main only: create task, list tasks by status
  if (req.method === 'POST') {
    const taskId = newId();
    const now = Date.now();
    const task = {
      id: taskId,
      title: body.title || 'untitled',
      type: body.type || 'general',
      tag: body.tag || null,
      status: 'pending',
      assignTo: body.assignTo || null,
      groupId: body.groupId || null,
      spec: body.spec || {},
      createdAtMs: now,
      updatedAtMs: now,
      claimedBy: null,
      claimedAtMs: null,
      result: null,
      reworkCount: 0,
    };
    await ghWriteFile(`queue/tasks/pending/${taskId}.json`, task, `queue: create task ${taskId}`);
    return send(res, 200, { ok: true, taskId });
  }
  if (req.method === 'GET') {
    const status = (q.status || 'pending').trim();
    if (TASK_DIRS.indexOf(status) === -1) return send(res, 400, { error: 'bad status' });
    const tasks = await listTasksByStatus(status);
    tasks.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
    return send(res, 200, { tasks });
  }
  return send(res, 405, { error: 'method not allowed' });
}

async function handlePending(req, res, q, workerName) {
  // worker only: oldest pending task visible to this worker (does NOT claim)
  // worker identity: token-derived name wins (permanent fix 2026-10-06), query param is fallback
  const worker = (workerName || q.worker || '').trim();
  const tag = (q.tag || '').trim();
  const tasks = await listTasksByStatus('pending');
  tasks.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
  let task = null;
  for (const t of tasks) {
    // Assigned tasks bypass tag filter (always visible to assigned worker)
    if (t.assignTo && t.assignTo !== worker) continue;
    if (!t.assignTo && tag && t.tag && t.tag !== tag) continue;
    task = t;
    break;
  }
  return send(res, 200, { task });
}

async function handleTask(req, res, q, role, body, workerName) {
  const taskId = (q.id || '').trim();
  if (!taskId) return send(res, 400, { error: 'id required' });

  if (req.method === 'GET') {
    const found = await findTask(taskId);
    if (!found) return send(res, 404, { error: 'not found' });
    return send(res, 200, { task: found.task });
  }

  if (req.method === 'POST') {
    const action = (q.action || '').trim();

    if (action === 'claim') {
      const worker = (workerName || body.worker || '').trim();
      if (!worker) return send(res, 400, { error: 'worker required' });
      const found = await findTask(taskId);
      if (!found) return send(res, 404, { error: 'not found' });
      if (found.dir !== 'pending') return send(res, 409, { error: 'not pending' });
      const t = found.task;
      if (t.assignTo && t.assignTo !== worker) return send(res, 403, { error: 'assigned to another worker' });
      // One task per worker: check if this worker already holds a claim
      const claimed = await listTasksByStatus('claimed');
      const busy = claimed.find((c) => c.claimedBy === worker && (Date.now() - (c.claimedAtMs || 0)) < 6 * 3600 * 1000);
      if (busy) return send(res, 409, { error: 'worker busy', busyTaskId: busy.id });
      t.status = 'claimed';
      t.claimedBy = worker;
      t.claimedAtMs = Date.now();
      t.updatedAtMs = Date.now();
      await moveTask(taskId, 'pending', 'claimed', t);
      return send(res, 200, { ok: true, task: t });
    }

    if (action === 'result') {
      const worker = (workerName || body.worker || '').trim();
      const status = (body.status || '').trim(); // done | failed
      if (!worker || (status !== 'done' && status !== 'failed')) {
        return send(res, 400, { error: 'worker and status done|failed required' });
      }
      const found = await findTask(taskId);
      if (!found) return send(res, 404, { error: 'not found' });
      if (found.dir !== 'claimed') return send(res, 409, { error: 'not claimed' });
      const t = found.task;
      if (t.claimedBy !== worker) return send(res, 403, { error: 'claimed by another worker' });
      t.status = status;
      t.result = {
        storageFileId: body.storageFileId || null,
        storageFileName: body.storageFileName || null,
        note: body.note || null,
        finishedAtMs: Date.now(),
      };
      t.updatedAtMs = Date.now();
      await moveTask(taskId, 'claimed', status, t);
      return send(res, 200, { ok: true });
    }

    if (action === 'progress') {
      const worker = (workerName || body.worker || '').trim();
      let p = parseInt(body.progress, 10);
      if (isNaN(p)) p = 0;
      p = Math.max(0, Math.min(100, p));
      const found = await findTask(taskId);
      if (!found) return send(res, 404, { error: 'not found' });
      if (found.dir !== 'claimed') return send(res, 409, { error: 'not claimed' });
      const t = found.task;
      if (t.claimedBy !== worker) return send(res, 403, { error: 'claimed by another worker' });
      t.progress = p;
      t.progressNote = String(body.note || '').slice(0, 200);
      t.progressAtMs = Date.now();
      t.updatedAtMs = Date.now();
      await ghWriteFile(`queue/tasks/claimed/${taskId}.json`, t, `queue: progress ${p}% ${taskId}`);
      return send(res, 200, { ok: true, progress: p });
    }

    if (action === 'cancel') {
      const found = await findTask(taskId);
      if (!found) return send(res, 404, { error: 'not found' });
      const t = found.task;
      t.status = 'failed';
      t.result = { note: 'cancelled by main: ' + (body.reason || 'no reason'), finishedAtMs: Date.now() };
      t.updatedAtMs = Date.now();
      await moveTask(taskId, found.dir, 'failed', t);
      return send(res, 200, { ok: true });
    }

    if (action === 'rework') {
      const found = await findTask(taskId);
      if (!found) return send(res, 404, { error: 'not found' });
      if (found.dir !== 'done' && found.dir !== 'failed') return send(res, 409, { error: 'only done/failed can be reworked' });
      const t = found.task;
      t.status = 'pending';
      t.reworkCount = (t.reworkCount || 0) + 1;
      t.feedback = body.feedback || null;
      t.claimedBy = null;
      t.claimedAtMs = null;
      t.result = null;
      t.updatedAtMs = Date.now();
      await moveTask(taskId, found.dir, 'pending', t);
      // Notify worker via message
      if (t.claimedBy || body.notifyWorker) {
        const to = body.notifyWorker || t.assignTo;
        if (to) {
          const msgId = newId();
          await ghWriteFile(`queue/messages/${msgId}.json`, {
            id: msgId, from: 'main', to,
            text: `Rework requested on "${t.title}": ${t.feedback || 'see task'}`,
            createdAtMs: Date.now(), deliveredTo: [],
          }, `queue: rework notice ${msgId}`);
        }
      }
      return send(res, 200, { ok: true });
    }

    if (action === 'transfer') {
      const worker = (body.worker || '').trim();
      const to = (body.to || '').trim();
      if (!worker || !to) return send(res, 400, { error: 'worker and to required' });
      if (worker === to) return send(res, 400, { error: 'cannot transfer to self' });
      const found = await findTask(taskId);
      if (!found) return send(res, 404, { error: 'not found' });
      if (found.dir !== 'claimed') return send(res, 409, { error: 'not claimed' });
      const t = found.task;
      if (t.claimedBy !== worker) return send(res, 403, { error: 'claimed by another worker' });
      t.status = 'pending';
      t.assignTo = to;
      t.claimedBy = null;
      t.claimedAtMs = null;
      t.transferNote = body.note || null;
      t.updatedAtMs = Date.now();
      await moveTask(taskId, 'claimed', 'pending', t);
      const msgId = newId();
      await ghWriteFile(`queue/messages/${msgId}.json`, {
        id: msgId, from: 'main', to,
        text: `Task transferred to you: "${t.title}"${t.transferNote ? ' — ' + t.transferNote : ''}`,
        createdAtMs: Date.now(), deliveredTo: [],
      }, `queue: transfer notice ${msgId}`);
      return send(res, 200, { ok: true });
    }

    if (action === 'edit') {
      // main only: patch title/type/tag/assignTo/spec in place
      const found = await findTask(taskId);
      if (!found) return send(res, 404, { error: 'not found' });
      const t = found.task;
      for (const k of ['title', 'type', 'tag', 'assignTo', 'spec']) {
        if (body[k] !== undefined) t[k] = body[k];
      }
      t.updatedAtMs = Date.now();
      await ghWriteFile(`queue/tasks/${found.dir}/${taskId}.json`, t, `queue: edit ${taskId}`);
      return send(res, 200, { ok: true, task: t });
    }

    if (action === 'delete') {
      // main only: hard-delete the task from the queue
      const found = await findTask(taskId);
      if (!found) return send(res, 404, { error: 'not found' });
      await ghDeleteFile(`queue/tasks/${found.dir}/${taskId}.json`, `queue: delete ${taskId}`);
      return send(res, 200, { ok: true, deleted: taskId });
    }

    if (action === 'resubmit') {
      // main only: failed/done/claimed -> pending, fresh attempt
      const found = await findTask(taskId);
      if (!found) return send(res, 404, { error: 'not found' });
      if (found.dir === 'pending') return send(res, 409, { error: 'already pending' });
      const t = found.task;
      t.status = 'pending';
      t.resubmitCount = (t.resubmitCount || 0) + 1;
      t.claimedBy = null;
      t.claimedAtMs = null;
      t.result = null;
      if (body.feedback) t.feedback = body.feedback;
      t.updatedAtMs = Date.now();
      await moveTask(taskId, found.dir, 'pending', t);
      return send(res, 200, { ok: true });
    }

    return send(res, 400, { error: 'unknown action' });
  }

  return send(res, 405, { error: 'method not allowed' });
}

async function handleMessage(req, res, q, role, body, workerName) {
  if (req.method === 'POST') {
    // bridge role: sender name is token-derived (bridge-<name>), never client-supplied
    const from = role === 'main' ? 'main' : (role === 'bridge' ? (workerName || '') : (body.worker || '').trim());
    const to = (body.to || '').trim();
    const text = (body.text || '').trim();
    if (!from) return send(res, 400, { error: 'worker (sender name) required' });
    if (!to) return send(res, 400, { error: 'to required' });
    if (!text) return send(res, 400, { error: 'text required' });
    if (text.length > 2000) return send(res, 400, { error: 'text too long (max 2000)' });
    const msgId = newId();
    const msg = {
      id: msgId, from, to, text,
      refFileId: body.refFileId || null,
      createdAtMs: Date.now(),
      deliveredTo: [],
    };
    await ghWriteFile(`queue/messages/${msgId}.json`, msg, `queue: message ${msgId}`);
    return send(res, 200, { ok: true, messageId: msgId });
  }

  if (req.method === 'GET') {
    const worker = (q.worker || '').trim();
    if (!worker) return send(res, 400, { error: 'worker query param required' });
    // Single PostgREST query: the old per-file loop (106+ sequential round-trips)
    // blew Vercel's function timeout -> 500. Fetch all rows at once, filter in JS.
    const { status: st, data } = await sbFetch('messages?select=id,data&order=created_at.asc');
    if (st !== 200) throw new Error(`Supabase messages list failed ${st}`);
    const unread = [];
    for (const row of (Array.isArray(data) ? data : [])) {
      const m = row.data || {};
      const delivered = m.deliveredTo || [];
      if ((m.to === worker || m.to === 'all') && delivered.indexOf(worker) === -1) {
        unread.push({ id: row.id, m });
      }
    }
    unread.sort((a, b) => (a.m.createdAtMs || 0) - (b.m.createdAtMs || 0));
    const out = unread.slice(0, 20);
    // Mark as delivered (best-effort, one-shot) — one PATCH per message
    for (const { id, m } of out) {
      m.deliveredTo = (m.deliveredTo || []).concat([worker]);
      try {
        await sbFetch('messages?id=eq.' + encodeURIComponent(id), 'PATCH', { data: m });
      } catch (e) { /* best-effort */ }
    }
    // Cleanup: delete messages delivered to all intended recipients and older than 1h
    // (keeps the directory from growing unboundedly)
    return send(res, 200, {
      messages: out.map(({ m }) => ({
        id: m.id, from: m.from, to: m.to, text: m.text,
        refFileId: m.refFileId || null, createdAtMs: m.createdAtMs,
      })),
    });
  }

  return send(res, 405, { error: 'method not allowed' });
}

async function handleMessageLog(req, res) {
  // main only: recent messages for observability (single query, not per-file)
  const { status: st, data } = await sbFetch('messages?select=data&order=created_at.desc&limit=50');
  if (st !== 200) throw new Error(`Supabase messageLog failed ${st}`);
  const msgs = (Array.isArray(data) ? data : []).map((r) => r.data).filter(Boolean);
  msgs.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  return send(res, 200, {
    messages: msgs.slice(0, 50).map((m) => ({
      id: m.id, from: m.from, to: m.to, text: m.text,
      refFileId: m.refFileId || null, createdAtMs: m.createdAtMs,
    })),
  });
}

// --- Reel upload registry (Telegram bot workflow, 2026-10-14) ---
// Worker uploads finished reel to the Telegram bot, gets file_id, registers it here.
// Dispatcher (main) lists ready reels, downloads via Telegram getFile when needed,
// and marks status after Instagram upload. Saves Vercel/Storage bandwidth.
// Stored as queue/notices/reel-uploads-registry.json (no new Supabase table needed).
const REEL_REGISTRY_KEY = 'reel-uploads-registry';

async function readReelRegistry() {
  const r = await ghReadFile(`queue/notices/${REEL_REGISTRY_KEY}.json`);
  if (r.exists && r.content && Array.isArray(r.content.uploads)) return r.content;
  return { uploads: [] };
}

async function writeReelRegistry(reg) {
  await ghWriteFile(
    `queue/notices/${REEL_REGISTRY_KEY}.json`,
    { key: REEL_REGISTRY_KEY, title: 'Reel upload registry', uploads: reg.uploads, updatedAtMs: Date.now() },
    `queue: reel registry update (${reg.uploads.length} uploads)`
  );
}

async function handleReelUpload(req, res, q, role, body, workerName) {
  // POST route=reel-upload (worker): register a new upload {file_id, title}
  if (req.method === 'POST' && !q.action) {
    if (role !== 'worker') return send(res, 403, { error: 'workers only' });
    const file_id = (body.file_id || '').trim();
    const title = (body.title || '').trim();
    if (!file_id || !title) return send(res, 400, { error: 'file_id and title required' });
    const reg = await readReelRegistry();
    if (reg.uploads.some((u) => u.file_id === file_id)) {
      return send(res, 200, { ok: true, duplicate: true });
    }
    reg.uploads.push({
      file_id,
      title,
      worker: workerName || 'unknown',
      status: 'ready',
      uploadedAtMs: Date.now(),
      downloadedAtMs: null,
      uploadedIgAtMs: null,
    });
    await writeReelRegistry(reg);
    return send(res, 200, { ok: true, count: reg.uploads.length });
  }
  // POST route=reel-upload&action=status (main): update status {file_id, status}
  if (req.method === 'POST' && q.action === 'status') {
    if (role !== 'main') return send(res, 403, { error: 'main only' });
    const file_id = (body.file_id || '').trim();
    const status = (body.status || '').trim();
    if (!file_id || !['ready', 'downloaded', 'uploaded_ig'].includes(status)) {
      return send(res, 400, { error: 'file_id and valid status (ready|downloaded|uploaded_ig) required' });
    }
    const reg = await readReelRegistry();
    const entry = reg.uploads.find((u) => u.file_id === file_id);
    if (!entry) return send(res, 404, { error: 'file_id not found' });
    entry.status = status;
    if (status === 'downloaded') entry.downloadedAtMs = Date.now();
    if (status === 'uploaded_ig') entry.uploadedIgAtMs = Date.now();
    await writeReelRegistry(reg);
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: 'method not allowed' });
}

async function handleReelUploads(req, res, q, role) {
  // GET route=reel-uploads (main): list all registered uploads, newest first
  if (role !== 'main') return send(res, 403, { error: 'main only' });
  const reg = await readReelRegistry();
  const uploads = reg.uploads.slice().sort((a, b) => (b.uploadedAtMs || 0) - (a.uploadedAtMs || 0));
  return send(res, 200, { uploads });
}

async function handleNotice(req, res, q, role, body) {
  if (req.method === 'POST') {
    const key = (body.key || '').trim();
    if (!key) return send(res, 400, { error: 'key required' });
    const notice = {
      key,
      title: body.title || key,
      text: body.text || '',
      updatedAtMs: Date.now(),
    };
    await ghWriteFile(`queue/notices/${key}.json`, notice, `queue: notice ${key}`);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'GET' && q.key) {
    const r = await ghReadFile(`queue/notices/${q.key}.json`);
    if (!r.exists) return send(res, 404, { error: 'not found' });
    return send(res, 200, { notice: r.content });
  }
  if (req.method === 'DELETE') {
    const key = (q.key || '').trim();
    if (!key) return send(res, 400, { error: 'key required' });
    await ghDeleteFile(`queue/notices/${key}.json`, `queue: delete notice ${key}`);
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: 'method not allowed' });
}

async function handleNotices(req, res) {
  const files = await ghListDir('queue/notices');
  const notices = [];
  for (const f of files) {
    if (!f.name.endsWith('.json')) continue;
    const r = await ghReadFile(f.path);
    if (r.exists && r.content) notices.push(r.content);
  }
  notices.sort((a, b) => (a.key || '').localeCompare(b.key || ''));
  return send(res, 200, { notices });
}

function isoWeekKey(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return d.getFullYear() + '-W' + String(week).padStart(2, '0');
}

async function handleHeartbeat(req, res, body, workerName) {
  const worker = (workerName || body.worker || '').trim();
  if (!worker) return send(res, 400, { error: 'worker required' });
  const now = Date.now();
  const wk = isoWeekKey(now);
  // Load existing profile (keeps weekly usage history)
  let profile = { worker, weeks: {} };
  const existing = await ghReadFile(`queue/heartbeats/${worker}.json`);
  if (existing.exists && existing.content && typeof existing.content === 'object') {
    profile = existing.content;
    if (!profile.weeks || typeof profile.weeks !== 'object') profile.weeks = {};
  }
  profile.worker = worker;
  profile.timestampMs = now;
  // Live status fields (worker sends these with every ping)
  if (body.status !== undefined) profile.status = String(body.status).slice(0, 30);
  if (body.currentTask !== undefined) profile.currentTask = String(body.currentTask || '').slice(0, 120);
  if (body.note !== undefined) profile.note = String(body.note || '').slice(0, 200);
  if (body.tokensLimit !== undefined) {
    const lim = parseInt(body.tokensLimit, 10);
    if (!isNaN(lim) && lim > 0) profile.tokensLimit = lim;
  }
  // Weekly token usage: worker reports its cumulative week total; store latest per week
  if (body.tokensUsedWeek !== undefined && body.tokensUsedWeek !== null && body.tokensUsedWeek !== '') {
    const used = parseInt(body.tokensUsedWeek, 10);
    if (!isNaN(used) && used >= 0) profile.weeks[wk] = used;
  }
  // Keep only last 8 weeks
  const wks = Object.keys(profile.weeks).sort();
  while (wks.length > 8) delete profile.weeks[wks.shift()];
  await ghWriteFile(`queue/heartbeats/${worker}.json`, profile, `queue: heartbeat ${worker}`);
  return send(res, 200, { ok: true });
}

async function handleHeartbeats(req, res) {
  const files = await ghListDir('queue/heartbeats');
  const beats = [];
  for (const f of files) {
    if (!f.name.endsWith('.json')) continue;
    const r = await ghReadFile(f.path);
    if (r.exists && r.content) beats.push(r.content);
  }
  beats.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
  return send(res, 200, { heartbeats: beats });
}

module.exports = async (req, res) => {
  try {
    const role = getRole(req);
    if (!role) return send(res, 401, { error: 'unauthorized' });
    const q = getQuery(req);
    const body = req.method === 'POST' ? await readJson(req) : {};
    // token-derived worker name (permanent fix 2026-10-06); null for main/unlabeled tokens
    const workerName = (role === 'worker' || role === 'bridge') ? getWorkerName(req) : null;

    if (q.route === 'tasks') {
      if (role !== 'main') return send(res, 403, { error: 'main only' });
      return handleTasks(req, res, q, body);
    }
    if (q.route === 'pending') {
      if (role !== 'worker') return send(res, 403, { error: 'workers only' });
      return handlePending(req, res, q, workerName);
    }
    if (q.route === 'task') {
      const MAIN_ACTIONS = ['cancel', 'rework', 'edit', 'delete', 'resubmit'];
      if (req.method === 'POST' && MAIN_ACTIONS.includes(q.action) && role !== 'main') {
        return send(res, 403, { error: 'main only' });
      }
      if (req.method === 'POST' && !MAIN_ACTIONS.includes(q.action) && role !== 'worker') {
        return send(res, 403, { error: 'workers only' });
      }
      return handleTask(req, res, q, role, body, workerName);
    }
    if (q.route === 'message') {
      return handleMessage(req, res, q, role, body, workerName);
    }
    if (q.route === 'messages') {
      return handleMessage(req, res, q, role, body, workerName);
    }
    if (q.route === 'messageLog') {
      if (role !== 'main') return send(res, 403, { error: 'main only' });
      return handleMessageLog(req, res);
    }
    if (q.route === 'reel-upload') {
      return handleReelUpload(req, res, q, role, body, workerName);
    }
    if (q.route === 'reel-uploads') {
      return handleReelUploads(req, res, q, role);
    }
    if (q.route === 'notice') {
      if (role !== 'main') return send(res, 403, { error: 'main only' });
      return handleNotice(req, res, q, role, body);
    }
    if (q.route === 'notices') {
      return handleNotices(req, res);
    }
    if (q.route === 'heartbeat') {
      if (role !== 'worker') return send(res, 403, { error: 'workers only' });
      return handleHeartbeat(req, res, body, workerName);
    }
    if (q.route === 'heartbeats') {
      if (role !== 'main') return send(res, 403, { error: 'main only' });
      return handleHeartbeats(req, res);
    }
    return send(res, 400, { error: 'unknown route' });
  } catch (err) {
    console.error('dispatch error:', err.message);
    return send(res, 500, { error: 'server error', detail: err.message });
  }
};
