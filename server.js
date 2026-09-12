const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error(
    "Missing DATABASE_URL. On Railway, add a PostgreSQL plugin to this project — " +
      "it sets DATABASE_URL automatically. Locally, set it in a .env file or your shell."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
      ? { rejectUnauthorized: false }
      : false,
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------
// Schema
// ---------------------------------------------------------------
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS season_meta (
      id INT PRIMARY KEY DEFAULT 1,
      season_name TEXT NOT NULL DEFAULT 'Dancing From the Couch',
      active_week_id INT
    );
  `);
  await pool.query(`
    INSERT INTO season_meta (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING;
  `);
  // clean up columns from an earlier design where the host also entered scores
  await pool.query(`ALTER TABLE season_meta DROP COLUMN IF EXISTS num_judges;`);
  await pool.query(`ALTER TABLE season_meta DROP COLUMN IF EXISTS judge_max;`);
  await pool.query(`ALTER TABLE season_meta DROP COLUMN IF EXISTS points_per_vote;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contestants (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      partner TEXT DEFAULT '',
      eliminated BOOLEAN NOT NULL DEFAULT FALSE,
      eliminated_week_label TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weeks (
      id SERIAL PRIMARY KEY,
      order_num INT NOT NULL,
      label TEXT NOT NULL,
      dance_night TEXT DEFAULT ''
    );
  `);
  // superseded: scores used to be typed in by the host, plus a separate guest "bonus"
  await pool.query(`DROP TABLE IF EXISTS week_scores CASCADE;`);
  await pool.query(`DROP TABLE IF EXISTS votes CASCADE;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guest_scores (
      week_id INT REFERENCES weeks(id) ON DELETE CASCADE,
      voter_slug TEXT NOT NULL,
      voter_name TEXT NOT NULL,
      contestant_id INT REFERENCES contestants(id) ON DELETE CASCADE,
      score INT NOT NULL,
      ts BIGINT NOT NULL,
      PRIMARY KEY (week_id, voter_slug, contestant_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS judges (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);
  // backfill judges from any scores recorded before this table existed
  await pool.query(`
    INSERT INTO judges (slug, name)
    SELECT DISTINCT ON (voter_slug) voter_slug, voter_name
    FROM guest_scores
    ORDER BY voter_slug, ts DESC
    ON CONFLICT (slug) DO NOTHING;
  `);
}

const slugify = (s) =>
  (s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "guest";

// ---------------------------------------------------------------
// Full state (used by both host and judge views)
// ---------------------------------------------------------------
async function getFullState() {
  const meta = (await pool.query(`SELECT * FROM season_meta WHERE id = 1`)).rows[0];
  const contestants = (
    await pool.query(`SELECT * FROM contestants ORDER BY id ASC`)
  ).rows.map((c) => ({
    id: c.id,
    name: c.name,
    partner: c.partner,
    eliminated: c.eliminated,
    eliminatedWeekLabel: c.eliminated_week_label,
  }));
  const weeks = (await pool.query(`SELECT * FROM weeks ORDER BY order_num ASC`)).rows;
  const scoreRows = (await pool.query(`SELECT * FROM guest_scores`)).rows;

  const weeksOut = weeks.map((w) => {
    const rowsForWeek = scoreRows.filter((r) => r.week_id === w.id);
    const byContestant = {};
    rowsForWeek.forEach((r) => {
      if (!byContestant[r.contestant_id]) byContestant[r.contestant_id] = [];
      byContestant[r.contestant_id].push({ name: r.voter_name, score: Number(r.score) });
    });
    const scores = {};
    Object.entries(byContestant).forEach(([contestantId, judges]) => {
      const sum = judges.reduce((a, j) => a + j.score, 0);
      scores[contestantId] = {
        avg: sum / judges.length,
        count: judges.length,
        judges,
      };
    });
    return {
      id: w.id,
      order: w.order_num,
      label: w.label,
      danceNight: w.dance_night,
      scores,
    };
  });

  return {
    seasonName: meta.season_name,
    activeWeekId: meta.active_week_id,
    contestants,
    weeks: weeksOut,
  };
}

// ---------------------------------------------------------------
// Routes
// ---------------------------------------------------------------
app.get("/api/state", async (req, res) => {
  try {
    res.json(await getFullState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load state" });
  }
});

app.get("/api/judges", async (req, res) => {
  try {
    const rows = (await pool.query(`SELECT slug, name FROM judges ORDER BY name ASC`)).rows;
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load judges" });
  }
});

app.post("/api/judges", async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name required" });
  const slug = slugify(name);
  try {
    await pool.query(
      `INSERT INTO judges (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = $2`,
      [slug, name.trim()]
    );
    const rows = (await pool.query(`SELECT slug, name FROM judges ORDER BY name ASC`)).rows;
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not add judge" });
  }
});

app.delete("/api/judges/:slug", async (req, res) => {
  try {
    await pool.query(`DELETE FROM guest_scores WHERE voter_slug = $1`, [req.params.slug]);
    await pool.query(`DELETE FROM judges WHERE slug = $1`, [req.params.slug]);
    const rows = (await pool.query(`SELECT slug, name FROM judges ORDER BY name ASC`)).rows;
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not remove judge" });
  }
});

app.patch("/api/season", async (req, res) => {
  const { seasonName, activeWeekId } = req.body;
  try {
    await pool.query(
      `UPDATE season_meta SET
        season_name = COALESCE($1, season_name),
        active_week_id = COALESCE($2, active_week_id)
       WHERE id = 1`,
      [seasonName, activeWeekId]
    );
    res.json(await getFullState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update season" });
  }
});

app.post("/api/contestants", async (req, res) => {
  const { name, partner } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name required" });
  try {
    await pool.query(`INSERT INTO contestants (name, partner) VALUES ($1, $2)`, [
      name.trim(),
      (partner || "").trim(),
    ]);
    res.json(await getFullState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not add contestant" });
  }
});

app.delete("/api/contestants/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM contestants WHERE id = $1`, [req.params.id]);
    res.json(await getFullState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not remove contestant" });
  }
});

app.post("/api/contestants/:id/toggle-eliminated", async (req, res) => {
  const { activeWeekLabel } = req.body;
  try {
    const current = (
      await pool.query(`SELECT eliminated FROM contestants WHERE id = $1`, [req.params.id])
    ).rows[0];
    if (!current) return res.status(404).json({ error: "Not found" });
    const newVal = !current.eliminated;
    await pool.query(
      `UPDATE contestants SET eliminated = $1, eliminated_week_label = $2 WHERE id = $3`,
      [newVal, newVal ? activeWeekLabel || "—" : null, req.params.id]
    );
    res.json(await getFullState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update contestant" });
  }
});

app.post("/api/weeks", async (req, res) => {
  try {
    const maxOrder = (
      await pool.query(`SELECT COALESCE(MAX(order_num), 0) AS m FROM weeks`)
    ).rows[0].m;
    const nextOrder = Number(maxOrder) + 1;
    const inserted = (
      await pool.query(
        `INSERT INTO weeks (order_num, label, dance_night) VALUES ($1, $2, '') RETURNING id`,
        [nextOrder, `Week ${nextOrder}`]
      )
    ).rows[0];
    await pool.query(`UPDATE season_meta SET active_week_id = $1 WHERE id = 1`, [inserted.id]);
    res.json(await getFullState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create week" });
  }
});

app.patch("/api/weeks/:id", async (req, res) => {
  const { label, danceNight } = req.body;
  try {
    await pool.query(
      `UPDATE weeks SET label = COALESCE($1, label), dance_night = COALESCE($2, dance_night) WHERE id = $3`,
      [label, danceNight, req.params.id]
    );
    res.json(await getFullState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update week" });
  }
});

app.delete("/api/weeks/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM weeks WHERE id = $1`, [req.params.id]);
    await pool.query(
      `UPDATE season_meta SET active_week_id = NULL WHERE active_week_id = $1`,
      [req.params.id]
    );
    res.json(await getFullState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete week" });
  }
});

app.post("/api/weeks/:id/judge-score", async (req, res) => {
  const { name, contestantId, score } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name required" });
  if (!contestantId) return res.status(400).json({ error: "Contestant required" });
  const clamped = Math.max(1, Math.min(10, Number(score) || 0));
  const slug = slugify(name);
  try {
    await pool.query(
      `INSERT INTO judges (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = $2`,
      [slug, name.trim()]
    );
    await pool.query(
      `INSERT INTO guest_scores (week_id, voter_slug, voter_name, contestant_id, score, ts)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (week_id, voter_slug, contestant_id)
       DO UPDATE SET score = $5, voter_name = $3, ts = $6`,
      [req.params.id, slug, name.trim(), contestantId, clamped, Date.now()]
    );
    res.json(await getFullState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not record score" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`DWTS tracker running on port ${PORT}`));
  })
  .catch((e) => {
    console.error("Failed to initialize database schema:", e);
    process.exit(1);
  });
