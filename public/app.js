// ---------------------------------------------------------------
// tiny helpers
// ---------------------------------------------------------------
const app = document.getElementById("app");

async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`${method} ${path} failed: ${res.status} ${t}`);
  }
  return res.json();
}

function esc(s) {
  return (s || "").toString().replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------------------------------------------------------------
// global state
// ---------------------------------------------------------------
const S = {
  role: localStorage.getItem("dwts_role") || null,
  judgeName: localStorage.getItem("dwts_judge_name") || "",
  data: null,
  tab: "score",
  openHistoryWeek: null,
  knownJudges: [],
  justSaved: false,
  loading: true,
};

let pollHandle = null;

function setRole(role) {
  S.role = role;
  localStorage.setItem("dwts_role", role || "");
  clearInterval(pollHandle);
  render();
  boot();
}

function switchJudge() {
  S.judgeName = "";
  localStorage.setItem("dwts_judge_name", "");
  render();
}

// ---------------------------------------------------------------
// boot / data loading
// ---------------------------------------------------------------
async function boot() {
  if (!S.role) {
    S.loading = false;
    render();
    return;
  }
  S.loading = true;
  render();
  try {
    S.data = await api("/api/state");
    S.knownJudges = await api("/api/judges");
  } catch (e) {
    console.error(e);
  }
  S.loading = false;
  render();

  clearInterval(pollHandle);
  pollHandle = setInterval(refreshState, 4000);
}

async function refreshState() {
  try {
    S.data = await api("/api/state");
    S.knownJudges = await api("/api/judges");
    render();
  } catch (e) {
    console.error(e);
  }
}

// ---------------------------------------------------------------
// render root
// ---------------------------------------------------------------
function render() {
  if (S.loading) {
    app.innerHTML = `<div class="spotlight-loading">✦ Warming up the spotlight…</div>`;
    return;
  }
  if (!S.role) {
    app.innerHTML = roleChooserHtml();
    return;
  }
  app.innerHTML = S.role === "host" ? hostHtml() : guestHtml();
}

// ---------------------------------------------------------------
// role chooser
// ---------------------------------------------------------------
function roleChooserHtml() {
  return `
    <div class="role-wrap">
      <div class="eyebrow">★ Dancing From the Couch</div>
      <h1 class="marquee" style="font-size:28px;font-weight:600;margin:0;">How are you joining tonight?</h1>
      <div class="role-grid">
        <button class="role-card" data-action="set-role" data-role="host">
          <div class="icon" style="font-size:22px;">📺</div>
          <div class="title">I'm hosting</div>
          <div class="desc">Manage couples, run the weeks, watch the leaderboard.</div>
        </button>
        <button class="role-card" data-action="set-role" data-role="guest">
          <div class="icon" style="font-size:22px;">📱</div>
          <div class="title">I'm a judge</div>
          <div class="desc">Score each couple 1–10 from your phone, every week.</div>
        </button>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------
// HOST APP — administrative only. No scoring here; the judges score.
// ---------------------------------------------------------------
function computeTotals(data) {
  const totals = {};
  data.contestants.forEach((c) => (totals[c.id] = 0));
  data.weeks.forEach((w) => {
    data.contestants.forEach((c) => {
      const entry = w.scores[c.id];
      if (entry) totals[c.id] = (totals[c.id] || 0) + entry.avg;
    });
  });
  return totals;
}

function computePriorTotals(data) {
  const totals = {};
  data.contestants.forEach((c) => (totals[c.id] = 0));
  const sorted = [...data.weeks].sort((a, b) => a.order - b.order).slice(0, -1);
  sorted.forEach((w) => {
    data.contestants.forEach((c) => {
      const entry = w.scores[c.id];
      if (entry) totals[c.id] = (totals[c.id] || 0) + entry.avg;
    });
  });
  return totals;
}

function hostHtml() {
  const d = S.data;
  if (!d) return `<div class="empty-state">Couldn't load the tracker. Refresh to try again.</div>`;

  return `
    <div class="header">
      <div class="header-row">
        <div>
          <div class="eyebrow">★ Dancing From the Couch · Host view</div>
          <input class="season-name-input" value="${esc(d.seasonName)}" data-field="seasonName" />
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="pill">👥 ${d.contestants.length} &nbsp;·&nbsp; 🎵 ${d.weeks.length}</div>
          <button class="switch-btn" data-action="set-role" data-role="">Switch view</button>
        </div>
      </div>
      <div class="tabs">
        ${tabBtn("score", "This Week")}
        ${tabBtn("leaderboard", "Leaderboard")}
        ${tabBtn("history", "History")}
        ${tabBtn("couples", "Couples")}
        ${tabBtn("judges", "Judges")}
      </div>
    </div>
    <div class="content">
      ${S.tab === "score" ? scoreTabHtml(d) : ""}
      ${S.tab === "leaderboard" ? leaderboardTabHtml(d) : ""}
      ${S.tab === "history" ? historyTabHtml(d) : ""}
      ${S.tab === "couples" ? couplesTabHtml(d) : ""}
      ${S.tab === "judges" ? judgesTabHtml() : ""}
    </div>
  `;
}

function tabBtn(id, label) {
  return `<button class="tab-btn ${S.tab === id ? "active" : ""}" data-action="set-tab" data-tab="${id}">${label}</button>`;
}

// ---- Couples ----
function couplesTabHtml(d) {
  const rows = d.contestants
    .map(
      (c) => `
    <div class="couple-row ${c.eliminated ? "eliminated" : ""}">
      <div>
        <div class="couple-name">${esc(c.name)}</div>
        <div class="couple-sub">${c.partner ? "with " + esc(c.partner) : "no partner set"}${
        c.eliminated ? ` · eliminated ${esc(c.eliminatedWeekLabel || "")}` : ""
      }</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn ${c.eliminated ? "btn-outline-good" : "btn-outline-pink"}" data-action="toggle-eliminated" data-id="${c.id}">
          ${c.eliminated ? "Restore" : "Eliminate"}
        </button>
        <button class="icon-btn" data-action="remove-contestant" data-id="${c.id}">🗑</button>
      </div>
    </div>`
    )
    .join("");

  return `
    <div>
      <div class="section-label">Couples in the season</div>
      ${d.contestants.length === 0 ? `<div class="empty-state" style="margin-top:12px;">No couples yet. Add your first pairing below.</div>` : `<div style="margin-top:12px;">${rows}</div>`}
      <div class="card" style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;margin-top:16px;border-style:dashed;max-width:520px;">
        <label class="field">Star<input type="text" id="new-name" placeholder="e.g. Priya" style="min-width:140px;" /></label>
        <label class="field">Pro partner<input type="text" id="new-partner" placeholder="optional" style="min-width:140px;" /></label>
        <button class="btn btn-gold" data-action="add-contestant">+ Add couple</button>
      </div>
      <div class="empty-state" style="margin-top:20px;max-width:520px;text-align:left;">
        Scoring happens on guests' own phones — each person who opens this app and taps "I'm a judge" scores every couple 1–10, and their average becomes that couple's score for the week. There's nothing to enter here.
      </div>
    </div>
  `;
}

// ---- Judges ----
function judgesTabHtml() {
  const judges = S.knownJudges || [];
  const rows = judges
    .map(
      (j) => `
    <div class="couple-row">
      <div class="couple-name">${esc(j.name)}</div>
      <button class="icon-btn" data-action="remove-judge" data-slug="${esc(j.slug)}">🗑</button>
    </div>`
    )
    .join("");

  return `
    <div>
      <div class="section-label">Judges</div>
      ${judges.length === 0 ? `<div class="empty-state" style="margin-top:12px;">No judges yet — anyone who scores a couple from their phone is added automatically, or add one ahead of time below.</div>` : `<div style="margin-top:12px;max-width:420px;">${rows}</div>`}
      <div class="card" style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;margin-top:16px;border-style:dashed;max-width:420px;">
        <label class="field">Name<input type="text" id="new-judge-name" placeholder="e.g. Sam" style="min-width:160px;" /></label>
        <button class="btn btn-gold" data-action="add-judge">+ Add judge</button>
      </div>
      <div class="empty-state" style="margin-top:20px;max-width:520px;text-align:left;">
        Removing a judge also removes every score they've submitted, and they'll disappear from the "who's judging?" list on the phone view. They can always re-add themselves by scoring again.
      </div>
    </div>
  `;
}


function scoreTabHtml(d) {
  const sortedWeeks = [...d.weeks].sort((a, b) => a.order - b.order);
  const activeWeek = d.weeks.find((w) => w.id === d.activeWeekId);
  const weekChips = sortedWeeks
    .map(
      (w) =>
        `<button class="week-chip ${activeWeek && activeWeek.id === w.id ? "active" : ""}" data-action="select-week" data-id="${w.id}">${esc(w.label)}</button>`
    )
    .join("");

  const weekControls = `
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:20px;">
      ${weekChips}
      <button class="btn btn-outline" style="color:var(--gold);border-color:var(--gold-dim);" data-action="add-week">+ New week</button>
    </div>
  `;

  if (!activeWeek) {
    return weekControls + `<div class="empty-state">Start a new week to open scoring for tonight's dances.</div>`;
  }

  if (d.contestants.length === 0) {
    return weekControls + `<div class="empty-state">Add couples in the Couples tab first.</div>`;
  }

  const eligible = d.contestants.filter((c) => !c.eliminated || c.eliminatedWeekLabel === activeWeek.label);
  const totalJudges = new Set(
    Object.values(activeWeek.scores).flatMap((s) => s.judges.map((j) => j.name))
  ).size;

  const rows = eligible
    .map((c) => {
      const entry = activeWeek.scores[c.id];
      const judgesLine = entry
        ? entry.judges.map((j) => `${esc(j.name)}: ${j.score}`).join(" · ")
        : "no scores yet";
      return `
      <div class="card" style="margin-bottom:10px;">
        <div class="row">
          <div>
            <div class="couple-name">${esc(c.name)}</div>
            ${c.partner ? `<div class="couple-sub">with ${esc(c.partner)}</div>` : ""}
            <div class="couple-sub" style="margin-top:6px;">${judgesLine}</div>
          </div>
          <div style="text-align:right;">
            <div class="score-total">${entry ? entry.avg.toFixed(1) : "–"}</div>
            <div style="font-size:11px;color:var(--cream-dim);">${entry ? entry.count + " judge" + (entry.count === 1 ? "" : "s") : ""}</div>
          </div>
        </div>
      </div>`;
    })
    .join("");

  return (
    weekControls +
    `
    <div class="week-toolbar">
      <label class="field">Week name<input type="text" value="${esc(activeWeek.label)}" data-field="weekLabel" data-week-id="${activeWeek.id}" style="min-width:160px;" /></label>
      <label class="field">Theme / dance night<input type="text" value="${esc(activeWeek.danceNight)}" placeholder="e.g. Latin Night" data-field="weekDance" data-week-id="${activeWeek.id}" style="min-width:180px;" /></label>
      <button class="btn btn-outline-bad" style="margin-left:auto;" data-action="delete-week" data-id="${activeWeek.id}">🗑 Delete week</button>
    </div>
    <div style="font-size:13px;color:var(--cream-dim);margin-bottom:12px;">📱 ${totalJudges} judge${totalJudges === 1 ? "" : "s"} have scored so far this week</div>
    ${rows}
  `
  );
}

// ---- Leaderboard ----
function leaderboardTabHtml(d) {
  const totals = computeTotals(d);
  const prior = computePriorTotals(d);
  const ranked = [...d.contestants].sort((a, b) => (totals[b.id] || 0) - (totals[a.id] || 0));
  if (ranked.length === 0) return `<div class="empty-state">Your leaderboard will appear here once you add couples and score a week.</div>`;

  return ranked
    .map((c, idx) => {
      const total = totals[c.id] || 0;
      const diff = total - (prior[c.id] || 0);
      const trend = diff > 0.05 ? `<span style="color:var(--good);">▲</span>` : diff < -0.05 ? `<span style="color:var(--bad);">▼</span>` : `<span style="color:var(--cream-dim);">–</span>`;
      return `
      <div class="lb-row ${idx === 0 ? "first" : ""}" style="opacity:${c.eliminated ? 0.55 : 1};">
        <div class="lb-rank">${idx + 1}</div>
        ${idx === 0 ? `<div style="color:var(--gold);">🏆</div>` : ""}
        <div style="flex:1;">
          <div class="couple-name">${esc(c.name)}</div>
          <div class="couple-sub">${c.partner ? "with " + esc(c.partner) : ""}${c.eliminated ? ` · eliminated ${esc(c.eliminatedWeekLabel || "")}` : ""}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${trend}
          <div class="lb-total">${total.toFixed(1)}</div>
        </div>
      </div>`;
    })
    .join("");
}

// ---- History ----
function historyTabHtml(d) {
  const sortedWeeks = [...d.weeks].sort((a, b) => b.order - a.order);
  if (sortedWeeks.length === 0) return `<div class="empty-state">No weeks yet. Start one from This Week to open scoring.</div>`;

  return sortedWeeks
    .map((w) => {
      const isOpen = S.openHistoryWeek === w.id;
      const rows = d.contestants
        .map((c) => {
          const entry = w.scores[c.id];
          if (!entry) return null;
          return { c, entry };
        })
        .filter(Boolean)
        .sort((a, b) => b.entry.avg - a.entry.avg);

      return `
      <div class="hist-week">
        <button class="hist-header" data-action="toggle-history" data-id="${w.id}">
          <span>🕐 <strong>${esc(w.label)}</strong>${w.danceNight ? ` <span style="color:var(--cream-dim);">· ${esc(w.danceNight)}</span>` : ""}</span>
          <span>${isOpen ? "▲" : "▼"}</span>
        </button>
        ${
          isOpen
            ? `<div class="hist-body">
                ${
                  rows.length === 0
                    ? `<div style="font-size:14px;color:var(--cream-dim);">No scores recorded for this week.</div>`
                    : rows
                        .map(
                          ({ c, entry }) => `
                        <div class="hist-row" style="flex-direction:column;align-items:flex-start;gap:2px;padding:8px 0;border-bottom:1px solid var(--line);">
                          <div style="display:flex;justify-content:space-between;width:100%;">
                            <span><strong>${esc(c.name)}</strong></span>
                            <strong style="color:var(--gold);">${entry.avg.toFixed(1)}</strong>
                          </div>
                          <div style="font-size:12px;color:var(--cream-dim);">${entry.judges.map((j) => `${esc(j.name)}: ${j.score}`).join(" · ")}</div>
                        </div>`
                        )
                        .join("")
                }
                <button class="btn btn-outline-bad" style="margin-top:12px;" data-action="delete-week" data-id="${w.id}">🗑 Delete this week</button>
              </div>`
            : ""
        }
      </div>`;
    })
    .join("");
}

// ---------------------------------------------------------------
// JUDGE APP (phone view)
// ---------------------------------------------------------------
function judgePickerHtml() {
  const known = S.knownJudges || [];
  return `
    <div class="name-card">
      <div style="font-size:14px;color:var(--cream-dim);margin-bottom:10px;">Who's judging?</div>
      ${
        known.length > 0
          ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
              ${known
                .map(
                  (j) =>
                    `<button class="week-chip" data-action="pick-judge" data-name="${esc(j.name)}">${esc(j.name)}</button>`
                )
                .join("")}
            </div>`
          : ""
      }
      <div style="font-size:12px;color:var(--cream-dim);margin-bottom:6px;">${known.length > 0 ? "Not on the list?" : "First time judging:"}</div>
      <div style="display:flex;gap:8px;">
        <input type="text" id="guest-name-input" placeholder="Your name" style="flex:1;" />
        <button class="btn btn-gold" data-action="save-guest-name">Let's go</button>
      </div>
    </div>
  `;
}

function judgeHtml() {
  const d = S.data;
  const activeWeek = d && d.weeks.find((w) => w.id === d.activeWeekId);
  const eligible = activeWeek ? d.contestants.filter((c) => !c.eliminated || c.eliminatedWeekLabel === activeWeek.label) : [];

  if (S.judgeName && !activeWeek) {
    return `<div class="empty-state" style="margin-top:16px;">Judging isn't open yet — ask your host to start this week.</div>`;
  }
  if (S.judgeName && activeWeek && eligible.length === 0) {
    return `<div class="empty-state" style="margin-top:16px;">No couples to score yet.</div>`;
  }
  if (!(S.judgeName && activeWeek && eligible.length > 0)) return "";

  return `
    <div style="margin-top:16px;">
      <div style="font-size:14px;color:var(--cream-dim);margin-bottom:12px;">
        Judging <strong style="color:var(--cream);">${esc(activeWeek.label)}</strong>${activeWeek.danceNight ? ` · ${esc(activeWeek.danceNight)}` : ""} — score each couple 1–10
      </div>
      ${S.justSaved ? `<div class="just-voted">✓ Score saved!</div>` : ""}
      ${eligible
        .map((c) => {
          const entry = activeWeek.scores[c.id];
          const mine = entry ? (entry.judges.find((j) => j.name === S.judgeName) || {}).score : undefined;
          const numButtons = Array.from({ length: 10 })
            .map((_, i) => {
              const n = i + 1;
              const selected = mine === n;
              return `<button class="judge-num-btn ${selected ? "selected" : ""}" data-action="set-guest-score" data-week-id="${activeWeek.id}" data-contestant-id="${c.id}" data-score="${n}">${n}</button>`;
            })
            .join("");
          return `
          <div class="card guest-score-card">
            <div class="row" style="margin-bottom:10px;">
              <div>
                <div class="couple-name">${esc(c.name)}</div>
                ${c.partner ? `<div class="couple-sub">with ${esc(c.partner)}</div>` : ""}
              </div>
              <div style="font-size:12px;color:var(--cream-dim);text-align:right;">
                ${entry ? `avg ${entry.avg.toFixed(1)} · ${entry.count} judge${entry.count === 1 ? "" : "s"}` : "no scores yet"}
                ${mine ? `<div style="color:var(--gold);font-weight:600;margin-top:2px;">Your score: ${mine}</div>` : ""}
              </div>
            </div>
            <div class="judge-score-row">${numButtons}</div>
          </div>`;
        })
        .join("")}
      <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:12px;font-size:12px;color:var(--cream-dim);">⟳ You can change any score while judging is open</div>
    </div>
  `;
}

