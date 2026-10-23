const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");

const PORT = process.env.PORT || 3001;
const DB_PATH = path.join(__dirname, "data.db");

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "1kb" }));
app.use(express.static(path.join(__dirname, "public")));

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS pig_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    count INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const insertEvent = db.prepare("INSERT INTO pig_events (count) VALUES (?)");
const sumTotal = db.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM pig_events");
const sumToday = db.prepare(`
  SELECT COALESCE(SUM(count), 0) AS n
  FROM pig_events
  WHERE date(created_at, 'localtime') = date('now', 'localtime')
`);

function getStats() {
  return {
    totalPigs: sumTotal.get().n,
    todayPigs: sumToday.get().n,
  };
}

const postHits = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 30;

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function limitPigPosts(req, res, next) {
  const ip = clientIp(req);
  const now = Date.now();
  let stamps = postHits.get(ip) || [];
  stamps = stamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (stamps.length >= RATE_MAX) {
    postHits.set(ip, stamps);
    return res.status(429).json({ ok: false, error: "rate_limited" });
  }
  stamps.push(now);
  postHits.set(ip, stamps);
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, stamps] of postHits) {
    const next = stamps.filter((t) => now - t < RATE_WINDOW_MS);
    if (next.length === 0) postHits.delete(ip);
    else postHits.set(ip, next);
  }
}, 60 * 1000).unref();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/stats", (_req, res) => {
  res.json(getStats());
});

app.post("/api/stats/pigs", limitPigPosts, (req, res) => {
  const count = req.body && req.body.count;
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    return res.status(400).json({ ok: false, error: "invalid_count" });
  }
  insertEvent.run(count);
  const stats = getStats();
  res.json({ ok: true, totalPigs: stats.totalPigs, todayPigs: stats.todayPigs });
});

app.listen(PORT, () => {
  console.log(`pixel pig catch listening on ${PORT}`);
});
