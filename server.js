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
      season_name TEXT NOT NULL DEFAULT 'Tuesday Night Ballroom',
      num_judges INT NOT NULL DEFAULT 3,
      judge_max INT NOT NULL DEFAULT 10,
      points_per_vote NUMERIC NOT NULL DEFAULT 1,
      active_week_id INT
    );
  `);
  await pool.query(`
    INSERT INTO season_meta (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING;
  `);
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS week_scores (
      week_id INT REFERENCES weeks(id) ON DELETE CASCADE,
      contestant_id INT REFERENCES contestants(id) ON DELETE CASCADE,
      judge_scores JSONB NOT NULL DEFAULT '[]',
      bonus NUMERIC NOT NULL DEFAULT 0,
      PRIMARY KEY (week_id, contestant_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS votes (
      week_id INT REFERENCES weeks(id) ON DELETE CASCADE,
      voter_slug TEXT NOT NULL,
      voter_name TEXT NOT NULL,
      contestant_id INT REFERENCES contestants(id) ON DELETE CASCADE,
      ts BIGINT NOT NULL,
      PRIMARY KEY (week_id, voter_slug)
    );
  `);
}

const slugify = (s) =>
  (s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "guest";

// ---------------------------------------------------------------
// Full state (used by both host and guest views)
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
  const scoreRows = (await pool.query(`SELECT * FROM week_scores`)).rows;

  const weeksOut = weeks.map((w) => {
    const scores = {};
    scoreRows
      .filter((r) => r.week_id === w.id)
      .forEach((r) => {
        scores[r.contestant_id] = {
          judgeScores: r.judge_scores,
          bonus: Number(r.bonus),
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
    numJudges: meta.num_judges,
    judgeMax: meta.judge_max,
    pointsPerVote: Number(meta.points_per_vote),
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

app.patch("/api/season", async (req, res) => {
  const { seasonName, numJudges, judgeMax, pointsPerVote, activeWeekId } = req.body;
  try {
    await pool.query(
      `UPDATE season_meta SET
        season_name = COALESCE($1, season_name),
        num_judges = COALESCE($2, num_judges),
        judge_max = COALESCE($3, judge_max),
        points_per_vote = COALESCE($4, points_per_vote),
        active_week_id = COALESCE($5, active_week_id)
       WHERE id = 1`,
      [seasonName, numJudges, judgeMax, pointsPerVote, activeWeekId]
    );
    res.json(await getFullState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update season" });
  }
});

// active week can also be explicitly cleared
app.post("/api/season/active-week", async (req, res) => {
  const { weekId } = req.body; // weekId may be null
  try {
    await pool.query(`UPDATE season_meta SET active_week_id = $1 WHERE id = 1`, [weekId]);
    res.json(await getFullState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not set active week" });
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

app.post("/api/weeks/:id/score", async (req, res) => {
  const weekId = req.params.id;
  const { contestantId, numJudges, judgeIndex, judgeValue, bonus } = req.body;
  try {
    const existing = (
      await pool.query(
        `SELECT * FROM week_scores WHERE week_id = $1 AND contestant_id = $2`,
        [weekId, contestantId]
      )
    ).rows[0];
    let judgeScores = existing ? existing.judge_scores : Array(numJudges || 3).fill(0);
    while (judgeScores.length < (numJudges || judgeScores.length)) judgeScores.push(0);
    if (judgeIndex !== undefined && judgeIndex !== null) {
      judgeScores[judgeIndex] = judgeValue;
    }
    const newBonus = bonus !== undefined && bonus !== null ? bonus : existing ? existing.bonus : 0;

    await pool.query(
      `INSERT INTO week_scores (week_id, contestant_id, judge_scores, bonus)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (week_id, contestant_id)
       DO UPDATE SET judge_scores = $3, bonus = $4`,
      [weekId, contestantId, JSON.stringify(judgeScores), newBonus]
    );
    res.json(await getFullState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save score" });
  }
});

app.get("/api/weeks/:id/votes", async (req, res) => {
  try {
    const rows = (
      await pool.query(`SELECT * FROM votes WHERE week_id = $1`, [req.params.id])
    ).rows;
    const tally = {};
    rows.forEach((r) => {
      tally[r.contestant_id] = (tally[r.contestant_id] || 0) + 1;
    });
    const voters = rows.map((r) => ({ name: r.voter_name, contestantId: r.contestant_id }));
    res.json({ tally, voters });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load votes" });
  }
});

app.post("/api/weeks/:id/vote", async (req, res) => {
  const { name, contestantId } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name required" });
  if (!contestantId) return res.status(400).json({ error: "Contestant required" });
  const slug = slugify(name);
  try {
    await pool.query(
      `INSERT INTO votes (week_id, voter_slug, voter_name, contestant_id, ts)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (week_id, voter_slug)
       DO UPDATE SET contestant_id = $4, voter_name = $3, ts = $5`,
      [req.params.id, slug, name.trim(), contestantId, Date.now()]
    );
    const rows = (
      await pool.query(`SELECT * FROM votes WHERE week_id = $1`, [req.params.id])
    ).rows;
    const tally = {};
    rows.forEach((r) => {
      tally[r.contestant_id] = (tally[r.contestant_id] || 0) + 1;
    });
    res.json({ ok: true, tally });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not record vote" });
  }
});

app.post("/api/weeks/:id/apply-votes", async (req, res) => {
  try {
    const meta = (await pool.query(`SELECT points_per_vote FROM season_meta WHERE id = 1`))
      .rows[0];
    const pointsPerVote = Number(meta.points_per_vote);
    const rows = (
      await pool.query(`SELECT * FROM votes WHERE week_id = $1`, [req.params.id])
    ).rows;
    const tally = {};
    rows.forEach((r) => {
      tally[r.contestant_id] = (tally[r.contestant_id] || 0) + 1;
    });
    for (const [contestantId, count] of Object.entries(tally)) {
      const existing = (
        await pool.query(
          `SELECT * FROM week_scores WHERE week_id = $1 AND contestant_id = $2`,
          [req.params.id, contestantId]
        )
      ).rows[0];
      const judgeScores = existing ? existing.judge_scores : [];
      await pool.query(
        `INSERT INTO week_scores (week_id, contestant_id, judge_scores, bonus)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (week_id, contestant_id)
         DO UPDATE SET bonus = $4`,
        [req.params.id, contestantId, JSON.stringify(judgeScores), count * pointsPerVote]
      );
    }
    res.json(await getFullState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not apply votes" });
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
