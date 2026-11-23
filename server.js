// Credexon League — local server (Build 2)
// Serves the player app (/) and the brand admin panel (/admin), stores demo data in data/db.json,
// and generates contest quiz questions with Claude via the official Anthropic SDK.
// Run: npm start   (reads ANTHROPIC_API_KEY and ANTHROPIC_MODEL from .env)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createStore } from "./lib/store.js";
import * as auth from "./lib/auth.js";
import { hit } from "./lib/ratelimit.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(ROOT, "app");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, "db.json"); // DB_FILE lets you run a separate test copy
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === "production";
// Render needs 0.0.0.0; locally we only listen on this computer.
const HOST = process.env.HOST || (IS_PROD ? "0.0.0.0" : "127.0.0.1");
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).trim().replace(/\/$/, "");
// Brand admins: comma-separated emails allowed into /admin and /api/admin/*.
const ADMIN_EMAILS = new Set(String(process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
// Behind Render's proxy the real visitor IP is in X-Forwarded-For.
const TRUST_PROXY = process.env.TRUST_PROXY === "1" || IS_PROD;
// Safety cap on AI spend: max quiz generations per day across all players.
const AI_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 300;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";

// USD per million tokens [input, output]. Used to show cost per quiz in the admin panel.
const PRICES = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};

const MAX_ACTIVE_CONTESTS = 5; // a player can be in at most 5 live contests at once
const WELCOME_COINS = 500; // demo starting balance so the Rewards Shop and coin-entry contests are usable

// Point rules a contest can switch on. 0 = this contest doesn't score that action.
const ACTIONS = {
  review: "Text review (30+ words)",
  photo: "Photo review",
  rating: "Star rating",
  referral: "Friend signs up via your link",
  purchase: "Purchase with brand coupon",
  quiz_correct: "Quiz: each correct answer",
  quiz_perfect: "Quiz: perfect-score bonus",
};

// Quiz topics the brand admin can pick per contest. Default is a mix: mostly brand questions, plus industry and general knowledge.
// Brand questions may only use facts from the brand profile + catalog; industry and general questions must be well-established facts.
const TOPICS = {
  mix: "Good mix: brand + industry + general knowledge",
  brand_mix: "Brand only: story, products & launches",
  brand_story: "Brand only: story & facts",
  brand_products: "Brand only: products & best-sellers",
  brand_launches: "Brand only: launches, collections & offers",
  industry: "Industry knowledge only",
  general: "General knowledge only",
};
const DEFAULT_TOPIC = "mix";

// Brand profile the admin will edit in Build 3 (fictional demo brand).
function seedBrand() {
  return {
    name: "GlowCart",
    industry: "D2C beauty & lifestyle e-commerce (India)",
    facts: [
      "GlowCart was founded in 2019 in Mumbai, India.",
      "Founders: Ananya Rao and Kabir Mehta.",
      "GlowCart started as an Instagram shop selling one product: the Rose Hand Balm.",
      "GlowCart launched its own website (D2C store) in 2020.",
      "Brand promise: clean, fragrance-light beauty made for Indian weather.",
      "Best-selling product of all time: Rose Hand Balm.",
      "Signature ingredient used across the range: rosehip oil.",
      "GlowCart passed 120,000 customers in 2026.",
      "First offline pop-up store: Bandra, Mumbai, opened in 2024.",
      "All GlowCart products are cruelty-free.",
      "Refill pouches for the Rose Hand Balm have been sold since 2022.",
      "Next collection: the Spring Bloom collection launches on 1 March 2027.",
      "Spring Bloom collection items: a peach-shade lip tint, an SPF 50 gel sunscreen and a linen tote bag.",
      "VIP Insiders Cup winners get the Spring Bloom collection before everyone else.",
      "Coming after Spring Bloom: a Monsoon Repair hair serum, planned for June 2027.",
      "Coupon code GLOWLEAGUE gives 10% off for GlowCart League players.",
      "Free shipping on orders above ₹999.",
      "Delivery across India takes 2–5 days.",
      "Returns: 15 days on unopened products.",
    ],
  };
}
const DIFFICULTIES = ["easy", "medium", "hard", "mixed"];

// ---------- Seed data (fictional brand) ----------
function seed() {
  const day = 86400000;
  const now = Date.now();
  const rivals = (scale) =>
    [["vishal", 640], ["Priya S", 585], ["god10", 520], ["Arjun M", 470], ["Neha K", 410], ["Rohan D", 355],
     ["Aisha T", 290], ["Kabir V", 240], ["Meera J", 180], ["Dev P", 130], ["Sana R", 85], ["Ishaan G", 40]]
      .map(([name, pts]) => ({ name, points: Math.round(pts * scale), seeded: true }));
  return {
    brand: seedBrand(),
    products: [
      { id: "p1", name: "Winter Glow Serum", emoji: "🧴", price: 1299, category: "Skincare", details: "30 ml vitamin C and hyaluronic acid serum for dull winter skin; use 2–3 drops every morning before moisturiser; suitable for all skin types; fragrance-free." },
      { id: "p2", name: "Velvet Lip Tint", emoji: "💄", price: 599, category: "Makeup", details: "Matte-finish lip tint in 6 shades; infused with shea butter; lasts up to 8 hours; vegan and cruelty-free." },
      { id: "p3", name: "Cashmere Scarf", emoji: "🧣", price: 2499, category: "Accessories", details: "100% cashmere, 180 × 30 cm; available in camel, charcoal and blush; hand-wash cold only." },
      { id: "p4", name: "Hydra Night Cream", emoji: "🌙", price: 899, category: "Skincare", details: "50 ml overnight cream with ceramides and niacinamide; apply as the last step of a night routine; non-comedogenic." },
      { id: "p5", name: "Glow Tote Bag", emoji: "👜", price: 1799, category: "Accessories", details: "Recycled-canvas tote with an inner zip pocket and a laptop sleeve that fits up to 14-inch laptops." },
      { id: "p6", name: "Rose Hand Balm", emoji: "🌹", price: 349, category: "Body care", details: "75 ml hand balm with rosehip oil and glycerin; non-greasy; travel-size tube." },
    ],
    productStats: {
      p1: { reviews: 14, ratings: [5, 5, 4, 5, 4, 5], purchases: 22 },
      p2: { reviews: 21, ratings: [4, 5, 4, 4, 3, 5, 4], purchases: 35 },
      p3: { reviews: 6, ratings: [5, 4, 5], purchases: 9 },
      p4: { reviews: 11, ratings: [4, 4, 5, 3], purchases: 17 },
      p5: { reviews: 8, ratings: [4, 5, 4], purchases: 12 },
      p6: { reviews: 17, ratings: [5, 5, 5, 4, 5], purchases: 41 },
    },
    shop: [
      { id: "s1", name: "₹250 GlowCart Voucher", category: "Coupons", emoji: "🎫", cost: 300, stock: 100 },
      { id: "s2", name: "15% off next order", category: "Coupons", emoji: "🏷️", cost: 150, stock: 200 },
      { id: "s3", name: "Free shipping for 3 months", category: "Coupons", emoji: "🚚", cost: 200, stock: 100 },
      { id: "s4", name: "Velvet Lip Tint", category: "Products", emoji: "💄", cost: 450, stock: 25 },
      { id: "s5", name: "Winter Skincare Kit", category: "Products", emoji: "🧴", cost: 900, stock: 10 },
      { id: "s6", name: "Glow Tote Bag", category: "Products", emoji: "👜", cost: 600, stock: 15 },
      { id: "s7", name: "VIP Contest Entry Pass", category: "Passes", emoji: "🏆", cost: 400, stock: 50, grantsPass: true },
    ],
    contests: [
      {
        id: "winter", name: "GlowCart Winter League", tag: "FREE ENTRY · 30 days", status: "live", endsAt: now + 12 * day,
        desc: "Season-long. Earn points for reviews, referrals, purchases and the daily quiz. Top players win coins.",
        entry: { type: "free", fee: 0 },
        prizes: [{ upTo: 1, coins: 1000, note: "+ Winter Hamper" }, { upTo: 2, coins: 600 }, { upTo: 3, coins: 400 }, { upTo: 10, coins: 150 }],
        scoring: { review: 10, photo: 15, rating: 3, referral: 20, purchase: 30, quiz_correct: 10, quiz_perfect: 25 },
        quiz: { enabled: true, topic: "mix", difficulty: "mixed", questions: 5, maxPlays: 5 },
        seedPlayers: rivals(1),
      },
      {
        id: "trivia", name: "GlowCart Trivia Cup", tag: "FREE ENTRY · Quiz only · 7 days", status: "live", endsAt: now + 5 * day,
        desc: "Quiz contest: AI-written questions about GlowCart, the beauty & e-commerce industry, and general knowledge. Only quiz points count.",
        entry: { type: "free", fee: 0 },
        prizes: [{ upTo: 1, coins: 1000 }, { upTo: 2, coins: 500 }, { upTo: 3, coins: 250 }],
        scoring: { review: 0, photo: 0, rating: 0, referral: 0, purchase: 0, quiz_correct: 10, quiz_perfect: 25 },
        quiz: { enabled: true, topic: "mix", difficulty: "medium", questions: 5, maxPlays: 5 },
        seedPlayers: rivals(0.35),
      },
      {
        id: "weekend", name: "Weekend Sprint", tag: "50-COIN ENTRY · 3 days", status: "live", endsAt: now + 2 * day,
        desc: "Short and competitive. Pay 50 coins to enter; bigger prizes for the top 10. Reviews and purchases only.",
        entry: { type: "coins", fee: 50 },
        prizes: [{ upTo: 1, coins: 2500 }, { upTo: 2, coins: 1500 }, { upTo: 3, coins: 1000 }, { upTo: 10, coins: 300 }],
        scoring: { review: 15, photo: 20, rating: 5, referral: 0, purchase: 40, quiz_correct: 0, quiz_perfect: 0 },
        quiz: { enabled: false, topic: "brand_launches", difficulty: "easy", questions: 5, maxPlays: 5 },
        seedPlayers: rivals(0.4),
      },
      {
        id: "vip", name: "VIP Insiders Cup", tag: "VIP PASS · invite only", status: "live", endsAt: now + 6 * day,
        desc: "For VIP pass holders (buy one in the Rewards Shop). Hard quiz on GlowCart products.",
        entry: { type: "pass", fee: 0 },
        prizes: [{ upTo: 1, coins: 3000, note: "+ Full Spring collection" }, { upTo: 2, coins: 1500 }, { upTo: 3, coins: 1000 }],
        scoring: { review: 10, photo: 15, rating: 3, referral: 20, purchase: 30, quiz_correct: 15, quiz_perfect: 40 },
        quiz: { enabled: true, topic: "brand_products", difficulty: "hard", questions: 5, maxPlays: 3 },
        seedPlayers: rivals(0.7),
      },
    ],
    version: 4,
    pools: {},
    users: {},
    loginTokens: {}, // sha256(token) -> { email, exp }
    sessions: {}, // sha256(session) -> { user, exp }
    events: [],
    aiUsage: [],
  };
}

// ---------- Storage ----------
// Postgres (Neon) when DATABASE_URL is set, otherwise the local data/db.json file. See lib/store.js.
const store = await createStore({ file: DB_FILE, databaseUrl: process.env.DATABASE_URL });
let db;
async function load() {
  db = await store.load();
  if (!db) { db = seed(); save(); return; }
  // Upgrade older demo data: brand profile + brand-only quiz topics.
  if (!Array.isArray(db.brand?.facts)) db.brand = seedBrand();
  // v3: the default quiz became a brand + industry + general mix.
  if ((db.version || 0) < 3) {
    for (const c of db.contests) if (c.quiz.topic === "brand_mix" && ["winter", "trivia"].includes(c.id)) c.quiz.topic = "mix";
    const t = db.contests.find((c) => c.id === "trivia");
    if (t) t.desc = "Quiz contest: AI-written questions about GlowCart, the beauty & e-commerce industry, and general knowledge. Only quiz points count.";
    db.version = 3;
  }
  for (const c of db.contests) if (!TOPICS[c.quiz.topic]) c.quiz.topic = DEFAULT_TOPIC;
  // v4: sign-in. Older name-only demo players stay on leaderboards but can't sign in.
  db.loginTokens ??= {};
  db.sessions ??= {};
  db.pools ??= {}; // contestId -> ready-made quiz sets (see "Question pools")
  db.version = Math.max(db.version || 0, 4);
  save();
}
function save() { store.save(db); }
await load();

const quizzes = new Map(); // quizId -> live quiz incl. answer key (kept server-side so players can't see answers)

// ---------- Helpers ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const contestById = (id) => db.contests.find((c) => c.id === id) || fail(404, "Contest not found");
// The signed-in player comes from the session cookie (set in the HTTP handler), never from the request body.
function requireUser(ctx) {
  return ctx.user || fail(401, "Please sign in first");
}
const isAdmin = (u) => Boolean(u?.email && ADMIN_EMAILS.has(u.email));
function newUser(email) {
  const key = "u_" + crypto.randomBytes(8).toString("hex");
  const name = email.split("@")[0].replace(/[^a-zA-Z0-9 ._-]/g, "").slice(0, 24) || "Player";
  db.users[key] = {
    key, email, name, coins: WELCOME_COINS, joined: {}, coupons: [], hasVipPass: false, done: {}, seen: {},
    stats: { quizPlays: 0, quizCorrect: 0, reviews: 0, ratings: 0, referrals: 0, purchases: 0, pointsEarned: 0, coinsEarned: WELCOME_COINS, coinsSpent: 0, contestsJoined: 0 },
    history: [{ t: Date.now(), what: "Welcome bonus", coins: WELCOME_COINS }],
    createdAt: Date.now(),
  };
  log("registered", { user: key });
  return db.users[key];
}
function log(type, data = {}) {
  db.events.push({ t: Date.now(), type, ...data });
  if (db.events.length > 5000) db.events.splice(0, db.events.length - 5000);
}
function activeJoins(u) {
  return Object.keys(u.joined).filter((id) => db.contests.find((c) => c.id === id && c.status === "live"));
}
function standings(c) {
  const real = Object.values(db.users)
    .filter((u) => u.joined[c.id])
    .map((u) => ({ name: u.name, points: u.joined[c.id].points, user: u.key }));
  return [...c.seedPlayers.map((p) => ({ name: p.name, points: p.points })), ...real]
    .sort((a, b) => b.points - a.points)
    .map((p, i) => ({ ...p, rank: i + 1, prize: prizeFor(c, i + 1) }));
}
function prizeFor(c, rank) {
  const p = c.prizes.find((x) => rank <= x.upTo);
  return p ? { coins: p.coins, note: p.note || "" } : null;
}
function credit(u, c, points, reason) {
  u.joined[c.id].points += points;
  u.stats.pointsEarned += points;
  log("points", { user: u.key, contestId: c.id, points, reason });
}
function publicUser(u) {
  if (!u) return null;
  const joined = Object.fromEntries(Object.entries(u.joined).map(([id, j]) => {
    const c = db.contests.find((x) => x.id === id);
    const rank = c ? standings(c).findIndex((p) => p.user === u.key) + 1 : null;
    return [id, { ...j, rank }];
  }));
  // Only ever sent to the player themself (via their own session).
  return { key: u.key, email: u.email, isAdmin: isAdmin(u), name: u.name, coins: u.coins, joined, stats: u.stats, coupons: u.coupons, hasVipPass: u.hasVipPass, done: u.done, history: u.history.slice(0, 50) };
}
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); // for spotting repeated questions
function avg(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function costOf(model, usage) {
  const p = PRICES[model];
  if (!p || !usage) return null;
  return (usage.input_tokens * p[0] + usage.output_tokens * p[1]) / 1e6;
}

// ---------- AI quiz generation ----------
const QuizSchema = z.object({
  questions: z.array(z.object({
    question: z.string(),
    options: z.array(z.string()),
    correct_index: z.number().int(),
    explanation: z.string(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    category: z.enum(["brand", "industry", "general"]),
  })),
});

const BRAND_FOCUS = {
  brand_mix: "Spread them across the brand's story, its products and best-sellers, and its upcoming launches and offers.",
  brand_story: "Focus on the brand's story and facts: founding year and city, founders, how it started, its promise, milestones, stores and values.",
  brand_products: "Focus on the brand's products: what they contain, how to use them, sizes, shades, prices, ratings and which products sell best.",
  brand_launches: "Focus on what's new and next: upcoming collections and launch dates, what's in them, who gets early access, plus current offers, shipping and returns.",
};
// How many questions of each category a play needs (5 questions in "mix" = 3 brand, 1 industry, 1 general).
function quotaFor(topic, count) {
  if (topic === "industry") return { brand: 0, industry: count, general: 0 };
  if (topic === "general") return { brand: 0, industry: 0, general: count };
  if (topic !== "mix") return { brand: count, industry: 0, general: 0 };
  const industry = Math.max(1, Math.round(count * 0.2));
  const general = count >= 4 ? Math.max(1, Math.round(count * 0.2)) : 0;
  return { brand: count - industry - general, industry, general };
}
// Everything the model may use: brand profile + live catalog stats (so "best-seller" and "top-rated" questions match the shop).
function brandBrief() {
  const products = db.products.map((p) => {
    const s = db.productStats[p.id];
    return { name: p.name, category: p.category, price_inr: p.price, details: p.details, purchases: s.purchases, reviews: s.reviews, avg_rating: Math.round(avg(s.ratings) * 10) / 10 };
  });
  return { brand: db.brand.name, industry: db.brand.industry, facts: db.brand.facts, products };
}
const DIFFICULTY_RULES = {
  easy: "All questions easy: most shoppers would know the answer.",
  medium: "All questions medium: needs some knowledge or careful reading.",
  hard: "All questions hard: needs close knowledge, but must still have one clearly correct answer.",
  mixed: "Mix difficulties: roughly 2 easy, 2 medium and 1 hard (scale proportionally).",
};

let client = null;
function claude() {
  if (!process.env.ANTHROPIC_API_KEY) fail(503, "AI quiz is not set up yet: add ANTHROPIC_API_KEY to the .env file and restart the server.");
  client ??= new Anthropic();
  return client;
}

async function generateQuiz({ topic, difficulty, count, avoid = [], contestId = null, purpose = "play" }) {
  const anthropic = claude();
  const dayStart = new Date().setHours(0, 0, 0, 0);
  if (db.aiUsage.filter((a) => a.t >= dayStart).length >= AI_DAILY_LIMIT) fail(429, "The quiz is very popular today; please try again tomorrow.");
  const quota = quotaFor(topic, count);
  // Spares: +1 for each of the two largest categories in the quota.
  const ask = { ...quota };
  const big = Object.keys(ask).filter((k) => ask[k] > 0).sort((a, b) => ask[b] - ask[a]);
  ask[big[0]] += 1; ask[big[1] || big[0]] += 1;
  const system = [
    `You write multiple-choice quiz questions for ${db.brand.name}'s shopping-rewards contest. Players earn contest points for correct answers, so every question must be accurate and fair. Each question has a category:`,
    `- "brand": about ${db.brand.name} itself (its story, people, products, best-sellers, launches, collections, offers or policies). Use ONLY facts stated in the brand brief; never invent dates, names, ingredients, prices, shades, launches or claims. Wrong options must be clearly false according to the brief.`,
    `- "industry": about the brand's industry (${db.brand.industry}), e.g. what common ingredients do, product types, how online shopping and delivery work. Only widely established facts; never about another specific company's prices, offers, launches or rumours.`,
    `- "general": family-friendly general knowledge (science, geography, food, sport, culture). Only well-established facts that won't change.`,
    "Rules: exactly 4 answer options per question, exactly one correct; no 'all/none of the above'; no trick wording; keep each question under 25 words and each option under 8 words; explanation is one short sentence (under 25 words) saying why the answer is right.",
    "Players never see the brief: never write 'the brief', 'according to the brief' or 'in the data' in a question or explanation. Write as the brand would, e.g. 'GlowCart's best-selling product is…'.",
    "Set each question's difficulty field honestly.",
  ].join("\n");
  const userMsg = [
    `Brand brief (JSON):\n${JSON.stringify(brandBrief())}`,
    // Ask for 2 spares (extra brand or category questions) so we can drop any duplicates of questions this player has already seen.
    `Write exactly ${count + 2} questions, all different from each other: ${Object.entries(ask).filter(([, n]) => n > 0).map(([k, n]) => `${n} with category "${k}"`).join(", ")}.`,
    quota.brand ? `For the brand questions: ${BRAND_FOCUS[topic] || BRAND_FOCUS.brand_mix}` : "",
    DIFFICULTY_RULES[difficulty],
    avoid.length ? `Do not repeat or closely paraphrase these questions the player has already seen:\n- ${avoid.join("\n- ")}` : "",
  ].filter(Boolean).join("\n\n");

  const started = Date.now();
  const record = { t: started, model: MODEL, purpose, contestId, topic, difficulty, count, ok: false };
  try {
    const response = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: userMsg }],
      output_config: { format: zodOutputFormat(QuizSchema) },
    });
    Object.assign(record, {
      ms: Date.now() - started,
      input_tokens: response.usage?.input_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0,
      costUSD: costOf(MODEL, response.usage),
      stop_reason: response.stop_reason,
    });
    if (response.stop_reason === "refusal") fail(502, "The AI declined to write this quiz. Try a different topic.");
    if (response.stop_reason === "max_tokens") fail(502, "The AI response was cut off. Please try again.");
    const parsed = response.parsed_output;
    if (!parsed) fail(502, "The AI returned questions in an unexpected format. Please try again.");
    const seen = new Set(avoid.map(norm));
    const valid = parsed.questions
      .filter((q) => q.options.length === 4 && q.correct_index >= 0 && q.correct_index < 4 && new Set(q.options).size === 4)
      .filter((q) => { const k = norm(q.question); if (seen.has(k)) return false; seen.add(k); return true; }) // no repeats
      .filter((q) => quota[q.category] > 0); // brand-only topics keep only brand questions, etc.
    // Fill each category up to its quota, then top up with any leftovers so a play always has `count` questions.
    const picked = [], left = { ...quota };
    for (const q of valid) if (left[q.category] > 0) { picked.push(q); left[q.category]--; }
    for (const q of valid) if (picked.length < count && !picked.includes(q)) picked.push(q);
    const questions = picked.slice(0, count)
      .sort(() => Math.random() - 0.5) // mix the categories through the quiz
      .map((q) => {
        // Shuffle options server-side so the correct answer isn't always in the same position.
        const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
        return { question: q.question, options: order.map((i) => q.options[i]), correct: order.indexOf(q.correct_index), explanation: q.explanation, difficulty: q.difficulty, category: q.category };
      });
    if (questions.length < count) fail(502, "The AI returned too few valid questions. Please try again.");
    record.ok = true;
    return questions;
  } catch (err) {
    record.ms ??= Date.now() - started;
    if (err instanceof HttpError) { record.error = err.message; throw err; }
    let msg = "The AI service is unavailable right now. Please try again.";
    if (err instanceof Anthropic.AuthenticationError) msg = "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.";
    else if (err instanceof Anthropic.PermissionDeniedError) msg = "This API key can't use the selected model. Check ANTHROPIC_MODEL in .env.";
    else if (err instanceof Anthropic.NotFoundError) msg = `Model "${MODEL}" was not found. Check ANTHROPIC_MODEL in .env.`;
    else if (err instanceof Anthropic.RateLimitError) msg = "Too many quiz requests right now. Wait a moment and try again.";
    else if (err instanceof Anthropic.BadRequestError) msg = /credit|billing/i.test(err.message) ? "Your Anthropic account is out of API credit. Add credit in the Console billing page." : "The quiz request was rejected by the AI service.";
    else if (err instanceof Anthropic.APIConnectionError) msg = "Couldn't reach the AI service. Check your internet connection.";
    record.error = msg;
    console.error("[quiz] generation failed:", err?.status ?? "", err?.message ?? err);
    throw new HttpError(502, msg);
  } finally {
    db.aiUsage.push(record);
    save();
  }
}

