# Backlog: pending functionality

What Build 2 deliberately left out, so the next builds stay small and reviewable. Move items to "Done" with the commit that shipped them.

## Build 3 (due Nov 23): brand admin panel, properly
- [ ] **Admin login and roles**: brand admin vs Credexon super admin (today `/admin` has no login; local demo only).
- [ ] **Full admin panel design**, following the Credexon platform dashboard: vendor management, industry config, game library, scoring system, fantasy contests, ad campaigns, revenue & billing, reports, user analytics, rewards ledger.
- [ ] **Multi-brand (vendor) support**: each brand gets its own catalog, contests and shop; today there is one brand (GlowCart).
- [ ] **Contest scheduling**: start and end dates, auto-end with automatic prize payout (today: manual "End & pay").
- [ ] **Brand product catalog editor**: add or edit products and details used by the brand quiz (today: seeded in `server.js`).
- [ ] **Admin quiz review**: approve, edit or ban AI questions before they go live; flag reported questions.
- [ ] **Analytics charts**: daily active players, quiz funnel, retention, per-contest trends (PostHog dashboards plus in-app charts).

## Players and accounts
- [ ] **Real sign-up and login** (email or phone OTP); today a player is just a name stored in the browser.
- [ ] **User list with logins** for admins: sessions, last seen, devices.
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
- [ ] Pre-generate question pools per contest so players don't wait for generation and cost per play goes down.
- [ ] Timer per question and anti-cheat (today: answers are checked server-side, no timer).

## Platform
- [ ] Real database instead of `data/db.json`; cloud deploy (Build 5).
- [ ] Rewards ledger with audit trail for coins issued and redeemed.
- [ ] Automated tests for points crediting, the 5-contest limit, quiz scoring and prize payout.

## Done
- [x] Build 2: points per contest, max 5 live contests, AI quiz (5 questions, 5 plays, no repeats), Rewards Shop Earn and Redeem tabs, general leaderboards, admin sketch, AI cost and token log.
