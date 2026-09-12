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
  guestName: localStorage.getItem("dwts_guest_name") || "",
  data: null,
  tab: "score",
  openHistoryWeek: null,
  guestAverages: {},
  guestCounts: {},
  guestRaw: [],
  distinctGuests: 0,
  myScores: {},
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
  } catch (e) {
    console.error(e);
  }
  S.loading = false;
  render();

  clearInterval(pollHandle);
  if (S.role === "host") {
    pollHandle = setInterval(pollActiveWeekGuestScores, 4000);
    pollActiveWeekGuestScores();
  } else {
    pollHandle = setInterval(guestPoll, 4000);
    guestPoll();
  }
}

async function refreshState() {
  try {
    S.data = await api("/api/state");
    render();
  } catch (e) {
    console.error(e);
  }
}

async function pollActiveWeekGuestScores() {
  if (!S.data || !S.data.activeWeekId) return;
  try {
    const { averages, counts, raw, distinctGuests } = await api(
      `/api/weeks/${S.data.activeWeekId}/guest-scores`
    );
    S.guestAverages = averages;
    S.guestCounts = counts;
    S.guestRaw = raw;
    S.distinctGuests = distinctGuests;
    render();
  } catch (e) {
    // ignore
  }
}

async function guestPoll() {
  await refreshState();
  if (S.data && S.data.activeWeekId) {
    try {
      const { averages, counts, raw, distinctGuests } = await api(
        `/api/weeks/${S.data.activeWeekId}/guest-scores`
      );
      S.guestAverages = averages;
      S.guestCounts = counts;
      S.guestRaw = raw;
      S.distinctGuests = distinctGuests;
      if (S.guestName) {
        S.myScores = {};
        raw
          .filter((r) => r.voterName === S.guestName)
          .forEach((r) => (S.myScores[r.contestantId] = r.score));
      }
      render();
    } catch (e) {}
  }
}

// ---------------------------------------------------------------
// render root
// ---------------------------------------------------------------
function render() {
  if (S.loading) {
    app.innerHTML = shell(`<div class="spotlight-loading">✦ Warming up the spotlight…</div>`);
    return;
  }
  if (!S.role) {
    app.innerHTML = shell(roleChooserHtml());
    return;
  }
  if (S.role === "host") {
    app.innerHTML = shell(hostHtml());
  } else {
    app.innerHTML = shell(guestHtml());
  }
}

function shell(inner) {
  return inner;
}

// ---------------------------------------------------------------
// role chooser
// ---------------------------------------------------------------
function roleChooserHtml() {
  return `
    <div class="role-wrap">
      <div class="eyebrow">★ Weekly dance party</div>
      <h1 class="marquee" style="font-size:28px;font-weight:600;margin:0;">How are you joining tonight?</h1>
      <div class="role-grid">
        <button class="role-card" data-action="set-role" data-role="host">
          <div class="icon" style="font-size:22px;">📺</div>
          <div class="title">I'm hosting</div>
          <div class="desc">Manage couples, enter judges' scores, run the leaderboard.</div>
        </button>
        <button class="role-card" data-action="set-role" data-role="guest">
          <div class="icon" style="font-size:22px;">📱</div>
          <div class="title">I'm a guest judge</div>
          <div class="desc">Score each couple 1–10 from your phone, just like the real judges.</div>
        </button>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------
// HOST APP
// ---------------------------------------------------------------
function computeTotals(data) {
  const totals = {};
  data.contestants.forEach((c) => (totals[c.id] = 0));
  const sorted = [...data.weeks].sort((a, b) => a.order - b.order);
  sorted.forEach((w) => {
    data.contestants.forEach((c) => {
      const entry = w.scores[c.id];
      if (entry) {
        const judgeSum = (entry.judgeScores || []).reduce((a, b) => a + (Number(b) || 0), 0);
        totals[c.id] = (totals[c.id] || 0) + judgeSum + (Number(entry.bonus) || 0);
      }
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
      if (entry) {
        const judgeSum = (entry.judgeScores || []).reduce((a, b) => a + (Number(b) || 0), 0);
        totals[c.id] = (totals[c.id] || 0) + judgeSum + (Number(entry.bonus) || 0);
      }
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
          <div class="eyebrow">★ Weekly dance party · Host view</div>
          <input class="season-name-input" value="${esc(d.seasonName)}" data-field="seasonName" />
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="pill">👥 ${d.contestants.length} &nbsp;·&nbsp; 🎵 ${d.weeks.length}</div>
          <button class="switch-btn" data-action="set-role" data-role="">Switch view</button>
        </div>
      </div>
      <div class="tabs">
        ${tabBtn("score", "Score Entry")}
        ${tabBtn("leaderboard", "Leaderboard")}
        ${tabBtn("history", "History")}
        ${tabBtn("couples", "Couples & Settings")}
      </div>
    </div>
    <div class="content">
      ${S.tab === "score" ? scoreTabHtml(d) : ""}
      ${S.tab === "leaderboard" ? leaderboardTabHtml(d) : ""}
      ${S.tab === "history" ? historyTabHtml(d) : ""}
      ${S.tab === "couples" ? couplesTabHtml(d) : ""}
    </div>
  `;
}

