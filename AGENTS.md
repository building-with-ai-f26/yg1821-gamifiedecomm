# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Credexon League, where brands run points contests for their shoppers. Players join up to 5 contests, earn **points** through product actions (reviews, ratings, referrals, purchases) and an **AI-generated quiz**, climb each contest's leaderboard, and win **coins** they spend in the Rewards Shop.
- **Primary user & core workflow:** a shopper joins a contest, plays the quiz (5 AI questions, up to 5 plays), and climbs the leaderboard. See the living PRD in `docs/index.html`.
- **Tech stack:** Node.js 22+ (no framework) · plain HTML/CSS/JS front end · Anthropic SDK (`@anthropic-ai/sdk`) with Claude Haiku 5.5 and structured outputs via `zod` · JSON file storage · PostHog analytics · GitHub Pages for the public Product Page.

## 2. Commands
- **Install dependencies:** `npm install`
- **Set up secrets:** `cp .env.example .env`, then add `ANTHROPIC_API_KEY` (never commit `.env`)
- **Run locally:** `npm start` (or `npm run dev` to auto-restart on changes) → player app http://localhost:3000, brand admin http://localhost:3000/admin
- **AI cost and token report:** `npm run usage`
- **Reset demo data:** stop the server and delete `data/db.json`, or use "Reset demo data" in the admin panel
- **Run deterministic tests:** none yet (see `BACKLOG.md`); manual checks are listed in `journal/build-02-plan.md`
- **Run model evals:** planned for Build 4 (quiz accuracy eval; see `BACKLOG.md`)

## Project structure
| Path | What it is |
| --- | --- |
| `server.js` | Local server: serves `app/`, JSON API for players and admin, AI quiz generation (Claude), points/coins rules, cost and token logging |
| `app/index.html` | Player app: contests, contest tabs, quiz player, Rewards Shop (Earn/Redeem), leaderboards, wallet |
| `app/admin.html` | Brand admin panel (Build 2 sketch): analytics, launch/edit contests, quiz settings, shop items, AI cost |
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
- Every AI call is logged in `db.aiUsage` with tokens, cost and time; keep that when changing the AI code.
- Model is set by `ANTHROPIC_MODEL` in `.env` (default `claude-haiku-5-5`); never hardcode keys.

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