function guestHtml() {
  const d = S.data;
  return `
    <div class="guest-wrap">
      <div class="guest-topbar">
        <div class="eyebrow">★ Judge</div>
        <button class="switch-btn" data-action="set-role" data-role="">Switch view</button>
      </div>
      <h1 class="marquee" style="font-size:clamp(18px, 5vw, 24px);font-weight:600;margin:0 0 4px;line-height:1.15;">${esc(d ? d.seasonName : "Dancing From the Couch")}</h1>

      ${
        S.judgeName
          ? `<div style="font-size:12px;color:var(--cream-dim);margin-bottom:4px;">Judging as <strong style="color:var(--cream);">${esc(S.judgeName)}</strong> · <a href="#" data-action="switch-judge" style="color:var(--gold);">not you?</a></div>`
          : ""
      }
      ${!S.judgeName ? judgePickerHtml() : judgeHtml()}
    </div>
  `;
}

// ---------------------------------------------------------------
// event delegation
// ---------------------------------------------------------------
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  try {
    if (action === "set-role") {
      setRole(btn.dataset.role || null);
      return;
    }
    if (action === "set-tab") {
      S.tab = btn.dataset.tab;
      render();
      return;
    }
    if (action === "toggle-history") {
      const id = Number(btn.dataset.id);
      S.openHistoryWeek = S.openHistoryWeek === id ? null : id;
      render();
      return;
    }
    if (action === "add-contestant") {
      const name = document.getElementById("new-name").value;
      const partner = document.getElementById("new-partner").value;
      if (!name.trim()) return;
      S.data = await api("/api/contestants", "POST", { name, partner });
      render();
      return;
    }
    if (action === "remove-contestant") {
      S.data = await api(`/api/contestants/${btn.dataset.id}`, "DELETE");
      render();
      return;
    }
    if (action === "toggle-eliminated") {
      const activeWeek = S.data.weeks.find((w) => w.id === S.data.activeWeekId);
      S.data = await api(`/api/contestants/${btn.dataset.id}/toggle-eliminated`, "POST", {
        activeWeekLabel: activeWeek ? activeWeek.label : null,
      });
      render();
      return;
    }
    if (action === "add-week") {
      S.data = await api("/api/weeks", "POST");
      render();
      return;
    }
    if (action === "select-week") {
      S.data = await api("/api/season", "PATCH", { activeWeekId: Number(btn.dataset.id) });
      render();
      return;
    }
    if (action === "delete-week") {
      S.data = await api(`/api/weeks/${btn.dataset.id}`, "DELETE");
      render();
      return;
    }
    if (action === "pick-judge") {
      S.judgeName = btn.dataset.name;
      localStorage.setItem("dwts_judge_name", S.judgeName);
      render();
      return;
    }
    if (action === "add-judge") {
      const nameInput = document.getElementById("new-judge-name");
      const name = nameInput.value;
      if (!name.trim()) return;
      S.knownJudges = await api("/api/judges", "POST", { name });
      render();
      return;
    }
    if (action === "remove-judge") {
      S.knownJudges = await api(`/api/judges/${btn.dataset.slug}`, "DELETE");
      await refreshState();
      return;
    }
    if (action === "switch-judge") {
      e.preventDefault();
      switchJudge();
      return;
    }
    if (action === "save-guest-name") {
      const val = document.getElementById("guest-name-input").value.trim();
      if (!val) return;
      S.judgeName = val;
      localStorage.setItem("dwts_judge_name", val);
      render();
      return;
    }
    if (action === "set-guest-score") {
      const weekId = btn.dataset.weekId;
      const contestantId = Number(btn.dataset.contestantId);
      const score = Number(btn.dataset.score);
      S.data = await api(`/api/weeks/${weekId}/judge-score`, "POST", {
        name: S.judgeName,
        contestantId,
        score,
      });
      S.justSaved = true;
      render();
      setTimeout(() => {
        S.justSaved = false;
        render();
      }, 1200);
      return;
    }
  } catch (err) {
    console.error(err);
    alert("Something went wrong talking to the server. Please try again.");
  }
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  try {
    if (t.dataset.field === "seasonName") {
      S.data = await api("/api/season", "PATCH", { seasonName: t.value });
      return;
    }
    if (t.dataset.field === "weekLabel") {
      S.data = await api(`/api/weeks/${t.dataset.weekId}`, "PATCH", { label: t.value });
      render();
      return;
    }
    if (t.dataset.field === "weekDance") {
      S.data = await api(`/api/weeks/${t.dataset.weekId}`, "PATCH", { danceNight: t.value });
      render();
      return;
    }
  } catch (err) {
    console.error(err);
    alert("Couldn't save that change — please try again.");
  }
});

// ---------------------------------------------------------------
// go
// ---------------------------------------------------------------
boot();
