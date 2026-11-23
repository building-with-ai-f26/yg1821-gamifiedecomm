// Storage for the app's state (contests, players, points, coins, shop, logs).
// - Production (DATABASE_URL set, e.g. Neon Postgres): the whole state lives in one JSONB row of table `app_state`.
// - Local development (no DATABASE_URL): the state lives in data/db.json, like Build 2.
// Saves are batched (at most every 250 ms) so a burst of actions makes one database write.
import fs from "node:fs";
import path from "node:path";

export async function createStore({ file, databaseUrl }) {
  if (!databaseUrl) return fileStore(file);
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
  await pool.query(
    "create table if not exists app_state (id int primary key, data jsonb not null, updated_at timestamptz not null default now())"
  );

  let latest = null; // most recent state handed to save()
  let timer = null;
  let writing = Promise.resolve();

  const flush = () => {
    timer = null;
    if (!latest) return writing;
    const json = JSON.stringify(latest);
    latest = null;
    writing = writing
      .then(() => pool.query(
        "insert into app_state (id, data, updated_at) values (1, $1::jsonb, now()) on conflict (id) do update set data = excluded.data, updated_at = now()",
        [json]
      ))
      .catch((err) => console.error("[store] save failed:", err.message));
    return writing;
  };

  return {
    kind: "postgres",
    async load() {
      const r = await pool.query("select data from app_state where id = 1");
      return r.rows[0]?.data ?? null;
    },
    save(state) {
      latest = state;
      timer ??= setTimeout(flush, 250);
    },
    async close() {
      clearTimeout(timer);
      await flush();
      await pool.end();
    },
  };
}

function fileStore(file) {
  return {
    kind: "file",
    async load() {
      try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
    },
    save(state) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
    },
    async close() {},
  };
}
