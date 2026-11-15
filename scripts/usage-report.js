// Prints AI cost, tokens and latency from the local app's log (data/db.json).
// Run: npm run usage    — copy the numbers into the build log / PRD "cost per run".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "db.json");
if (!fs.existsSync(file)) {
  console.log("No data yet: start the app (npm start) and play a quiz first.");
  process.exit(0);
}
const { aiUsage = [], events = [] } = JSON.parse(fs.readFileSync(file, "utf8"));
const ok = aiUsage.filter((a) => a.ok);
const sum = (arr, k) => arr.reduce((s, a) => s + (a[k] || 0), 0);
const money = (n) => "$" + n.toFixed(5);

console.log("AI quiz usage (local log)");
console.log("-------------------------");
console.log(`Calls: ${aiUsage.length} (${ok.length} ok, ${aiUsage.length - ok.length} failed)`);
if (ok.length) {
  console.log(`Models: ${[...new Set(ok.map((a) => a.model))].join(", ")}`);
  console.log(`Tokens: ${sum(ok, "input_tokens")} in / ${sum(ok, "output_tokens")} out`);
  console.log(`Avg tokens per quiz: ${Math.round(sum(ok, "input_tokens") / ok.length)} in / ${Math.round(sum(ok, "output_tokens") / ok.length)} out`);
  console.log(`Total cost: ${money(sum(ok, "costUSD"))}   Avg cost per quiz: ${money(sum(ok, "costUSD") / ok.length)}`);
  console.log(`Avg generation time: ${(sum(ok, "ms") / ok.length / 1000).toFixed(1)}s`);
}
const failed = aiUsage.filter((a) => !a.ok);
if (failed.length) console.log(`Failures: ${[...new Set(failed.map((a) => a.error))].join(" | ")}`);
const plays = events.filter((e) => e.type === "quiz_completed");
if (plays.length) console.log(`Quizzes completed: ${plays.length}, avg score ${Math.round((plays.reduce((s, e) => s + e.correct / e.total, 0) / plays.length) * 100)}%`);
