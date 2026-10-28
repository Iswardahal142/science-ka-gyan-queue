# Reel Factory — deploy checklist (video-3 wale Muse / user ke liye)

Ye steps **video-3 wale Muse account** se honge (main-system wala Muse ye nahi
kar sakta — dusre account ka Vault/credentials uske paas nahi hain).

## 1. Supabase project (ek baar)

1. supabase.com → New project (free tier kaafi hai).
2. SQL editor → New query → `supabase-schema.sql` (is repo me hai) paste karke Run.
   4 tables banengi: tasks, messages, notices, heartbeats.
3. Project Settings → API se note karo: **Project URL** aur **service_role key**
   (secret — sirf Vercel env me jayegi, chat me kabhi nahi).

## 2. Vercel deploy (ek baar)

1. Is `reel-factory` folder ko naye GitHub repo me push karo (jaise `reel-factory`).
2. Vercel → Add New Project → repo select → Deploy.
3. Project Settings → Environment Variables me ye 4 dalo:
   - `SUPABASE_URL` = Supabase project URL
   - `SUPABASE_SERVICE_KEY` = service_role key
   - `REEL_MAIN_TOKEN` = ek lamba random token (dispatcher = video-3 wala Muse;
     **NOTE:** code `DISPATCH_MAIN_TOKEN` padhta hai — env ka naam
     `DISPATCH_MAIN_TOKEN` rakho, value nayi random)
   - `DISPATCH_WORKER_TOKENS` = `"reel-1:<WORKER_TOKEN_1>"` (comma-separated;
     naya worker aaye to `,"reel-2:<TOKEN2>"` add karo)
   - (bridge ke liye baad me) `"bridge-main:<TOKEN_A>"` isi list me add hoga.
4. Redeploy karo. Test: `GET https://<project>.vercel.app/api/dispatch?route=heartbeats`
   header `Authorization: Bearer <DISPATCH_MAIN_TOKEN>` → `{"heartbeats":[]}` aana chahiye.

## 3. Worker account setup (har naye worker ke liye)

1. Naye worker Muse account ke Secure Vault me 3 secrets:
   `REEL_WORKER_TOKEN`, `ISHWAR_STORAGE_USER_KEY`, `GEMINI_API_KEY`.
2. Uske chat me `WORKER_SETUP_REEL.md` ka text paste karo; `REEL_API_BASE`,
   `WORKER_NAME` (jaise `reel-1`) plain me batao.
3. Wo `reel-poller` cron (har 5 min) banayega. Pehla heartbeat aate hi
   `route=heartbeats` me dikhega — tab worker live hai.

## 4. Dispatcher shuru (video-3 wala Muse, roz)

1. Apne Secure Vault me `DISPATCH_MAIN_TOKEN` (upar wala) rakho.
2. `DISPATCHER_PLAYBOOK.md` padho — style lock notice par daalo (ek baar),
   phir roz 10-20 tasks banao.
3. Done reels `route=tasks&status=done` me — `result.storageFileId` se download
   karke Instagram par post karo.

## 5. Bridge (jab dono systems connect karne hon)

`BRIDGE.md` padho — dono sides par bridge tokens banao aur ek-dusre ke Vault me
rakho. Pehle ek test message bhejo dono taraf.

## Kharcha / limit (andaza)

- Supabase free tier: is load ke liye kaafi (sirf chhoti JSON rows).
- Vercel hobby: queue API calls halki hain; 10-20 reels/day me koi paid limit nahi.
- Storage by Iswar: per-file 2GB cap, daily/total limit nahi — 10-20 reels/day
  (~15-25MB each) aaram se store honge.
- Asli kharcha worker ke Muse account ka token hai — isiliye worker self-QA aur
  asset-reuse rules `WORKER_SETUP_REEL.md` me locked hain.