function tabBtn(id, label) {
  return `<button class="tab-btn ${S.tab === id ? "active" : ""}" data-action="set-tab" data-tab="${id}">${label}</button>`;
}

// ---- Couples & Settings ----
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

  const judgeButtons = [1, 2, 3, 4, 5]
    .map(
      (n) => `<button class="btn ${d.numJudges === n ? "" : "btn-outline"}" style="${
        d.numJudges === n ? "background:var(--pink);color:var(--cream);" : ""
      }width:36px;justify-content:center;" data-action="set-num-judges" data-n="${n}">${n}</button>`
    )
    .join("");

  const voteButtons = [0.5, 1, 2, 3]
    .map(
      (n) => `<button class="btn ${d.pointsPerVote === n ? "" : "btn-outline"}" style="${
        d.pointsPerVote === n ? "background:var(--pink);color:var(--cream);" : ""
      }justify-content:center;" data-action="set-points-per-vote" data-n="${n}">${n}</button>`
    )
    .join("");

  return `
    <div style="display:grid;gap:24px;grid-template-columns:1.3fr 1fr;">
      <div>
        <div class="section-label">Couples in the season</div>
        ${d.contestants.length === 0 ? `<div class="empty-state" style="margin-top:12px;">No couples yet. Add your first pairing below.</div>` : `<div style="margin-top:12px;">${rows}</div>`}
        <div class="card" style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;margin-top:16px;border-style:dashed;">
          <label class="field">Star<input type="text" id="new-name" placeholder="e.g. Priya" style="min-width:140px;" /></label>
          <label class="field">Pro partner<input type="text" id="new-partner" placeholder="optional" style="min-width:140px;" /></label>
          <button class="btn btn-gold" data-action="add-contestant">+ Add couple</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div>
          <div class="section-label">Judging setup</div>
          <div class="card" style="margin-top:12px;">
            <div style="font-size:14px;color:var(--cream-dim);margin-bottom:8px;">Number of judges (applies to new weeks)</div>
            <div style="display:flex;gap:8px;">${judgeButtons}</div>
            <div style="font-size:12px;color:var(--cream-dim);margin-top:12px;">Full judges' total maxes out at ${d.numJudges * 10} points per week.</div>
          </div>
        </div>
        <div>
          <div class="section-label">Guest judging</div>
          <div class="card" style="margin-top:12px;">
            <div style="font-size:14px;color:var(--cream-dim);margin-bottom:8px;">Weight applied to the guest average</div>
            <div style="display:flex;gap:8px;">${voteButtons}</div>
            <div style="font-size:12px;color:var(--cream-dim);margin-top:12px;">Guests score each couple 1–10, just like the real judges. Their average score (× this weight) becomes that couple's bonus points when you convert it. Share this app's URL with your guests — on their phone they'll choose "I'm a guest judge."</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---- Score Entry ----
function scoreTabHtml(d) {
  const sortedWeeks = [...d.weeks].sort((a, b) => a.order - b.order);
  const activeWeek = d.weeks.find((w) => w.id === d.activeWeekId);
  const weekChips = sortedWeeks
    .map(
      (w) =>
        `<button class="week-chip ${activeWeek && activeWeek.id === w.id ? "active" : ""}" data-action="select-week" data-id="${w.id}">${esc(w.label)}</button>`
    )
    .join("");

  if (!activeWeek) {
    return `
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:20px;">
        ${weekChips}
        <button class="btn btn-outline" style="color:var(--gold);border-color:var(--gold-dim);" data-action="add-week">+ New week</button>
      </div>
      <div class="empty-state">Start a new week to begin entering scores for tonight's dances.</div>
    `;
  }

  if (d.contestants.length === 0) {
    return `<div class="empty-state">Add couples in the Couples tab before entering scores.</div>`;
  }

  const eligible = d.contestants.filter((c) => !c.eliminated || c.eliminatedWeekLabel === activeWeek.label);

  const votesBanner =
    S.distinctGuests > 0
      ? `<div class="votes-banner">
          <div style="display:flex;align-items:center;gap:8px;font-size:14px;">📱 ${S.distinctGuests} guest judge${S.distinctGuests === 1 ? "" : "s"} scoring ${esc(activeWeek.label)}</div>
          <button class="btn btn-gold" data-action="apply-votes" data-week-id="${activeWeek.id}">⚡ Convert guest scores to bonus points</button>
        </div>`
      : "";

  const rows = eligible
    .map((c) => {
      const entry = activeWeek.scores[c.id] || { judgeScores: Array(d.numJudges).fill(0), bonus: 0 };
      const judgeSum = (entry.judgeScores || []).slice(0, d.numJudges).reduce((a, b) => a + (Number(b) || 0), 0);
      const total = judgeSum + (Number(entry.bonus) || 0);
      const guestAvg = S.guestAverages[c.id];
      const guestCount = S.guestCounts[c.id] || 0;
      const judgeInputs = Array.from({ length: d.numJudges })
        .map(
          (_, i) => `
        <div class="judge-col">
          <span class="judge-label">Judge ${i + 1}</span>
          <input type="number" min="0" max="${d.judgeMax}" class="score-box" value="${entry.judgeScores[i] ?? 0}"
            data-action="score-input" data-week-id="${activeWeek.id}" data-contestant-id="${c.id}" data-judge-index="${i}" />
        </div>`
        )
        .join("");
      return `
      <div class="card" style="margin-bottom:12px;">
        <div class="row" style="margin-bottom:12px;">
          <div>
            <div class="couple-name">${esc(c.name)}</div>
            ${c.partner ? `<div class="couple-sub">with ${esc(c.partner)}</div>` : ""}
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            ${guestCount > 0 ? `<span style="font-size:12px;color:var(--gold);display:flex;align-items:center;gap:4px;">📱 ${guestAvg.toFixed(1)} avg (${guestCount})</span>` : ""}
            <div class="score-total">${total}</div>
          </div>
        </div>
        <div class="judge-inputs">
          ${judgeInputs}
          <div class="judge-col">
            <span class="bonus-label">Bonus</span>
            <input type="number" class="score-box" style="background:rgba(214,51,108,0.12);border-color:rgba(214,51,108,0.35);" value="${entry.bonus ?? 0}"
              data-action="bonus-input" data-week-id="${activeWeek.id}" data-contestant-id="${c.id}" />
          </div>
        </div>
      </div>`;
    })
    .join("");

  return `
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:20px;">
      ${weekChips}
      <button class="btn btn-outline" style="color:var(--gold);border-color:var(--gold-dim);" data-action="add-week">+ New week</button>
    </div>
    <div class="week-toolbar">
      <label class="field">Week name<input type="text" value="${esc(activeWeek.label)}" data-field="weekLabel" data-week-id="${activeWeek.id}" style="min-width:160px;" /></label>
      <label class="field">Theme / dance night<input type="text" value="${esc(activeWeek.danceNight)}" placeholder="e.g. Latin Night" data-field="weekDance" data-week-id="${activeWeek.id}" style="min-width:180px;" /></label>
      <button class="btn btn-outline-bad" style="margin-left:auto;" data-action="delete-week" data-id="${activeWeek.id}">🗑 Delete week</button>
    </div>
    ${votesBanner}
    ${rows}
  `;
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
      const trend = diff > 0 ? `<span style="color:var(--good);">▲</span>` : diff < 0 ? `<span style="color:var(--bad);">▼</span>` : `<span style="color:var(--cream-dim);">–</span>`;
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
          <div class="lb-total">${total}</div>
        </div>
      </div>`;
    })
    .join("");
}

