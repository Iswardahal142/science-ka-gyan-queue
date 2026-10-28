# Reel Factory — dispatcher playbook (video-3 wale Muse ke liye)

Tum is factory ke **dispatcher** ho. Tumhare under workers (reel-1, reel-2, ...)
kaam karenge. Tumhara token budget BACHANA hai — bhari kaam workers karenge,
tum sirf specs + spot-check.

## Tumhara kaam (roz, ek session me)

1. **10-20 reel tasks banao** — ek ke baad ek, POST `/api/dispatch?route=tasks`
   (header: `Authorization: Bearer <tumhara REEL_MAIN_TOKEN>`):
   ```json
   {
     "title": "Reel 2026-10-14 #03 — <topic>",
     "type": "reel",
     "tag": "reel",
     "spec": {
       "topic": "...", "hook": "<pehle 2s ki line>",
       "script": "<poora voiceover text>",
       "voice": "<TTS voice>", "language": "<bhasha>",
       "style": "<visual style lock — har reel me SAME rakho>",
       "durationSec": 30, "caption": "...", "hashtags": "#...",
       "outputName": "reel-2026-10-14-03.mp4"
     }
   }
   ```
   `assignTo` mat do (khula rakho) — jo worker free ho uthayega. Baad me jab
   workers badhenge tab bhi yahi chalega.

2. **Style lock ek baar banao, roz reuse karo.** Har task me nayi style mat likho —
   ek `STYLE_LOCK.md` apne paas rakho aur har spec me wahi chipkao. Isse tumhara
   token bachta hai aur reels ek jaise dikhte hain (page ki pehchan banti hai).

3. **Spot-check, full QA nahi.** Worker self-QA karke bhejta hai. Tum roz 2-3 reels
   download karke dekho — sab sahi to baaki ko chhodo. Galat mile to us task par
   `action=rework` + feedback do, poori line mat roko.

## Token bachane ke rules (tumhare liye)

- **Script tum mat likho (lambi):** topic + hook + 3-4 bullet points do, poora
  script worker apne token par likhega. Ya: ek din ke saare topics ek hi message
  me plan karo, phir chhoti specs banao.
- **Ek session me saare tasks:** 10-20 tasks ek baar me banao, phir din bhar
  workers ko kaam karne do. Baar-baar wapas mat aao.
- **Notices se chalao:** style lock, caption template, hashtag set — ye sab
  `route=notice` par daal do (ek baar). Har task me dobara mat likho; spec me
  sirf `styleRef: "notice:style-lock"` likho aur worker ko notice padhne ko kaho.
- **Rework kam se kam:** spec itni saaf likho ki rework na pade. Rework tumhara
  aur worker dono ka token khata hai.
- **Khud generate mat karo:** tumhare paas media tools hain par TUM use nahi karoge —
  har bhari generation worker karega. Tum sirf text (specs, messages) me raho.

## Naye worker add karna (baad me)

1. Naye worker Muse account me `WORKER_SETUP_REEL.md` wala text paste karo.
2. Use uska `REEL_WORKER_TOKEN` do — `DISPATCH_WORKER_TOKENS` env me
   `"reel-2:<TOKEN>"` format me add karo (Vercel env, phir redeploy nahi chahiye —
   env change par redeploy lagta hai, yaad rakho).
3. `WORKER_NAME=reel-2` uske cron me likhwao. Bas — wo queue poll karne lagega.
   Claim system single-winner hai, isliye do workers aapas me takrayenge nahi.

## Roz ka hisaab

- `GET /api/dispatch?route=tasks&status=done` — aaj kitni reels bani.
- Har done task ka `result.storageFileId` = finished reel. Yehi tumhara **store** hai —
  Storage by Iswar par reels padi rahengi jab tak tum post na karo.
- Hafte me ek baar purani posted reels ke fileIds ka hisaab rakho (kaunsi post ho gayi).

## Heartbeat / monitoring

- Workers har 5 min heartbeat bhejte hain: `GET /api/dispatch?route=heartbeats`
  se dekho kaun zinda hai. 60+ min chup = message karke puchho, 120+ min = user ko batao.
- Yehi rule tum apne main system (dispatch-queue) se jante ho — wahi yahan bhi.