// ---------- Question pools (faster quiz) ----------
// Each contest keeps a few ready-made quiz sets, so most plays start instantly with no AI wait.
// A set can be served to many players (cheaper per play), but never to a player who has seen any of its questions.
// Sets are written by the same generateQuiz() rules, kept server-side with their answer key, and refilled in the background.
const POOL_TARGET = 6; // ready sets per contest
const POOL_MAX_USES = 25; // retire a set after this many plays so questions stay fresh
const poolKey = (c) => `${c.quiz.topic}|${c.quiz.difficulty}|${c.quiz.questions}`;
function poolFor(c) {
  // Changing the contest's quiz settings starts a fresh pool.
  if (db.pools[c.id]?.key !== poolKey(c)) db.pools[c.id] = { key: poolKey(c), sets: [] };
  return db.pools[c.id];
}
// Same questions, new order of questions and options (and a matching answer key) for each player.
function reshuffle(questions) {
  return questions.map((q) => {
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    return { ...q, options: order.map((i) => q.options[i]), correct: order.indexOf(q.correct) };
  }).sort(() => Math.random() - 0.5);
}
function takeFromPool(c, seenQuestions) {
  const seen = new Set(seenQuestions.map(norm));
  const pool = poolFor(c);
  const set = pool.sets.find((s) => s.questions.every((q) => !seen.has(norm(q.question))));
  if (!set) return null;
  set.uses++;
  if (set.uses >= POOL_MAX_USES) pool.sets.splice(pool.sets.indexOf(set), 1);
  return reshuffle(set.questions);
}
function addToPool(c, questions) {
  const pool = poolFor(c);
  if (pool.sets.length < POOL_TARGET) pool.sets.push({ questions, uses: 1, t: Date.now() });
}
const refilling = new Set();
// Adds one set in the background (never makes a player wait). Counts toward AI_DAILY_LIMIT and is logged in db.aiUsage.
async function refillPool(c) {
  if (refilling.has(c.id) || c.status !== "live" || !c.quiz.enabled || !process.env.ANTHROPIC_API_KEY) return;
  const pool = poolFor(c);
  if (pool.sets.length >= POOL_TARGET) return;
  refilling.add(c.id);
  try {
    const avoid = pool.sets.flatMap((s) => s.questions.map((q) => q.question)).slice(-60);
    const questions = await generateQuiz({ topic: c.quiz.topic, difficulty: c.quiz.difficulty, count: c.quiz.questions, avoid, contestId: c.id, purpose: "pool" });
    if (db.pools[c.id] === pool) { pool.sets.push({ questions, uses: 0, t: Date.now() }); save(); }
  } catch (err) {
    console.error(`[pool] refill for ${c.id} failed:`, err.message);
  } finally {
    refilling.delete(c.id);
  }
}
// Brand facts or catalog changed: old questions may be wrong now, so start every pool again.
function clearPools() { db.pools = {}; }