// ---- History ----
function historyTabHtml(d) {
  const sortedWeeks = [...d.weeks].sort((a, b) => b.order - a.order);
  if (sortedWeeks.length === 0) return `<div class="empty-state">No weeks recorded yet. Head to Score Entry to log your first week.</div>`;

  return sortedWeeks
    .map((w) => {
      const isOpen = S.openHistoryWeek === w.id;
      const rows = d.contestants
        .map((c) => {
          const entry = w.scores[c.id];
          if (!entry) return null;
          const judgeSum = (entry.judgeScores || []).slice(0, d.numJudges).reduce((a, b) => a + (Number(b) || 0), 0);
          return { c, judgeSum, bonus: Number(entry.bonus) || 0, total: judgeSum + (Number(entry.bonus) || 0) };
        })
        .filter(Boolean)
        .sort((a, b) => b.total - a.total);

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
                    ? `<div style="font-size:14px;color:var(--cream-dim);">No scores entered for this week.</div>`
                    : rows
                        .map(
                          (r) => `<div class="hist-row"><span>${esc(r.c.name)}</span><span style="color:var(--cream-dim);">${r.judgeSum} judges${r.bonus ? ` + ${r.bonus} bonus` : ""} = <strong style="color:var(--gold);">${r.total}</strong></span></div>`
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
// GUEST APP
// ---------------------------------------------------------------
function guestHtml() {
  const d = S.data;
  const activeWeek = d && d.weeks.find((w) => w.id === d.activeWeekId);
  const eligible = activeWeek ? d.contestants.filter((c) => !c.eliminated || c.eliminatedWeekLabel === activeWeek.label) : [];

  return `
    <div class="guest-wrap">
      <div class="guest-topbar">
        <div class="eyebrow">★ Guest judge</div>
        <button class="switch-btn" data-action="set-role" data-role="">Switch view</button>
      </div>
      <h1 class="marquee" style="font-size:clamp(18px, 5vw, 24px);font-weight:600;margin:0 0 4px;line-height:1.15;">${esc(d ? d.seasonName : "Dancing From the Couch")}</h1>

      ${
        !S.guestName
          ? `<div class="name-card">
              <div style="font-size:14px;color:var(--cream-dim);margin-bottom:8px;">What's your name?</div>
              <div style="display:flex;gap:8px;">
                <input type="text" id="guest-name-input" placeholder="Your name" style="flex:1;" />
                <button class="btn btn-gold" data-action="save-guest-name">Let's go</button>
              </div>
              <div style="font-size:12px;color:var(--cream-dim);margin-top:8px;">Your name is only used so your scores can be counted and updated.</div>
            </div>`
          : ""
      }

      ${S.guestName && !activeWeek ? `<div class="empty-state" style="margin-top:16px;">Judging isn't open yet — ask your host to start this week's scoring.</div>` : ""}
      ${S.guestName && activeWeek && eligible.length === 0 ? `<div class="empty-state" style="margin-top:16px;">No couples to score yet.</div>` : ""}

      ${
        S.guestName && activeWeek && eligible.length > 0
          ? `
        <div style="margin-top:16px;">
          <div style="font-size:14px;color:var(--cream-dim);margin-bottom:12px;">
            Judging open for <strong style="color:var(--cream);">${esc(activeWeek.label)}</strong>${activeWeek.danceNight ? ` · ${esc(activeWeek.danceNight)}` : ""} — score each couple 1–10
          </div>
          ${S.justSaved ? `<div class="just-voted">✓ Score saved!</div>` : ""}
          ${eligible
            .map((c) => {
              const mine = S.myScores[c.id];
              const avg = S.guestAverages[c.id];
              const count = S.guestCounts[c.id] || 0;
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
                    ${count > 0 ? `avg ${avg.toFixed(1)} · ${count} judge${count === 1 ? "" : "s"}` : "no scores yet"}
                    ${mine ? `<div style="color:var(--gold);font-weight:600;margin-top:2px;">Your score: ${mine}</div>` : ""}
                  </div>
                </div>
                <div class="judge-score-row">${numButtons}</div>
              </div>`;
            })
            .join("")}
          <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:12px;font-size:12px;color:var(--cream-dim);">⟳ You can change any score while judging is open</div>
        </div>`
          : ""
      }
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
    if (action === "set-num-judges") {
      S.data = await api("/api/season", "PATCH", { numJudges: Number(btn.dataset.n) });
      render();
      return;
    }
    if (action === "set-points-per-vote") {
      S.data = await api("/api/season", "PATCH", { pointsPerVote: Number(btn.dataset.n) });
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
      S.guestAverages = {};
      S.guestCounts = {};
      S.myScores = {};
      render();
      pollActiveWeekGuestScores();
      return;
    }
    if (action === "delete-week") {
      S.data = await api(`/api/weeks/${btn.dataset.id}`, "DELETE");
      render();
      return;
    }
    if (action === "apply-votes") {
      S.data = await api(`/api/weeks/${btn.dataset.weekId}/apply-guest-scores`, "POST");
      render();
      return;
    }
    if (action === "save-guest-name") {
      const val = document.getElementById("guest-name-input").value.trim();
      if (!val) return;
      S.guestName = val;
      localStorage.setItem("dwts_guest_name", val);
      render();
      return;
    }
    if (action === "set-guest-score") {
      const weekId = btn.dataset.weekId;
      const contestantId = Number(btn.dataset.contestantId);
      const score = Number(btn.dataset.score);
      const result = await api(`/api/weeks/${weekId}/guest-score`, "POST", {
        name: S.guestName,
        contestantId,
        score,
      });
      S.guestAverages = result.averages;
      S.guestCounts = result.counts;
      S.guestRaw = result.raw;
      S.distinctGuests = result.distinctGuests;
      S.myScores[contestantId] = score;
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
    if (t.dataset.action === "score-input") {
      const value = Math.max(0, Math.min(S.data.judgeMax, Number(t.value) || 0));
      S.data = await api(`/api/weeks/${t.dataset.weekId}/score`, "POST", {
        contestantId: Number(t.dataset.contestantId),
        numJudges: S.data.numJudges,
        judgeIndex: Number(t.dataset.judgeIndex),
        judgeValue: value,
      });
      render();
      return;
    }
    if (t.dataset.action === "bonus-input") {
      S.data = await api(`/api/weeks/${t.dataset.weekId}/score`, "POST", {
        contestantId: Number(t.dataset.contestantId),
        numJudges: S.data.numJudges,
        bonus: Number(t.value) || 0,
      });
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
