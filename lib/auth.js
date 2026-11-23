// Email magic-link sign-in helpers.
// How it works: a player enters their email -> we email a one-time link (valid 15 min) ->
// opening it creates a session -> an HttpOnly cookie identifies them on every request.
// Only SHA-256 hashes of link tokens and session tokens are stored, so a database leak can't be used to sign in.
import crypto from "node:crypto";

export const SESSION_COOKIE = "crx_sid";
export const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

export function normalizeEmail(raw) {
  const email = String(raw || "").trim().toLowerCase();
  // Simple, strict enough check: something@something.tld, no spaces, sensible length.
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, { secure, maxAgeMs }) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly", // page JavaScript can't read it (protects against stolen cookies via XSS)
    "SameSite=Lax", // not sent on cross-site POSTs (protects against CSRF)
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    secure ? "Secure" : "", // HTTPS only in production
  ].filter(Boolean).join("; ");
}

// Sends the sign-in email with Brevo's API. Without BREVO_API_KEY (local dev) it prints the link instead.
export async function sendMagicLink({ to, link, brand }) {
  const key = process.env.BREVO_API_KEY;
  if (!key) {
    console.log(`[auth] No BREVO_API_KEY set. Sign-in link for ${to}:\n  ${link}`);
    return { sent: false };
  }
  const from = process.env.MAIL_FROM;
  if (!from) throw new Error("MAIL_FROM is not set");
  brand = String(brand).replace(/[<>&"']/g, ""); // brand name is admin-editable: keep it out of the HTML markup
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: from, name: `${brand} League` },
      to: [{ email: to }],
      subject: `Your ${brand} League sign-in link`,
      textContent: `Sign in to ${brand} League: ${link}\n\nThis link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`,
      htmlContent: `<p>Tap to sign in to <b>${brand} League</b>:</p><p><a href="${link}">Sign in</a></p><p style="color:#666;font-size:13px">This link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.</p>`,
    }),
  });
  if (!res.ok) {
    console.error("[auth] Brevo send failed:", res.status, (await res.text()).slice(0, 200));
    throw new Error("Couldn't send the sign-in email");
  }
  return { sent: true };
}