// ---------- Contest end (manual or automatic) ----------
// Pays coin prizes to real players by rank (seeded demo players hold ranks but get nothing).
function endContest(c, how = "manual") {
  const paid = [];
  for (const p of standings(c)) {
    if (!p.user || !p.prize?.coins) continue;
    const u = db.users[p.user];
    u.coins += p.prize.coins; u.stats.coinsEarned += p.prize.coins;
    u.history.unshift({ t: Date.now(), what: `Prize: #${p.rank} in ${c.name}${p.prize.note ? " " + p.prize.note : ""}`, coins: p.prize.coins });
    log("prize_paid", { user: u.key, contestId: c.id, rank: p.rank, coins: p.prize.coins });
    paid.push({ name: u.name, rank: p.rank, coins: p.prize.coins });
  }
  c.status = "ended";
  c.endedAt = Date.now();
  delete db.pools[c.id];
  log("contest_ended", { contestId: c.id, how, paid: paid.length });
  save();
  return paid;
}
// Contests whose end date has passed end themselves and pay out (checked at start-up and every minute).
function autoEndContests() {
  for (const c of db.contests) if (c.status === "live" && c.endsAt && c.endsAt <= Date.now()) endContest(c, "auto");
}
autoEndContests();
setInterval(autoEndContests, 60_000).unref();

