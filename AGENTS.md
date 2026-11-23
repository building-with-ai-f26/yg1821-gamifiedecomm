# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Credexon League, where brands run points contests for their shoppers. Players join up to 5 contests, earn **points** through product actions (reviews, ratings, referrals, purchases) and an **AI-generated quiz**, climb each contest's leaderboard, and win **coins** they spend in the Rewards Shop.
- **Primary user & core workflow:** a shopper joins a contest, plays the quiz (5 AI questions, up to 5 plays), and climbs the leaderboard. See the living PRD in `docs/index.html`.
- **Tech stack:** Node.js 22+ (no framework) · plain HTML/CSS/JS front end · Anthropic SDK (`@anthropic-ai/sdk`) with Claude Haiku 5.5 and structured outputs via `zod` · Neon Postgres via `pg` (local JSON file when `DATABASE_URL` is empty) · email magic-link sign-in via Brevo · hosted on Render · PostHog analytics · GitHub Pages for the public Product Page.
- **Live app:** https://credexon-league.onrender.com · Security audit: [`SECURITY.md`](SECURITY.md)

## 2. Commands
- **Install dependencies:** `npm install`
- **Set up secrets:** `cp .env.example .env`, then fill it in (never commit `.env`). Locally, leave `BREVO_API_KEY` empty and sign-in links appear on screen; leave `DATABASE_URL` empty so the app uses `data/db.json`. Never put the production connection string on this laptop (it lives only in Render).
- **Run locally:** `npm start` (or `npm run dev` to auto-restart on changes) → player app http://localhost:3000, brand admin http://localhost:3000/admin
- **AI cost and token report:** `npm run usage`
- **Reset demo data (local only):** stop the server and delete `data/db.json`, or use "Reset demo data" in the admin panel (disabled on the live site)
- **Run security tests:** start a local copy with `BREVO_API_KEY=` (so no real emails go out), then `BASE_URL=http://localhost:3000 ADMIN_EMAIL=<an ADMIN_EMAILS address> node tests/security-test.mjs` (add `--with-ai` for the quiz-ownership check; one AI call). Live site, safe checks only: `BASE_URL=https://credexon-league.onrender.com node tests/security-test.mjs --live`
- **Run model evals:** planned for Build 4 (quiz accuracy eval; see `BACKLOG.md`)

## Project structure
| Path | What it is |
| --- | --- |
| `server.js` | Server: serves `app/`, JSON API for players and admin, sign-in routes, admin guard, rate limits, security headers, AI quiz generation (Claude) and question pools, contest auto-end, points/coins rules, cost and token logging |
| `lib/store.js` | Storage: one JSONB row in Neon Postgres when `DATABASE_URL` is set, `data/db.json` otherwise |
| `lib/auth.js` | Magic-link and session helpers (hashed tokens, cookie settings, Brevo email) |
| `lib/ratelimit.js` | In-memory fixed-window rate limiter |
| `app/verify.html` | Page the sign-in email links to ("Sign me in" button) |
| `render.yaml` | Render blueprint: build/start commands and which environment variables the live app needs |
| `tests/security-test.mjs` | Security test suite (second account, admin lock, CSRF, headers, rate limit) |
| `SECURITY.md` | Security audit: what was checked, found, fixed and left |
| `app/index.html` | Player app: contests, contest tabs, quiz player, Rewards Shop (Earn/Redeem), leaderboards, wallet |
| `app/admin.html` | Brand admin panel (sign-in + `ADMIN_EMAILS` required): analytics, launch/edit/end contests, quiz settings and question pools, brand facts and product catalog editors, shop items, player list, AI cost |
| `data/db.json` | Local demo database, created on first run (git-ignored) |
| `scripts/usage-report.js` | Prints AI calls, tokens, cost per quiz and latency from the local log |
| `docs/` | Public Product Page (`index.html`) and the Build 1 static prototype (`prototype.html`) on GitHub Pages |
| `BACKLOG.md` | Pending functionality for the next builds |
| `journal/` | Working build notes (costs, problems, time) |

