// Security checks for Credexon League. Prints PASS/FAIL for each check.
//
//   Local (full suite; needs the app running without BREVO_API_KEY so sign-in links are returned):
//     BASE_URL=http://localhost:3000 ADMIN_EMAIL=you@example.com node tests/security-test.mjs
//   Live site (safe checks only: no sign-in, no emails sent):
//     BASE_URL=https://your-app.onrender.com node tests/security-test.mjs --live
//   Add --with-ai to also check that a second account can't answer someone else's quiz (makes 1 AI call).
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const LIVE = process.argv.includes("--live");
const WITH_AI = process.argv.includes("--with-ai");
let pass = 0, failed = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

async function call(path, { body, cookie, headers = {}, method } = {}) {
  const res = await fetch(BASE + path, {
    method: method || (body !== undefined ? "POST" : "GET"),
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, headers: res.headers };
}

// Signs in through the real magic-link flow (local dev returns the link instead of emailing it).
async function signIn(email) {
  const r = await call("/api/auth/request", { body: { email } });
  if (!r.data?.devLink) throw new Error(`No devLink for ${email} (status ${r.status}: ${r.data?.error}). Run locally without BREVO_API_KEY.`);
  const token = new URL(r.data.devLink).searchParams.get("token");
  const v = await call("/api/auth/verify", { body: { token } });
  const cookie = (v.headers.get("set-cookie") || "").split(";")[0];
  return { cookie, verify: v, token };
}

console.log(`Security checks against ${BASE}${LIVE ? " (live: safe checks only)" : ""}\n`);

// 1. Security headers
const home = await fetch(BASE + "/");
check("Content-Security-Policy header set", Boolean(home.headers.get("content-security-policy")));
check("X-Frame-Options DENY (no clickjacking)", home.headers.get("x-frame-options") === "DENY");
check("X-Content-Type-Options nosniff", home.headers.get("x-content-type-options") === "nosniff");

// 2. Signed-out visitors are refused
let r = await call("/api/join", { body: { contestId: "winter" } });
check("Signed-out join refused (401)", r.status === 401, `got ${r.status}`);
r = await call("/api/quiz/start", { body: { contestId: "trivia", user: "vishal" } });
check("Signed-out quiz start refused, even naming a player (401)", r.status === 401, `got ${r.status}`);
r = await call("/api/admin/overview");
check("Admin API refused without sign-in (401)", r.status === 401, `got ${r.status}`);
r = await call("/api/admin/reset", { body: {} });
check("Admin reset refused without sign-in (401)", r.status === 401, `got ${r.status}`);
r = await call("/api/state");
check("Public state has no emails", !JSON.stringify(r.data).includes("@"), "leaderboards show names only");

// 3. Cross-site request forgery defences
r = await call("/api/join", { body: { contestId: "winter" }, headers: { Origin: "https://evil.example" } });
check("Cross-site POST blocked (403)", r.status === 403, `got ${r.status}`);
r = await fetch(BASE + "/api/join", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
check("Non-JSON POST refused (415)", r.status === 415, `got ${r.status}`);

if (!LIVE) {
  // 4. Second account can't act as the first
  const stamp = Date.now();
  const A = await signIn(`player.a.${stamp}@test.example`);
  const B = await signIn(`player.b.${stamp}@test.example`);
  check("Player A signed in with a session cookie", A.verify.status === 200 && A.cookie.startsWith("crx_sid="));
  check("Session cookie is HttpOnly + SameSite", /HttpOnly/.test(A.verify.headers.get("set-cookie")) && /SameSite=Lax/.test(A.verify.headers.get("set-cookie")));
  r = await call("/api/auth/verify", { body: { token: A.token } });
  check("Sign-in link works only once (400 on reuse)", r.status === 400, `got ${r.status}`);
  const aBefore = (await call("/api/state", { cookie: A.cookie })).data.me;
  r = await call("/api/join", { cookie: B.cookie, body: { contestId: "winter", user: aBefore.name } });
  const aAfter = (await call("/api/state", { cookie: A.cookie })).data.me;
  const bAfter = (await call("/api/state", { cookie: B.cookie })).data.me;
  check("B naming A in a request still only affects B", !aAfter.joined.winter && Boolean(bAfter.joined.winter));
  r = await call("/api/profile", { cookie: B.cookie, body: { name: aAfter.name } });
  check("B can't take A's display name (409)", r.status === 409, `got ${r.status}`);
  r = await call("/api/profile", { cookie: B.cookie, body: { name: "vishal" } });
  check("B can't copy a leaderboard player's name (409)", r.status === 409, `got ${r.status}`);
  r = await call("/api/admin/overview", { cookie: B.cookie });
  check("Non-admin player refused from admin API (403)", r.status === 403, `got ${r.status}`);
  r = await call("/api/admin/brand", { cookie: B.cookie, body: { facts: "Fake fact one\nFake fact two\nFake fact three" } });
  check("Non-admin can't edit the brand facts the quiz uses (403)", r.status === 403, `got ${r.status}`);
  if (process.env.ADMIN_EMAIL) {
    const ADM = await signIn(process.env.ADMIN_EMAIL);
    r = await call("/api/admin/overview", { cookie: ADM.cookie });
    check("Admin email allowed into admin API (200)", r.status === 200, `got ${r.status}`);
  }
  if (WITH_AI) {
    await call("/api/join", { cookie: A.cookie, body: { contestId: "trivia" } });
    const qa = await call("/api/quiz/start", { cookie: A.cookie, body: { contestId: "trivia" } });
    check("A started a quiz", qa.status === 200, `got ${qa.status} ${qa.data?.error || ""}`);
    check("Quiz sent to browser without answer key", qa.status === 200 && !JSON.stringify(qa.data).includes('"correct"'));
    r = await call("/api/quiz/answer", { cookie: B.cookie, body: { quizId: qa.data?.quizId, index: 0, choice: 0 } });
    check("B can't answer A's quiz (403)", r.status === 403, `got ${r.status}`);
    // Question pools: A's quiz set is kept, so B's first quiz starts instantly without a new AI call.
    await call("/api/join", { cookie: B.cookie, body: { contestId: "trivia" } });
    const t0 = Date.now();
    const qb = await call("/api/quiz/start", { cookie: B.cookie, body: { contestId: "trivia" } });
    check("Second player's quiz comes from the pool (under 1 s)", qb.status === 200 && Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
  }
  r = await call("/api/auth/logout", { cookie: A.cookie, body: {} });
  r = await call("/api/join", { cookie: A.cookie, body: { contestId: "trivia" } });
  check("Signed-out session can't be reused (401)", r.status === 401, `got ${r.status}`);
}

// 5. Rate limit: 30 rapid sign-in requests from one visitor (junk addresses, so no email is sent).
// Junk has its own strict bucket, so running this test never blocks real sign-ins from the same Wi-Fi.
const statuses = [];
for (let i = 0; i < 30; i++) statuses.push((await call("/api/auth/request", { body: { email: `not-an-email-${i}` } })).status);
const refused = statuses.filter((s) => s === 429).length;
check("Rate limit refuses most of 30 rapid calls (429)", refused >= 24, `${30 - refused} allowed, ${refused} refused`);
if (!LIVE) {
  const after = await call("/api/auth/request", { body: { email: `real.after.${Date.now()}@test.example` } });
  check("A real sign-in from the same connection still works after the junk burst", after.status === 200, `got ${after.status}`);
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
