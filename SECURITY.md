# Security audit: Credexon League (Build 3)

**Live app:** https://credexon-league.onrender.com · **Lane:** Beginner · **Audit date:** Nov 22–23, 2026
**How to re-run the tests:** `BASE_URL=https://credexon-league.onrender.com node tests/security-test.mjs --live` (live, safe checks) or the full local suite in [`tests/security-test.mjs`](tests/security-test.mjs).

## My kind of app

**People sign in, and it saves data.** Shoppers sign in with an **email magic link** (no passwords). Each contest keeps a points leaderboard; coins pay out as prizes and are spent in the Rewards Shop. A brand admin panel (`/admin`) can launch contests and see player data. The app calls the Claude API to write quiz questions.

| Part | Where it runs | What it holds |
| --- | --- | --- |
| Node server (`server.js`) | Render, free web service | All rules: who you are, points, coins, admin checks, rate limits |
| Database | Neon Postgres for the live site (connection string only in Render); my laptop uses a local file, `data/db.json` | Players (email, name, points, coins), contests, shop, sessions, AI cost log |
| Sign-in emails | Brevo (transactional email API) | Sends the one-time link |
| AI | Anthropic Claude API (Haiku 5.5) | Writes quiz questions; the answer key stays on the server |
| Analytics | PostHog (public project token only) | Pageviews, clicks, session replay, quiz events |

**Why not RLS (row-level security)?** The class slides recommend Supabase with RLS for apps whose *browser* talks to the database with a public key. In this app the browser **never** talks to the database: only the server does, with a secret connection string stored in Render. So the protection is the server's own checks below (identity from the session cookie, admin allowlist, ownership checks, rate limits), which the test suite proves.

## What I checked

The five checks from class, the two extra ones, and what fits this app:

1. **Data is locked per person (the "second account" test).** Signed in as player B, I tried to act as player A: joining as A by naming A in the request, answering A's quiz, reading the admin API, taking A's display name.
2. **Secret keys stay on the server.** I searched the live pages `/`, `/admin` and `/auth/verify` for `sk-ant-`, `sk-or-`, `sk-proj-`, `sk_live_`, `sb_secret_`, `service_role`, `xkeysib-` (Brevo) and `postgres://`. I also checked that `.env` was never committed (`git log --all -- .env` is empty) and searched the whole git history for real-looking keys.
3. **Private storage.** The app stores no uploaded files (photo reviews are simulated), so there's no bucket to leak.
4. **Production out of my agent's reach.** The production connection string should exist only in Render's dashboard; my laptop and my coding agent should use their own database. I checked where my local copy actually saves data (`/api/health` reports `storage`).
5. **Spending caps and rate limits.** Per-player and per-connection limits on sign-in, quizzes and actions; a daily cap on AI quiz generations; a monthly limit at Anthropic on the live key.
6. **Dependencies.** `npm audit --omit=dev`.
7. **Agent attack review.** I asked my coding agent to attack the app: cross-site scripting in every `innerHTML` that shows player or AI text, cross-site request forgery, open redirects after sign-in, reused or leaked sign-in links, session theft, cheating at the quiz, name impersonation, abuse of the email sender, and anything written to logs. On day two I re-checked the new admin routes (brand facts, product catalog, question pools): all sit under `/api/admin/` behind the same guard, and the ready-made question sets with their answer key stay on the server.

## What I found

| # | Finding | Risk | How it was found |
| --- | --- | --- | --- |
| 1 | **Anyone could act as anyone (Build 2).** The server trusted a `user` name sent by the browser, so typing another player's name let you play as them, and `/admin` had no login at all. | High | Code review at the start of Build 3 |
| 2 | **Quiz answers could be submitted for someone else's quiz** if you knew its id. | Medium | Agent attack review |
| 3 | **The sign-in rate limit locked out real people on shared Wi-Fi.** My 30-call test from my laptop used up the allowance for everyone on the same connection, and I couldn't sign in. In a classroom, one shared NYU IP would block everyone after 5 sign-ins. | Medium (availability) | Happened to me on the live site |
| 4 | **The live server would have written sign-in links into its logs** if the email key were missing, letting anyone with log access sign in as a player. | Medium | Agent attack review |
| 5 | **Display-name impersonation.** A player could rename themselves to another player's name (e.g. the #1 player) on the leaderboard. | Low | Agent attack review |
| 6 | **Live configuration mistakes.** Render had a mistyped Brevo key ("Key not found") and the wrong `APP_URL`, so sign-in failed with "Server error". | Medium (availability) | Render logs after the first deploy |
| 7 | **Sign-in emails can land in spam.** They're sent "from" my NYU address through Brevo; NYU's email protection (DMARC) makes Gmail and others distrust them. | Low | Brevo delivery logs |
| 8 | **Dependencies:** 0 known vulnerabilities. | None | `npm audit` |
| 9 | **Secret search on the live site:** no keys found; `.env` never committed. | None | Search of live pages and git history |
| 10 | **My laptop was connected to the live database.** The local `.env` had the production Neon connection string, so my security tests created test players (`player.b.…`, 0 points) on the live leaderboard, and my coding agent could have changed live data. | High | Noticed test players on the live leaderboard (Nov 22) |