## Key rules of the app (keep these true when changing code)
- **Points** belong to one contest; **coins** are the wallet currency, paid as contest prizes and spent in the Rewards Shop.
- A player can be in at most `MAX_ACTIVE_CONTESTS` (5) live contests. An Earn action credits every joined live contest whose `scoring[action] > 0`.
- Quiz points go only to the contest the quiz was played in. A play is used only when questions were generated successfully.
- The quiz answer key stays on the server; never send `correct` indexes to the browser before the player answers.
- **Quiz mix:** the default topic `mix` gives 3 brand + 1 industry + 1 general-knowledge question per 5 (`quotaFor()` in `server.js`); admins can pick brand-only, industry-only or general-only. **Brand** questions may only use facts in `db.brand.facts` and the catalog (`brandBrief()`); industry and general questions must be well-established facts. Each question carries a `category` shown to the player.
- **Question pools:** each contest keeps up to `POOL_TARGET` (6) ready-made quiz sets in `db.pools`, served to players who haven't seen any of their questions and refilled in the background. Changing a contest's quiz settings, brand facts or catalog clears the pool; keep it that way so no quiz uses outdated facts.
- **Contest end:** live contests end and pay prizes automatically when `endsAt` passes (`autoEndContests()`); manual "End & pay" uses the same `endContest()`.
- Every AI call is logged in `db.aiUsage` with tokens, cost and time; keep that when changing the AI code.
- Model is set by `ANTHROPIC_MODEL` in `.env` (default `claude-haiku-5-5`); never hardcode keys.
- **Identity comes only from the session cookie** (`ctx.user`). Never read who the player is from the request body or query string.
- Every `/api/admin/*` route is guarded in the HTTP handler (signed in + email in `ADMIN_EMAILS`); new admin routes must keep the `/api/admin/` prefix.
- Never send emails, sign-in links or session tokens to the browser, PostHog or logs (except the local-dev sign-in link when `BREVO_API_KEY` is empty).

## Shipping
The live app is on Render, deployed from the public GitHub repo URL (no auto-deploy).
1. Run the security tests locally (see Commands) and click through the changed screens at http://localhost:3000.
2. Commit with a clear message and push to `main` (as GitHub user `yg1821-droid`; the other account is read-only).
3. In Render (dashboard.render.com → `credexon-league`), click **Manual Deploy → Deploy latest commit** and watch the log until **Live**.
4. Open https://credexon-league.onrender.com with a cache-busting query (`?v=<anything>`), check what changed, and run the live security tests.
5. If you changed environment variables, check Render's log line `Credexon League running (production, storage: postgres)` and the admin list it prints.
6. Report what is live, which commit, and what you checked. If something broke, roll back with **Manual Deploy → Deploy a specific commit**.

## Ask me first
- Anything that changes, deletes or resets data in the **production** Neon branch, or points a local copy at it.
- Keys, secrets, environment variables in Render, `ADMIN_EMAILS`, and anyone's account permissions (including GitHub organization app access).
- Anything that costs money or raises a limit: paid plans, a new paid service, a higher `AI_DAILY_LIMIT`, switching the quiz to a more expensive model.
- Sending real emails to anyone other than me.
- Changing product rules: quiz topics and mix, points vs coins, contest limits, prizes.
- Adding a dependency.

## Rules from real mistakes
- **Check which database a local copy uses before testing.** My laptop's `.env` once pointed at the live database, and my security tests put test players on the live leaderboard. Before running tests, `curl localhost:3000/api/health` must show `"storage":"file"`.
- **Verify pages with a cache-busting URL.** I once checked a page right after changing it and nearly reported the old cached copy as the new one.
- **Don't narrow product scope beyond what was asked.** Asked for brand-relevant quiz questions, I made the quiz brand-only; the user wanted a mix of brand, industry and general knowledge. Ask before removing options.
- **Run load and rate-limit tests so they can't block real users.** My live 30-call test used up the sign-in allowance for everyone on the same Wi-Fi, including the user. Junk test traffic now has its own limit; keep test traffic separate from real traffic.
- **Read the host's logs before guessing.** The live "Server error" was a mistyped Brevo key and a wrong `APP_URL` in Render, which the Render log showed in one line.
- **Don't save permission changes you can't see the full effect of.** Render's GitHub page for the class organization showed only one of the repos it already had access to; saving could have removed classmates' access. Use the public repo URL instead.
- **Don't say a sign-in or email works until the provider's log shows it delivered.** Brevo's transactional log shows sent, delivered, opened and clicked per recipient.

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