// ---------- Player API ----------
const routes = {
  "GET /api/health": () => ({ ok: true, storage: store.kind }),

  "GET /api/state": (q, b, ctx) => {
    const me = ctx.user || null;
    return {
      brand: db.brand,
      actions: ACTIONS,
      topics: TOPICS,
      maxActiveContests: MAX_ACTIVE_CONTESTS,
      model: MODEL,
      contests: db.contests.map((c) => ({
        ...c, seedPlayers: undefined, players: standings(c).length, leaderboard: standings(c),
      })),
      products: db.products.map((p) => {
        const s = db.productStats[p.id];
        return { ...p, reviews: s.reviews, avgRating: Math.round(avg(s.ratings) * 10) / 10, ratingCount: s.ratings.length, purchases: s.purchases };
      }),
      shop: db.shop,
      me: publicUser(me),
      general: generalLeaderboard(),
    };
  },

  // Step 1 of sign-in: email a one-time link. Same reply whether or not the email has an account.
  "POST /api/auth/request": async (_, b, ctx) => {
    // Classmates on one Wi-Fi share a public IP, so real sign-ins get a generous per-connection allowance,
    // while invalid/junk requests (bots, scripts) get a strict one. Each email is limited separately too.
    const email = auth.normalizeEmail(b.email);
    if (!email) { limit(`login:bad:${ctx.ip}`, 5, 15 * 60_000); fail(400, "Enter a valid email address"); }
    limit(`login:ip:${ctx.ip}`, 40, 15 * 60_000);
    limit(`login:email:${email}`, 3, 15 * 60_000);
    // Housekeeping: forget expired links and sessions.
    for (const [k, v] of Object.entries(db.loginTokens)) if (v.exp < Date.now()) delete db.loginTokens[k];
    for (const [k, v] of Object.entries(db.sessions)) if (v.exp < Date.now()) delete db.sessions[k];
    const token = auth.newToken();
    db.loginTokens[auth.hashToken(token)] = { email, exp: Date.now() + auth.LOGIN_TOKEN_TTL_MS };
    save();
    const link = `${APP_URL}/auth/verify?token=${token}`;
    let sent;
    try { ({ sent } = await auth.sendMagicLink({ to: email, link, brand: db.brand.name })); }
    catch { fail(502, "We couldn't send the sign-in email right now. Please try again in a minute."); }
    // Local development only: hand the link back so you can test without an email service.
    return { ok: true, sent, ...(!sent && !IS_PROD ? { devLink: link } : {}) };
  },

  // Step 2: the link's page posts the token here; we swap it for a session cookie.
  "POST /api/auth/verify": (_, b, ctx) => {
    limit(`verify:ip:${ctx.ip}`, 20, 15 * 60_000);
    const h = auth.hashToken(b.token);
    const t = db.loginTokens[h];
    delete db.loginTokens[h]; // one-time use
    if (!t || t.exp < Date.now()) { save(); fail(400, "This sign-in link has expired or was already used. Request a new one."); }
    const u = Object.values(db.users).find((x) => x.email === t.email) || newUser(t.email);
    const session = auth.newToken();
    db.sessions[auth.hashToken(session)] = { user: u.key, exp: Date.now() + auth.SESSION_TTL_MS };
    log("signed_in", { user: u.key });
    save();
    ctx.setCookie(auth.sessionCookie(session, { secure: IS_PROD, maxAgeMs: auth.SESSION_TTL_MS }));
    return { ok: true, next: isAdmin(u) && b.next === "/admin" ? "/admin" : "/" };
  },

  "POST /api/auth/logout": (_, b, ctx) => {
    if (ctx.sessionHash) { delete db.sessions[ctx.sessionHash]; save(); }
    ctx.setCookie(auth.sessionCookie("", { secure: IS_PROD, maxAgeMs: 0 }));
    return { ok: true };
  },

  "POST /api/profile": (_, b, ctx) => {
    const u = requireUser(ctx);
    const name = String(b.name || "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 24);
    if (name.length < 2) fail(400, "Pick a name of 2–24 letters or numbers");
    // No impersonation on leaderboards: a name already used by another player (real or demo) is taken.
    const taken = (n) => n.toLowerCase() === name.toLowerCase();
    if (Object.values(db.users).some((x) => x.key !== u.key && taken(x.name)) || db.contests.some((c) => c.seedPlayers.some((p) => taken(p.name))))
      fail(409, "That name is taken. Pick another one.");
    u.name = name;
    save();
    return publicUser(u);
  },

  "POST /api/join": (_, b, ctx) => {
    const u = requireUser(ctx), c = contestById(b.contestId);
    if (c.status !== "live") fail(400, "This contest has ended");
    if (u.joined[c.id]) return publicUser(u);
    if (activeJoins(u).length >= MAX_ACTIVE_CONTESTS) fail(400, `You can be in at most ${MAX_ACTIVE_CONTESTS} live contests at a time`);
    if (c.entry.type === "pass" && !u.hasVipPass) fail(400, "Needs a VIP Contest Entry Pass from the Rewards Shop");
    if (c.entry.type === "coins") {
      if (u.coins < c.entry.fee) fail(400, `Need ${c.entry.fee} coins to enter`);
      u.coins -= c.entry.fee; u.stats.coinsSpent += c.entry.fee;
      u.history.unshift({ t: Date.now(), what: `Entry fee: ${c.name}`, coins: -c.entry.fee });
    }
    u.joined[c.id] = { points: 0, plays: 0, bestQuiz: null, joinedAt: Date.now() };
    u.stats.contestsJoined++;
    log("joined", { user: u.key, contestId: c.id, fee: c.entry.type === "coins" ? c.entry.fee : 0 });
    save();
    return publicUser(u);
  },

  // Rewards Shop "Earn" actions: points go to every joined live contest that scores this action.
  "POST /api/action": (_, b, ctx) => {
    const u = requireUser(ctx);
    limit(`action:${u.key}`, 30, 60_000);
    const type = b.type;
    if (!["review", "photo", "rating", "referral", "purchase"].includes(type)) fail(400, "Unknown action");
    const p = db.products.find((x) => x.id === b.productId) || fail(404, "Product not found");
    const doneKey = `${type}:${p.id}`;
    if (["review", "photo", "rating"].includes(type) && u.done[doneKey]) fail(400, "Already done for this product");
    if (type === "review") {
      const words = String(b.text || "").trim().split(/\s+/).filter(Boolean).length;
      if (words < 30) fail(400, `Reviews need 30+ words (you wrote ${words})`);
      db.productStats[p.id].reviews++; u.stats.reviews++;
    }
    if (type === "rating") {
      const stars = Number(b.stars);
      if (!(stars >= 1 && stars <= 5)) fail(400, "Pick 1–5 stars");
      db.productStats[p.id].ratings.push(stars); u.stats.ratings++;
    }
    if (type === "referral") u.stats.referrals++;
    if (type === "purchase") { db.productStats[p.id].purchases++; u.stats.purchases++; }
    u.done[doneKey] = (u.done[doneKey] || 0) + 1;

    const credited = [];
    for (const id of activeJoins(u)) {
      const c = contestById(id);
      const pts = c.scoring[type] || 0;
      if (pts > 0) { credit(u, c, pts, `${ACTIONS[type]}: ${p.name}`); credited.push({ contestId: c.id, contest: c.name, points: pts }); }
    }
    log("action", { user: u.key, action: type, productId: p.id, credited: credited.length });
    save();
    return { me: publicUser(u), credited };
  },

  "POST /api/quiz/start": async (_, b, ctx) => {
    const u = requireUser(ctx), c = contestById(b.contestId);
    limit(`quiz:user:${u.key}`, 10, 10 * 60_000);
    limit(`quiz:ip:${ctx.ip}`, 100, 10 * 60_000); // shared Wi-Fi: per-player limit above + daily AI cap protect cost
    const j = u.joined[c.id] || fail(400, "Join this contest first");
    if (c.status !== "live") fail(400, "This contest has ended");
    if (!c.quiz.enabled) fail(400, "This contest has no quiz");
    if (j.plays >= c.quiz.maxPlays) fail(400, `No quiz plays left (max ${c.quiz.maxPlays})`);
    const avoid = (u.seen[c.id] || []).slice(-60); // every question this player saw in this contest (5 plays x 5 = 25)
    // Fast path: a ready-made set this player hasn't seen. Otherwise write one now (and keep it for other players).
    let questions = takeFromPool(c, avoid);
    const source = questions ? "pool" : "live";
    if (!questions) {
      questions = await generateQuiz({ topic: c.quiz.topic, difficulty: c.quiz.difficulty, count: c.quiz.questions, avoid, contestId: c.id });
      addToPool(c, questions);
    }
    refillPool(c); // background top-up, not awaited
    // A play is used only once questions were generated successfully.
    j.plays++; u.stats.quizPlays++;
    u.seen[c.id] = [...(u.seen[c.id] || []), ...questions.map((q) => q.question)].slice(-60);
    const id = crypto.randomUUID();
    quizzes.set(id, { id, user: u.key, contestId: c.id, questions, answers: [], finished: false });
    log("quiz_started", { user: u.key, contestId: c.id, play: j.plays, source });
    save();
    return {
      quizId: id, play: j.plays, maxPlays: c.quiz.maxPlays, topic: TOPICS[c.quiz.topic], difficulty: c.quiz.difficulty,
      pointsPerCorrect: c.scoring.quiz_correct, perfectBonus: c.scoring.quiz_perfect,
      questions: questions.map(({ question, options, difficulty, category }) => ({ question, options, difficulty, category })),
    };
  },

  "POST /api/quiz/answer": (_, b, ctx) => {
    const u = requireUser(ctx);
    const qz = quizzes.get(b.quizId) || fail(404, "Quiz not found or expired");
    if (qz.user !== u.key) fail(403, "This isn't your quiz");
    const i = Number(b.index), choice = Number(b.choice);
    const q = qz.questions[i] || fail(400, "Bad question");
    if (qz.answers[i] !== undefined) fail(400, "Already answered");
    qz.answers[i] = choice;
    const correct = choice === q.correct;
    log("quiz_answer", { user: qz.user, contestId: qz.contestId, correct });
    return { correct, correctIndex: q.correct, explanation: q.explanation };
  },

  "POST /api/quiz/finish": (_, b, ctx) => {
    const me = requireUser(ctx);
    const qz = quizzes.get(b.quizId) || fail(404, "Quiz not found or expired");
    if (qz.user !== me.key) fail(403, "This isn't your quiz");
    if (qz.finished) fail(400, "Quiz already finished");
    qz.finished = true;
    const u = db.users[qz.user], c = contestById(qz.contestId), j = u.joined[c.id];
    const correct = qz.questions.filter((q, i) => qz.answers[i] === q.correct).length;
    const total = qz.questions.length;
    const perfect = correct === total;
    const points = correct * (c.scoring.quiz_correct || 0) + (perfect ? c.scoring.quiz_perfect || 0 : 0);
    if (points > 0) credit(u, c, points, `Quiz: ${correct}/${total} correct${perfect ? " (perfect!)" : ""}`);
    u.stats.quizCorrect += correct;
    j.bestQuiz = Math.max(j.bestQuiz ?? 0, correct);
    log("quiz_completed", { user: u.key, contestId: c.id, correct, total, points });
    quizzes.delete(qz.id);
    save();
    return { correct, total, perfect, points, playsLeft: c.quiz.maxPlays - j.plays, me: publicUser(u) };
  },

  "POST /api/redeem": (_, b, ctx) => {
    const u = requireUser(ctx);
    const item = db.shop.find((x) => x.id === b.itemId) || fail(404, "Item not found");
    if (item.stock <= 0) fail(400, "Out of stock");
    if (u.coins < item.cost) fail(400, `Need ${item.cost - u.coins} more coins`);
    u.coins -= item.cost; u.stats.coinsSpent += item.cost; item.stock--;
    const code = "CRX-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    u.coupons.unshift({ code, name: item.name, t: Date.now() });
    if (item.grantsPass) u.hasVipPass = true;
    u.history.unshift({ t: Date.now(), what: `Redeemed: ${item.name}`, coins: -item.cost });
    log("redeemed", { user: u.key, itemId: item.id, coins: item.cost });
    save();
    return { me: publicUser(u), code };
  },
};

function generalLeaderboard() {
  const users = Object.values(db.users);
  const top = (fn, n = 5) => users.map((u) => ({ name: u.name, value: fn(u) })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, n);
  const prods = db.products.map((p) => ({ name: `${p.emoji} ${p.name}`, s: db.productStats[p.id] }));
  return {
    mostPoints: top((u) => u.stats.pointsEarned),
    mostQuizPlays: top((u) => u.stats.quizPlays),
    mostCoinsEarned: top((u) => u.stats.coinsEarned - WELCOME_COINS),
    mostReviewedProducts: prods.map((p) => ({ name: p.name, value: p.s.reviews })).sort((a, b) => b.value - a.value),
    topRatedProducts: prods.map((p) => ({ name: p.name, value: Math.round(avg(p.s.ratings) * 10) / 10, count: p.s.ratings.length })).sort((a, b) => b.value - a.value),
  };
}

// ---------- Admin API (only signed-in emails listed in ADMIN_EMAILS; enforced in the HTTP handler) ----------
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : d);