## What I fixed

| # | Fix | Proof (test) |
| --- | --- | --- |
| 1 | **Email magic-link sign-in.** The server decides who you are from a random session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` on the live site), never from the request body. Sign-in links work once, expire after 15 minutes, and need a tap on a confirmation page so email scanners can't use them up. Only SHA-256 hashes of link and session tokens are stored. | "B naming A in a request still only affects B" · "Sign-in link works only once" · "Signed-out session can't be reused" |
| 1 | **Admin lock.** `/api/admin/*` needs a signed-in email listed in `ADMIN_EMAILS`: 401 when signed out, 403 for other players. "Reset demo data" is disabled on the live site. | "Admin API refused without sign-in (401)" · "Non-admin player refused (403)" · screenshot `docs/img/security-admin-refused.jpg` |
| 2 | **Quiz ownership check.** Only the player who started a quiz can answer or finish it; the answer key never reaches the browser. | "B can't answer A's quiz (403)" · "Quiz sent to browser without answer key" |
| 3 | **Separate limits for junk and real sign-ins.** Invalid requests: 5 per 15 min per connection. Real sign-ins: 40 per 15 min per connection plus 3 per 15 min per email. Quizzes: 10 per 10 min per player, 100 per 10 min per connection, 300 AI generations per day in total. | "Rate limit refuses most of 30 rapid calls (429)": 5 allowed, 25 refused · "A real sign-in from the same connection still works after the junk burst" |
| 4 | The live server refuses to send (and never logs) sign-in links if the email key is missing. | Code: `lib/auth.js` |
| 5 | Display names already used by another real or leaderboard player are refused (409). | "B can't take A's display name" · "B can't copy a leaderboard player's name" |
| 6 | Corrected the Brevo key and `APP_URL` in Render; the code now trims stray spaces in pasted keys and shows "We couldn't send the sign-in email" instead of "Server error". | Live sign-in email delivered, opened and clicked (Brevo log, Nov 22, 10:31 PM) |
| 10 | Removed the production connection string from my laptop's `.env`; local runs (and my coding agent) now use `data/db.json`. `AGENTS.md` now says to check `/api/health` shows `"storage":"file"` before running tests locally. I left the 3 test players on the live leaderboard: they have 0 points and win nothing. | Local `/api/health` returns `"storage":"file"`; live returns `"storage":"postgres"` |
| — | **Cross-site request forgery:** POSTs must be JSON from our own site (other origins get 403, other content types 415). | "Cross-site POST blocked (403)" · "Non-JSON POST refused (415)" |
| — | **Browser security headers:** Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, and HSTS on the live site. | "Content-Security-Policy header set" and the two header checks |
| — | **No emails in public data:** leaderboards show display names only; emails are visible only to the player themself and to admins. | "Public state has no emails" |

**Test results:** full local suite **26 passed, 0 failed** (now also: "Non-admin can't edit the brand facts the quiz uses (403)" and "Second player's quiz comes from the pool"); live suite (safe checks, no sign-in) **11 passed, 0 failed**, including the rate limit answering 429 on 25 of 30 calls.

## What is left

- **Sender address:** move sign-in emails from my NYU address to a sender Brevo can send as directly (Gmail now; `league@credexon.com` after verifying the domain) so they stop landing in spam.
- **Anthropic spending cap:** confirm the monthly limit on the live key in the Anthropic Console (the app's own daily cap of 300 quizzes is already on).
- **Rate limits live in memory** on one server, so they reset when Render restarts. That's fine for one free instance; a shared store (e.g. Redis) is needed before running several.
- **Admin has no second factor:** anyone who controls an admin's inbox can sign in as admin. Next step: allow admin sign-ins only from a verified company domain, or add a second factor.
- **No automatic deploy from GitHub:** Render deploys from the public repo URL (I didn't change the class organization's GitHub permissions), so every deploy is a manual click.
- **Backups:** Neon's free plan keeps a short restore window; no separate scheduled backup yet.
- **Content-Security-Policy still allows inline scripts** (the pages use inline click handlers and the PostHog snippet). Moving them into files would allow a stricter policy.
- **A separate Neon `dev` branch:** local runs use a file today; a Neon `dev` branch would let me test Postgres-specific behaviour without touching production.
- **Question pools are shared:** one ready-made set can be served to up to 25 players, so friends could share answers. Each set is retired after 25 plays and no player ever sees a question twice; per-player sets would cost more.
- **AI quiz content** isn't reviewed by a person before players see it; Build 4's accuracy eval and an admin review queue are planned (see `BACKLOG.md`).
