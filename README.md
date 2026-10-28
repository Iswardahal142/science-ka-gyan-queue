# Science Ka Gyan Hindi — alag dispatch system

Channel: Science Ka Gyan Hindi (Hindi science videos)
Dispatcher: naya alag Muse account (main nahi, video-3 nahi)
Model: Reel Factory jaisa owner-token model

- Main token: sirf main ke paas (hidden_files/tokens.md)
- Owner token: dispatcher ko file se dena hai — ye token main role deta hai
  (task create/cancel/edit/delete/resubmit), bina main token share kiye
- Worker prefix: skg-1, skg-2, ... (video-1/2/4/5 aur reel-1/2/3 se clash nahi)
- Upload: Drive-only — Google Drive folder Dispatch-Results, filename me task ID,
  result me Drive fileId

Files:
- api/dispatch.js — queue API (owner-token logic included)
- supabase-schema.sql — 4 tables: tasks, messages, notices, heartbeats
- vercel.json, package.json — deploy config
- WORKER_SETUP.md — worker account me paste karne wala text (Drive-only me update karna hai)
- DEPLOY_CHECKLIST.md — deploy steps
- OWNER_MODEL.md — token model
