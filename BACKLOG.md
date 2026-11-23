# Backlog: pending functionality

What Build 2 deliberately left out, so the next builds stay small and reviewable. Move items to "Done" with the commit that shipped them.

## Build 3 (due Nov 23): brand admin panel, properly
- [x] **Admin login**: signed-in emails in `ADMIN_EMAILS` (Build 3). Still to do: roles (brand admin vs Credexon super admin).
- [ ] **Full admin panel design**, following the Credexon platform dashboard: vendor management, industry config, game library, scoring system, fantasy contests, ad campaigns, revenue & billing, reports, user analytics, rewards ledger.
- [ ] **Multi-brand (vendor) support**: each brand gets its own catalog, contests and shop; today there is one brand (GlowCart).
- [x] **Contest auto-end** with automatic prize payout at the end date (Build 3). Still to do: scheduled start dates.
- [x] **Brand product catalog editor**: add, edit or remove products and details used by the brand quiz (Build 3).
- [x] **Brand profile editor**: brand admins edit the facts the quiz uses (Build 3). Still to do: warn when a fact is out of date (e.g. a launch date has passed).
- [ ] **Admin quiz review**: approve, edit or ban AI questions before they go live; flag reported questions.
- [ ] **Analytics charts**: daily active players, quiz funnel, retention, per-contest trends (PostHog dashboards plus in-app charts).

## Security follow-ups (from SECURITY.md)
- [ ] Send sign-in emails from a verified domain sender (e.g. `league@credexon.com`) instead of an NYU address, so they don't land in spam.
- [ ] Admin second factor, or admin sign-in only from a verified company domain.
- [ ] Move inline scripts and click handlers into files so the Content-Security-Policy can drop `'unsafe-inline'`.
- [ ] Shared rate-limit store (e.g. Redis) before running more than one server instance.
- [ ] Scheduled database backups beyond Neon's free restore window.
- [ ] A Neon `dev` branch for local Postgres testing (today local runs use `data/db.json`).
- [ ] Auto-deploy from GitHub once the class organization approves Render's access (today: Manual Deploy).

## Developer experience
- [ ] **API documentation page**: an OpenAPI spec and an `/api-docs` page listing every endpoint, its inputs, and which ones need sign-in or admin.

## Players and accounts
- [x] **Real sign-up and login**: email magic link via Brevo (Build 3).
- [x] **Player list** for admins with email and last activity (Build 3). Still to do: active sessions and devices, sign out a player.
- [ ] Profile, login streak rewards (Day 1/3/5/7) and "complete profile" points from the scoring sheet.

## Games and earning
- [ ] **Other games** besides the quiz, each with its own scoring, plus game library management.
- [ ] Real referral tracking (unique links, friend sign-up and first-game attribution, 50/month cap).
- [ ] Real purchases via the store's order webhook with coupon `GLOWLEAGUE` (+10 points per ₹1,000, 100 cap).
- [ ] Photo upload for photo reviews (today: simulated).
- [ ] Review quality check with AI (the earlier "AI review checker" idea), to stop low-effort reviews farming points.
- [ ] Ad engagement scoring (rewarded video, banner, click-through) with daily caps.

## Quiz quality and cost (Build 4 evals)
- [ ] **Eval set**: 10 cases (5 normal, 3 messy, 2 adversarial) checking every question is factually right, has exactly one correct answer, matches the difficulty, and never repeats for a player.
- [ ] Compare Claude Haiku 5.5 (current) against Claude Opus 5.5 on that eval; switch with `ANTHROPIC_MODEL` in `.env`.
- [x] Pre-generated question pools per contest so players don't wait and cost per play goes down (Build 3). Still to do: per-player sets for prize contests, so friends can't share answers.
- [ ] Timer per question and anti-cheat (today: answers are checked server-side, no timer).

## Platform
- [x] Real database (Neon Postgres) and cloud deploy (Render) (Build 3).
- [ ] Rewards ledger with audit trail for coins issued and redeemed.
- [ ] Automated tests for points crediting, the 5-contest limit, quiz scoring and prize payout.

## Done
- [x] Build 2: points per contest, max 5 live contests, AI quiz (5 questions, 5 plays, no repeats), Rewards Shop Earn and Redeem tabs, general leaderboards, admin sketch, AI cost and token log.
