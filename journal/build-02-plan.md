# Build 2: Plan.md & Smallest Local Version & PostHog

Working log for Build 2. The required build log is on `docs/index.html`; this file keeps the detail (costs, tokens, time, problems) so it's easy to update. Pending work lives in [`BACKLOG.md`](../BACKLOG.md).

**Build due:** Monday, Nov 16, 2026 at 12:00 PM (Noon)

---

## 1. What you made
- **Commits shipped:**
  - Nov 14 `ed39c59`: Build 1 log fix (real hours and plan cost).
  - Nov 15 `002698e`: PostHog on the Product Page and prototype.
  - Nov 15: local app (`server.js`, `app/index.html`, `app/admin.html`), AI quiz, docs. *(hash added after push)*
- **Product Page URL:** https://building-with-ai-f26.github.io/yg1821-gamifiedecomm/
- **Local demo:** `npm start` → player app at http://localhost:3000, brand admin sketch at http://localhost:3000/admin
- **Summary of what works now:**
  - Join up to 5 live contests; each contest has its own **points** leaderboard; prizes are **coins** paid when a contest ends.
  - Contest page with Prizes, Leaderboard, Scoring and How to Play tabs.
  - **AI quiz** (the Build 2 real API call): 5 questions per play written by Claude, up to 5 plays per contest, no repeated questions for a player, answers checked on the server, points added to that contest only.
  - Rewards Shop **Earn** tab (review, photo, rating, referral, purchase), whose points go to every joined contest that scores the action, and a **Redeem** tab that spends coins.
  - General leaderboards: most points, most quiz plays, most coins won, most-reviewed and top-rated products.
  - Brand admin **sketch**: overview analytics, launch or edit contests (point rules, quiz topic and difficulty, plays, prizes), Rewards Shop items, players, products, AI cost per quiz.
  - PostHog on the Product Page, prototype and local app, with custom events `contest_joined`, `quiz_started`, `quiz_answered`, `quiz_completed`, `earn_action`, `reward_redeemed`.

## 2. How the app works (one user action, end to end)
1. The player clicks **Play quiz** on a contest, and the browser sends `POST /api/quiz/start {user, contestId}` to `server.js`.
2. The server checks the player joined, the contest is live and plays are left, then reads the contest's quiz settings (topic, difficulty, number of questions).
3. The server calls Claude (`ANTHROPIC_MODEL`, currently `claude-haiku-5-5`) through the official Anthropic SDK with **structured outputs**, so the reply is guaranteed JSON: question, 4 options, correct index, explanation. Brand quizzes get only the product catalog, so the AI can't invent product facts. The prompt lists the questions this player already saw so it doesn't repeat them, and the server also drops any duplicates.
4. The server shuffles the options, keeps the answer key, and returns only the questions. It logs tokens, cost and generation time.
5. Each answer goes to `POST /api/quiz/answer`, which returns right or wrong plus the explanation. `POST /api/quiz/finish` adds points to that contest's leaderboard.
6. PostHog records the funnel; the admin panel shows plays, scores and AI cost.

## 3. What the agent did
- **Agent and model:** Claude Code desktop app (Claude Opus 5.5) for planning, code, testing in the built-in browser, git and GitHub Pages.
- **App AI model:** Claude Haiku 5.5 (cheapest; switch to `claude-opus-5-5` in `.env` if question quality needs it).
- **How I directed it:** chose the quiz idea over the review checker; defined points vs coins, the 5-contest limit, admin-set quiz topics and difficulty, and Rewards Shop as the earn hub; kept the admin panel as a sketch until Build 3.

## 4. What didn't work
- `docs/prototype.html` came read-only from the zip, so edits failed until the file was made writable.
- Python's local web server couldn't read the Desktop folder (macOS privacy), so I switched to a small Node server.
- Session replay looked off on localhost after turning it on in PostHog: the browser had cached PostHog's settings file for 5 minutes. A fresh reload fixed it, with no code change.
- The first plan (AI review checker) was replaced by the brand quiz; the points model changed mid-plan (points per contest, coins only as prizes), which meant moving app data to a small server so the admin and player pages share it.

## 5. What it cost
- **Agent spend:** $0 extra; Claude Code is covered by Claude Pro ($20/month).
- **API runtime spend (quiz generation):** `$___`. Run `npm run usage` after testing and paste the total here.
- **Cost per quiz (5 questions):** `$___` (expected under $0.001 on Haiku 5.5; measured value from `npm run usage`).
- **Tokens per quiz:** `___ in / ___ out` (from `npm run usage`).
- **Hosting:** $0 (GitHub Pages free; app runs locally).
- **Your hours spent this week:** `___ hrs`
- **Cumulative project spend to date:** `$___`

## 6. Pod Critique Sign-off
- **Tested by podmate(s):**
- **Key feedback to address next:**