Object.assign(routes, {
  "GET /api/admin/overview": () => {
    const users = Object.values(db.users);
    const ev = db.events;
    const count = (t) => ev.filter((e) => e.type === t).length;
    const ai = db.aiUsage;
    const okAi = ai.filter((a) => a.ok);
    const quizDone = ev.filter((e) => e.type === "quiz_completed");
    const lastSeen = {};
    for (const e of ev) if (e.user) lastSeen[e.user] = e.t;
    return {
      model: MODEL,
      aiReady: Boolean(process.env.ANTHROPIC_API_KEY),
      totals: {
        users: users.length,
        liveContests: db.contests.filter((c) => c.status === "live").length,
        joins: count("joined"),
        quizPlays: count("quiz_started"),
        avgQuizScore: quizDone.length ? Math.round((quizDone.reduce((s, e) => s + e.correct / e.total, 0) / quizDone.length) * 100) : null,
        pointsAwarded: ev.filter((e) => e.type === "points").reduce((s, e) => s + e.points, 0),
        coinsPaidOut: ev.filter((e) => e.type === "prize_paid").reduce((s, e) => s + e.coins, 0),
        coinsRedeemed: ev.filter((e) => e.type === "redeemed").reduce((s, e) => s + e.coins, 0),
        redemptions: count("redeemed"),
        reviews: ev.filter((e) => e.type === "action" && e.action === "review").length,
      },
      contests: db.contests.map((c) => {
        const ce = ev.filter((e) => e.contestId === c.id);
        const lb = standings(c);
        const firstReal = lb.find((p) => p.user);
        return {
          ...c, seedPlayers: undefined,
          realPlayers: users.filter((u) => u.joined[c.id]).length,
          quizPlays: ce.filter((e) => e.type === "quiz_started").length,
          pointsAwarded: ce.filter((e) => e.type === "points").reduce((s, e) => s + e.points, 0),
          coinsPaid: ce.filter((e) => e.type === "prize_paid").reduce((s, e) => s + e.coins, 0),
          leader: lb[0], bestRealPlayer: firstReal || null,
          pool: { sets: db.pools[c.id]?.key === poolKey(c) ? db.pools[c.id].sets.length : 0, target: POOL_TARGET, fromPool: ce.filter((e) => e.type === "quiz_started" && e.source === "pool").length },
        };
      }),
      users: users.map((u) => ({ name: u.name, email: u.email || "(demo, no sign-in)", coins: u.coins, contests: Object.keys(u.joined).length, ...u.stats, joinedAt: u.createdAt, lastSeen: lastSeen[u.key] || u.createdAt }))
        .sort((a, b) => b.pointsEarned - a.pointsEarned),
      products: routes["GET /api/state"]({}, {}, {}).products,
      shop: db.shop,
      ai: {
        calls: ai.length, ok: okAi.length, failed: ai.length - okAi.length,
        totalCostUSD: okAi.reduce((s, a) => s + (a.costUSD || 0), 0),
        avgCostUSD: okAi.length ? okAi.reduce((s, a) => s + (a.costUSD || 0), 0) / okAi.length : null,
        avgMs: okAi.length ? Math.round(avg(okAi.map((a) => a.ms))) : null,
        recent: ai.slice(-10).reverse(),
      },
      recentEvents: ev.slice(-25).reverse().map((e) => ({ ...e, user: e.user ? db.users[e.user]?.name ?? e.user : undefined })),
      topics: TOPICS, difficulties: DIFFICULTIES, actions: ACTIONS, brand: db.brand,
    };
  },

  // Create or update a contest (brand launches contests here).
  "POST /api/admin/contest": (_, b) => {
    const isNew = !b.id;
    const c = isNew ? null : contestById(b.id);
    const name = String(b.name || "").trim() || fail(400, "Contest needs a name");
    const topic = TOPICS[b.quiz?.topic] ? b.quiz.topic : DEFAULT_TOPIC;
    const difficulty = DIFFICULTIES.includes(b.quiz?.difficulty) ? b.quiz.difficulty : "mixed";
    const entryType = ["free", "coins", "pass"].includes(b.entry?.type) ? b.entry.type : "free";
    const prizes = (Array.isArray(b.prizes) ? b.prizes : []).map((p) => ({ upTo: num(p.upTo, 1) || 1, coins: num(p.coins), note: String(p.note || "").slice(0, 60) }))
      .filter((p) => p.coins > 0 || p.note).sort((a, x) => a.upTo - x.upTo);
    const scoring = Object.fromEntries(Object.keys(ACTIONS).map((k) => [k, num(b.scoring?.[k])]));
    const days = Math.min(90, Math.max(1, num(b.days, 7)));
    const fields = {
      name, desc: String(b.desc || "").slice(0, 200),
      entry: { type: entryType, fee: entryType === "coins" ? num(b.entry?.fee, 50) : 0 },
      prizes: prizes.length ? prizes : [{ upTo: 1, coins: 500 }],
      scoring,
      quiz: { enabled: Boolean(b.quiz?.enabled), topic, difficulty, questions: Math.min(10, Math.max(3, num(b.quiz?.questions, 5))), maxPlays: Math.min(20, Math.max(1, num(b.quiz?.maxPlays, 5))) },
    };
    fields.tag = `${entryType === "free" ? "FREE ENTRY" : entryType === "coins" ? `${fields.entry.fee}-COIN ENTRY` : "VIP PASS"} · ${days} days`;
    if (isNew) {
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) + "-" + crypto.randomBytes(2).toString("hex");
      db.contests.push({ id, status: "live", endsAt: Date.now() + days * 86400000, seedPlayers: [], ...fields });
      log("contest_launched", { contestId: id });
    } else {
      Object.assign(c, fields);
      if (b.days) c.endsAt = Date.now() + days * 86400000;
      log("contest_updated", { contestId: c.id });
    }
    save();
    return { ok: true };
  },

  // End a contest now and pay coin prizes (contests also end by themselves at their end date).
  "POST /api/admin/contest/end": (_, b) => {
    const c = contestById(b.id);
    if (c.status !== "live") fail(400, "Already ended");
    return { paid: endContest(c, "manual") };
  },

  // Fill a contest's question pool now (one AI call per set), so the first players don't wait.
  "POST /api/admin/pool/refill": async (_, b, ctx) => {
    limit(`pool:${ctx.user.key}`, 10, 60 * 60_000);
    const c = contestById(b.id);
    if (c.status !== "live" || !c.quiz.enabled) fail(400, "Only live contests with a quiz have a question pool");
    await refillPool(c);
    return { sets: poolFor(c).sets.length };
  },

  // Brand profile editor: the only brand facts the AI quiz may use.
  "POST /api/admin/brand": (_, b) => {
    const facts = (Array.isArray(b.facts) ? b.facts : String(b.facts || "").split("\n"))
      .map((f) => String(f).trim().slice(0, 240)).filter(Boolean).slice(0, 40);
    if (facts.length < 3) fail(400, "Add at least 3 brand facts (one per line)");
    db.brand.name = String(b.name || "").trim().slice(0, 40) || db.brand.name;
    db.brand.industry = String(b.industry || "").trim().slice(0, 100) || db.brand.industry;
    db.brand.facts = facts;
    clearPools();
    log("brand_updated", { facts: facts.length });
    save();
    return { ok: true };
  },

  // Product catalog editor: products players review/rate/buy, and the brand quiz's product facts.
  "POST /api/admin/product": (_, b) => {
    const name = String(b.name || "").trim().slice(0, 60) || fail(400, "Product needs a name");
    const fields = {
      name, emoji: String(b.emoji || "🛍️").slice(0, 4), price: num(b.price),
      category: String(b.category || "Products").trim().slice(0, 30), details: String(b.details || "").trim().slice(0, 400),
    };
    if (b.id) Object.assign(db.products.find((x) => x.id === b.id) || fail(404, "Product not found"), fields);
    else {
      const id = "p" + crypto.randomBytes(3).toString("hex");
      db.products.push({ id, ...fields });
      db.productStats[id] = { reviews: 0, ratings: [], purchases: 0 };
    }
    clearPools();
    log(b.id ? "product_updated" : "product_added", { item: name });
    save();
    return { ok: true };
  },

  "POST /api/admin/product/delete": (_, b) => {
    const i = db.products.findIndex((x) => x.id === b.id);
    if (i < 0) fail(404, "Product not found");
    if (db.products.length <= 1) fail(400, "Keep at least one product");
    log("product_removed", { item: db.products[i].name });
    delete db.productStats[db.products[i].id];
    db.products.splice(i, 1);
    clearPools();
    save();
    return { ok: true };
  },

  "POST /api/admin/shop": (_, b) => {
    const name = String(b.name || "").trim() || fail(400, "Item needs a name");
    const fields = { name, category: String(b.category || "Products").slice(0, 20), emoji: String(b.emoji || "🎁").slice(0, 4), cost: num(b.cost, 100) || 1, stock: num(b.stock, 10), grantsPass: Boolean(b.grantsPass) };
    if (b.id) Object.assign(db.shop.find((x) => x.id === b.id) || fail(404, "Item not found"), fields);
    else db.shop.push({ id: "s" + crypto.randomBytes(3).toString("hex"), ...fields });
    log(b.id ? "shop_item_updated" : "shop_item_added", { item: name });
    save();
    return { ok: true };
  },

  "POST /api/admin/shop/delete": (_, b) => {
    const i = db.shop.findIndex((x) => x.id === b.id);
    if (i < 0) fail(404, "Item not found");
    log("shop_item_removed", { item: db.shop[i].name });
    db.shop.splice(i, 1);
    save();
    return { ok: true };
  },

  // Let the brand preview what the AI writes for a topic/difficulty before launching.
  "POST /api/admin/quiz-preview": async (_, b, ctx) => {
    limit(`preview:${ctx.user.key}`, 10, 60 * 60_000);
    const topic = TOPICS[b.topic] ? b.topic : DEFAULT_TOPIC;
    const difficulty = DIFFICULTIES.includes(b.difficulty) ? b.difficulty : "mixed";
    const questions = await generateQuiz({ topic, difficulty, count: Math.min(10, Math.max(3, num(b.questions, 5))), purpose: "admin_preview" });
    return { questions };
  },

  // Demo reset wipes everything, so it only works locally.
  "POST /api/admin/reset": () => {
    if (IS_PROD) fail(403, "Reset is disabled on the live site");
    db = seed(); quizzes.clear(); save(); return { ok: true };
  },
});

