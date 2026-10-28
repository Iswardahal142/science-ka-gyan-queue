# New channel — owner-token model (Reel Factory jaisa)

- **DISPATCH_MAIN_TOKEN** — sirf main (is account) ke paas. Kabhi dispatcher ya worker ko nahi dena.
- **DISPATCH_OWNER_TOKEN** — naye dispatcher account ko dena hai, SIRF file se (chat me kabhi nahi).
  Code me ye token `main` role deta hai: task create/list, cancel, edit, delete, resubmit, rework —
  bina main token share kiye. Isi liye dispatcher apna kaam khud chala sakta hai.
- **DISPATCH_WORKER_TOKENS** — workers ke token, dispatcher banayega / provisioner add karega.
  Naya worker aaye to purani list ka SUPERSET hi PATCH karna hai, kabhi drop nahi.

## Deploy par env me ye 3 dalne hain
- `DISPATCH_MAIN_TOKEN` = main token (hidden_files/tokens.md me)
- `DISPATCH_OWNER_TOKEN` = owner token (wahi file me)
- `DISPATCH_WORKER_TOKENS` = shuru me khaali, pehla worker aane par bharega

## Dispatcher ko dena hai (file se)
- Owner token file (user dispatcher account ke Secure Vault me dalega, naam: OWNER_TOKEN ya jo dispatcher account me rakha jaye)
- Queue base URL (deploy ke baad)
- Worker setup text (WORKER_SETUP.md, Drive-only upload ke saath update karke)

## Note
- Final upload Drive-only hai (Dispatch-Results folder, filename me task ID) — purane Storage wale text ko worker setup me mat rakhna.
- Deploy `target: "production"` se karna hai, phir alias re-pin + owner-token live test (pending route 200, fake task edit par 404 not 403).
