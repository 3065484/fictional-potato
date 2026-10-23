const path = require("path");
const express = require("express");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3001;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "1kb" }));
app.use(express.static(path.join(__dirname, "public")));

const STATS_SQL = `
  SELECT SUM(count) AS total,
         SUM(CASE WHEN created_at >= CURRENT_DATE THEN count ELSE 0 END) AS today
  FROM pig_events
`;

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pig_events (
      id SERIAL PRIMARY KEY,
      count INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function getStats() {
  const { rows } = await pool.query(STATS_SQL);
  const row = rows[0] || {};
  const totalPigs = Number(row.total) || 0;
  const todayPigs = Number(row.today) || 0;
  return { totalPigs, todayPigs };
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

pool.on("error", (err) => {
  console.error("unexpected postgres pool error", err);
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/stats", async (_req, res) => {
  try {
    const stats = await getStats();
    res.json({ totalPigs: stats.totalPigs, todayPigs: stats.todayPigs });
  } catch (err) {
    console.error("failed to read stats", err);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.post("/api/stats/pigs", limitPigPosts, async (req, res) => {
  const count = req.body && req.body.count;
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    return res.status(400).json({ ok: false, error: "invalid_count" });
  }
  try {
    await pool.query("INSERT INTO pig_events (count) VALUES ($1)", [count]);
    const stats = await getStats();
    res.json({ ok: true, totalPigs: stats.totalPigs, todayPigs: stats.todayPigs });
  } catch (err) {
    console.error("failed to record pig event", err);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

async function start() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  await initDb();
  app.listen(PORT, () => {
    console.log(`pixel pig catch listening on ${PORT}`);
  });
}

start().catch((err) => {
  console.error("failed to start server", err);
  process.exit(1);
});