// ---------- HTTP server ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

// Throws 429 when a key goes over its limit (see lib/ratelimit.js).
function limit(key, max, windowMs) {
  const r = hit(key, max, windowMs);
  if (!r.ok) { const e = new HttpError(429, `Too many requests. Try again in ${r.retryAfterSec} s.`); e.retryAfter = r.retryAfterSec; throw e; }
}

// Browser security headers on every response.
function securityHeaders(res) {
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://us-assets.i.posthog.com", // inline handlers + PostHog
    "connect-src 'self' https://us.i.posthog.com https://us-assets.i.posthog.com",
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:", // PostHog session replay
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join("; "));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (IS_PROD) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

function clientIp(req) {
  if (TRUST_PROXY && req.headers["x-forwarded-for"]) return String(req.headers["x-forwarded-for"]).split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

// Who is calling: looks up the session cookie (hashed) and drops expired sessions.
function sessionUser(req) {
  const token = auth.parseCookies(req.headers.cookie)[auth.SESSION_COOKIE];
  if (!token) return {};
  const h = auth.hashToken(token);
  const s = db.sessions[h];
  if (!s || s.exp < Date.now() || !db.users[s.user]) { if (s) { delete db.sessions[h]; save(); } return {}; }
  return { user: db.users[s.user], sessionHash: h };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (ch) => { data += ch; if (data.length > 100_000) { reject(new HttpError(413, "Request too large")); req.destroy(); } });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new HttpError(400, "Invalid JSON")); } });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    const handler = routes[`${req.method} ${url.pathname}`];
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    if (!handler) { res.writeHead(404); return res.end(JSON.stringify({ error: "Not found" })); }
    const cookies = [];
    const ctx = { ip: clientIp(req), ...sessionUser(req), setCookie: (c) => cookies.push(c) };
    try {
      limit(`api:ip:${ctx.ip}`, 300, 60_000); // general cap per visitor
      if (req.method === "POST") {
        // CSRF defence: only accept JSON posted from our own pages.
        if (!String(req.headers["content-type"] || "").startsWith("application/json")) fail(415, "Send JSON");
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) fail(403, "Cross-site request blocked");
      }
      if (url.pathname.startsWith("/api/admin/")) {
        if (!ctx.user) fail(401, "Sign in to use the admin panel");
        if (!isAdmin(ctx.user)) fail(403, "This account isn't a brand admin");
      }
      const body = req.method === "POST" ? await readBody(req) : {};
      const out = await handler(Object.fromEntries(url.searchParams), body, ctx);
      if (cookies.length) res.setHeader("Set-Cookie", cookies);
      res.writeHead(200); res.end(JSON.stringify(out));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (err.retryAfter) res.setHeader("Retry-After", String(err.retryAfter));
      if (cookies.length) res.setHeader("Set-Cookie", cookies);
      res.writeHead(status); res.end(JSON.stringify({ error: status === 500 ? "Server error" : err.message }));
    }
    return;
  }
  const pages = { "/": "/index.html", "/admin": "/admin.html", "/auth/verify": "/verify.html" };
  const file = pages[url.pathname] || url.pathname;
  const full = path.join(APP_DIR, path.normalize(decodeURIComponent(file)));
  if (!full.startsWith(APP_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(full)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use: the app is probably already running. Open http://localhost:${PORT}\nTo run a second copy, use another port:  PORT=3001 npm start`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`Credexon League running (${IS_PROD ? "production" : "development"}, storage: ${store.kind}):\n  Player app:  ${APP_URL}\n  Brand admin: ${APP_URL}/admin`);
  console.log(`  Admins: ${ADMIN_EMAILS.size ? [...ADMIN_EMAILS].join(", ") : "none set (add ADMIN_EMAILS to .env)"} · email: ${process.env.BREVO_API_KEY ? "Brevo" : "links printed here (no BREVO_API_KEY)"}`);
  console.log(`  AI quiz model: ${MODEL} (${process.env.ANTHROPIC_API_KEY ? "API key loaded" : "NO API KEY — add ANTHROPIC_API_KEY to .env"})`);
});

// Save pending changes before Render stops or restarts the app.
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, async () => { await store.close(); process.exit(0); });
