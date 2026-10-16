// PolSenna Bets — player app
let S = null;                       // server state
let me = store.get("playerId");
const drafts = {};                  // gameId -> { betId: { optionId, amount } }
const dirty = {};                   // gameId -> bool
const STEP = 5;

const app = $("#app");
const tabbar = $("#tabbar");

const player = (id) => S?.players.find((p) => p.id === id);
const gameById = (id) => S?.games.find((g) => g.id === id);

async function load() {
  try {
    S = enrich(await rpc("get_state", { p_player: me || null }));
    S.clockSkew = S.serverTime - Date.now();
    if (me && !player(me)) { me = null; store.set("playerId", null); }
    render();
  } catch (e) {
    if (!S) app.innerHTML = `<div class="empty"><div class="ico">📡</div><h3>Server non raggiungibile</h3><p>${esc(e.message)}</p></div>`;
  }
}
const serverNow = () => Date.now() + (S?.clockSkew || 0);

// ---------- routing ----------
function route() {
  const [, view, id] = location.hash.split("/");
  return { view: view || "games", id };
}
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
window.addEventListener("scroll", () => {
  const nb = $(".navbar");
  if (nb) nb.classList.toggle("scrolled", window.scrollY > 30);
}, { passive: true });

function render() {
  if (!S) return;
  const r = route();
  let html = "";
  if (r.view === "game" && gameById(r.id)) html = viewGame(gameById(r.id));
  else if (r.view === "standings") html = viewStandings();
  else if (r.view === "me") html = viewMe();
  else html = viewGames();
  app.innerHTML = `<div class="view">${html}</div>`;
  document.body.classList.toggle("no-tabs", false);
  renderTabs(r.view === "game" ? "games" : r.view);
  bind();
  if (!me || !player(me)) openWhoSheet();
}

function renderTabs(active) {
  const t = (key, label, icon) => `<a href="#/${key}" class="${active === key ? "on" : ""}">${icon}<span>${label}</span></a>`;
  tabbar.innerHTML = t("games", "Partite", ICON.ball) + t("standings", "Classifica", ICON.trophy) + t("me", "Profilo", ICON.person);
}

function navbar({ title, back, right = "" }) {
  return `<header class="navbar"><div class="navrow">
    ${back ? `<a class="navbtn" href="${back.href}">${ICON.back}${esc(back.label)}</a>` : `<span style="min-width:60px"></span>`}
    <div class="center">${esc(title)}</div>
    <div class="navbtn right">${right}</div>
  </div></header>`;
}
const meAvatar = () => me && player(me) ? `<a href="#/me" class="avatar" style="text-decoration:none">${esc(initials(player(me).name))}</a>` : "";

// ---------- games list ----------
function usedCredits(g) {
  const ws = g.wagers[me] || [];
  return ws.reduce((s, w) => s + w.amount, 0);
}

function gameCard(g) {
  const st = gameStatus(g);
  const used = usedCredits(g);
  let foot;
  if (g.status === "settled") {
    const pts = g.results[me];
    foot = `<span>${g.participants} giocator${g.participants === 1 ? "e" : "i"}</span><span class="${pts > 0 ? "green" : ""}" style="font-weight:600">${pts != null ? `+${pts} pt` : "Non hai giocato"}</span>`;
  } else if (!g.locked) {
    foot = `<div style="flex:1;margin-right:16px"><div class="meter"><i style="width:${used}%"></i></div></div><span class="mono">${used}/${S.creditsPerGame}</span>`;
  } else {
    foot = `<span>${g.participants} giocator${g.participants === 1 ? "e" : "i"} in gara</span><span>${used ? `${used} crediti giocati` : "Nessuna giocata"}</span>`;
  }
  return `<a class="gcard" href="#/game/${g.id}">
    <div class="top"><span class="meta">${esc(fmtDate(g.startsAt))}</span><span class="pill ${st.cls}">${st.label}</span></div>
    <h3>${esc(g.title)}</h3>
    <div class="meta">${g.bets.length} scommess${g.bets.length === 1 ? "a" : "e"}${g.location ? " · " + esc(g.location) : ""}${!g.locked ? " · " + countdown(new Date(g.startsAt) - serverNow()) : ""}</div>
    <div class="foot">${foot}</div>
  </a>`;
}

function viewGames() {
  const open = S.games.filter((g) => !g.locked).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const closed = S.games.filter((g) => g.locked && g.status !== "settled");
  const final = S.games.filter((g) => g.status === "settled");
  const sec = (label, list) => list.length ? `<div class="section-h">${label}</div>${list.map(gameCard).join("")}<div style="height:16px"></div>` : "";
  const name = player(me)?.name;
  return navbar({ title: "Partite", right: meAvatar() }) +
    `<h1 class="largetitle">Partite</h1>` +
    (name ? `<p class="subtitle">Ciao ${esc(name)} — hai ${S.creditsPerGame} crediti da giocare in ogni partita.</p>` : "") +
    (S.games.length ? sec("In programma", open) + sec("In attesa dei risultati", closed) + sec("Concluse", final)
      : `<div class="empty"><div class="ico">🏀</div><h3>Ancora nessuna partita</h3><p>L'admin pubblicherà presto le scommesse per la prossima partita.</p></div>`);
}

// ---------- game detail ----------
function getDraft(g) {
  if (!drafts[g.id] || !dirty[g.id]) {
    drafts[g.id] = {};
    (g.wagers[me] || []).forEach((w) => (drafts[g.id][w.betId] = { optionId: w.optionId, amount: w.amount }));
  }
  return drafts[g.id];
}
const draftTotal = (d) => Object.values(d).reduce((s, x) => s + (x.amount || 0), 0);

function viewGame(g) {
  const st = gameStatus(g);
  const editable = !g.locked && me;
  const d = getDraft(g);
  const used = draftTotal(d);
  const left = S.creditsPerGame - used;

  let hero = "";
  if (editable) {
    hero = `<div class="credits-hero"><div class="row-x">
      <div class="big" id="left">${left}<small> / ${S.creditsPerGame} crediti rimasti</small></div>
      <div class="cd">Chiude alla palla a due<br><b class="tint">${countdown(new Date(g.startsAt) - serverNow())}</b></div>
    </div><div class="meter"><i id="leftbar" style="width:${used}%"></i></div></div>`;
  } else if (g.status === "settled") {
    const pts = g.results[me];
    hero = `<div class="credits-hero"><div class="row-x">
      <div class="big ${pts > 0 ? "green" : ""}">${pts != null ? "+" + pts : "—"}<small> punti</small></div>
      <div class="cd">${pts != null ? `Hai giocato ${usedCredits(g)} crediti` : "Non hai giocato"}</div></div></div>`;
  } else {
    hero = `<div class="credits-hero"><div class="row-x"><div><b>Scommesse chiuse</b><div class="hint" style="margin-top:4px">Ora le giocate di tutti sono visibili. I punti arrivano quando l'admin pubblica i risultati.</div></div></div></div>`;
  }

  const bets = g.bets.map((b, i) => betSection(g, b, i, d, left, editable)).join("");
  let ranking = "";
  if (g.status === "settled") {
    const rows = Object.entries(g.results).sort((a, b) => b[1] - a[1]);
    if (rows.length) ranking = `<div class="section-h">Risultati della partita</div><div class="section"><div class="list">${rows.map(([pid, pts], i) =>
      `<div class="row"><span class="rank">${i + 1}</span><span class="grow truncate">${esc(player(pid)?.name || "Ex giocatore")}${pid === me ? '<span class="me-tag">TU</span>' : ""}</span><span class="pts-r ${pts > 0 ? "green" : ""}">+${pts}</span></div>`).join("")}</div></div>`;
  }

  const dock = editable ? `<div class="dock"><div class="inner"><button class="btn" id="save" ${dirty[g.id] ? "" : "disabled"}>${dirty[g.id] ? "Salva giocate" : (g.wagers[me]?.length ? "Giocate salvate ✓" : "Scegli un'opzione per giocare")}</button></div></div>` : "";

  return navbar({ title: g.title, back: { href: "#/games", label: "Partite" }, right: `<span class="pill ${st.cls}">${st.label}</span>` }) +
    `<h1 class="largetitle">${esc(g.title)}</h1>
     <p class="subtitle">${esc(fmtDate(g.startsAt))}${g.location ? " · " + esc(g.location) : ""}</p>` +
    hero + bets + ranking + (editable ? `<div style="height:80px"></div>` : "") + dock;
}

function betSection(g, b, i, d, left, editable) {
  const mine = d[b.id];
  const settled = b.result != null;
  const opts = b.options.map((o) => {
    const on = mine?.optionId === o.id;
    const won = settled && b.result === o.id;
    const cls = settled ? (won ? "won" : "lost") : "";
    const pickers = !editable ? Object.entries(g.wagers).flatMap(([pid, ws]) => ws.filter((w) => w.betId === b.id && w.optionId === o.id).map((w) => ({ pid, amount: w.amount }))) : [];
    const pickersTxt = pickers.length ? `<div class="sub truncate">${pickers.map((p) => esc(player(p.pid)?.name || "?") + " " + p.amount).join(" · ")}</div>` : "";
    const tag = editable ? "button" : "div";
    return `<${tag} class="row opt ${cls}" ${editable ? `data-bet="${b.id}" data-opt="${o.id}"` : ""}>
      ${editable ? `<span class="radio ${on ? "on" : ""}"></span>` : (won ? ICON.check : on ? `<span class="radio on" style="width:18px;height:18px"></span>` : `<span style="width:18px;flex:none"></span>`)}
      <div class="grow"><div class="title">${esc(o.label)}</div>${pickersTxt}</div>
      <span class="odds">${odds(o.odds)}</span>
    </${tag}>`;
  }).join("");

  let stake = "";
  if (editable && mine) {
    const opt = b.options.find((o) => o.id === mine.optionId);
    stake = `<div class="stake" data-stake="${b.id}">
      <div class="stake-top">
        <div class="stepper">
          <button data-step="-1" ${mine.amount <= 0 ? "disabled" : ""}>−</button>
          <span class="val" data-val>${mine.amount}</span>
          <button data-step="1" ${left <= 0 ? "disabled" : ""}>+</button>
        </div>
        <span class="win" data-win>${mine.amount ? `Vinci ${Math.round(mine.amount * opt.odds)} pt` : "Scegli la puntata"}</span>
      </div>
      <input type="range" min="0" max="${S.creditsPerGame}" step="1" value="${mine.amount}" data-range>
      <div class="chips">
        <button class="chip" data-add="10">+10</button><button class="chip" data-add="25">+25</button>
        <button class="chip" data-add="all">All in</button><button class="chip" data-clear style="color:var(--red)">Rimuovi</button>
      </div>
    </div>`;
  }

  let foot = "";
  if (!editable && mine && settled) {
    const pts = b.result === "void" ? mine.amount : b.result === mine.optionId ? Math.round(mine.amount * (b.options.find((o) => o.id === mine.optionId)?.odds || 1)) : 0;
    foot = `<div class="section-f">Hai puntato ${mine.amount} → <b class="${pts ? "green" : "red"}">${pts ? "+" + pts + " pt" : "persa"}</b>${b.result === "void" ? " (scommessa annullata, puntata restituita)" : ""}</div>`;
  } else if (!editable && mine) {
    foot = `<div class="section-f">La tua puntata: ${mine.amount} crediti</div>`;
  }

  return `<div class="section-h">Scommessa ${i + 1}${b.result === "void" ? " · Annullata" : ""}</div>
    <div class="section"><div class="list">
      <div class="row"><div class="grow" style="font-weight:600">${esc(b.question)}</div></div>
      ${opts}${stake}
    </div>${foot}</div>`;
}

function bind() {
  const r = route();
  if (r.view !== "game") return;
  const g = gameById(r.id);
  if (!g || g.locked) return;
  const d = getDraft(g);
  const left = () => S.creditsPerGame - draftTotal(d);
  const changed = () => { dirty[g.id] = true; render(); };

  app.querySelectorAll("[data-opt]").forEach((el) => el.addEventListener("click", () => {
    const betId = el.dataset.bet, optionId = el.dataset.opt;
    const cur = d[betId];
    if (cur && cur.optionId === optionId) { delete d[betId]; }
    else d[betId] = { optionId, amount: cur ? cur.amount : Math.min(10, left()) };
    changed();
  }));

  app.querySelectorAll("[data-stake]").forEach((box) => {
    const betId = box.dataset.stake;
    const w = d[betId];
    const set = (v) => { w.amount = Math.max(0, Math.min(v, w.amount + left())); };
    box.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
      const dir = +b.dataset.step;
      set(dir > 0 ? Math.floor(w.amount / STEP) * STEP + STEP : Math.ceil(w.amount / STEP) * STEP - STEP);
      changed();
    }));
    box.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
      set(b.dataset.add === "all" ? w.amount + left() : w.amount + +b.dataset.add);
      changed();
    }));
    box.querySelector("[data-clear]").addEventListener("click", () => { delete d[betId]; changed(); });
    const range = box.querySelector("[data-range]");
    range.addEventListener("input", () => {
      set(+range.value);
      range.value = w.amount;
      const opt = g.bets.find((b) => b.id === betId).options.find((o) => o.id === w.optionId);
      box.querySelector("[data-val]").textContent = w.amount;
      box.querySelector("[data-win]").textContent = w.amount ? `Vinci ${Math.round(w.amount * opt.odds)} pt` : "Scegli la puntata";
      const used = draftTotal(d);
      $("#left").firstChild.textContent = S.creditsPerGame - used;
      $("#leftbar").style.width = used + "%";
    });
    range.addEventListener("change", changed);
  });

  $("#save")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const wagers = Object.entries(d).filter(([, w]) => w.amount > 0).map(([betId, w]) => ({ betId, ...w }));
      await rpc("save_wagers", { p_game: g.id, p_player: me, p_wagers: wagers });
      dirty[g.id] = false;
      toast("Giocate salvate 🏀");
      if (navigator.vibrate) navigator.vibrate(15);
      await load();
    } catch (err) { toast(err.message, true); e.target.disabled = false; }
  });
}

// ---------- standings ----------
function viewStandings() {
  const lb = S.leaderboard;
  const medal = ["🥇", "🥈", "🥉"];
  const top = lb.slice(0, 3);
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top;
  const podium = lb.length && lb[0].points > 0 ? `<div class="podium">${order.map((r) => {
    const idx = lb.indexOf(r);
    return `<div class="p ${idx === 0 ? "first" : ""}"><div class="avatar">${esc(initials(r.name))}</div>
      <div class="block" style="padding-top:${idx === 0 ? 22 : idx === 1 ? 14 : 8}px"><div class="medal">${medal[idx]}</div><div class="name">${esc(r.name)}</div><div class="pts">${r.points} pt</div></div></div>`;
  }).join("")}</div>` : "";
  const list = lb.length ? `<div class="section"><div class="list">${lb.map((r, i) =>
    `<div class="row indent"><span class="rank">${i + 1}</span>
      <div class="grow"><div class="title truncate">${esc(r.name)}${r.playerId === me ? '<span class="me-tag">TU</span>' : ""}</div>
      <div class="sub">${r.games} partit${r.games === 1 ? "a" : "e"} · ${r.wins} giocat${r.wins === 1 ? "a vincente" : "e vincenti"}</div></div>
      <span class="pts-r">${r.points}</span></div>`).join("")}</div>
      <div class="section-f">Punti = crediti puntati × quota di ogni giocata vincente, sommati su tutte le partite concluse.</div></div>`
    : `<div class="empty"><div class="ico">🏆</div><h3>Ancora nessun giocatore</h3></div>`;
  return navbar({ title: "Classifica", right: meAvatar() }) + `<h1 class="largetitle">Classifica</h1>` + podium + list;
}

// ---------- me ----------
function viewMe() {
  const p = player(me);
  if (!p) return navbar({ title: "Profilo" }) + `<h1 class="largetitle">Profilo</h1>`;
  const rankIdx = S.leaderboard.findIndex((r) => r.playerId === me);
  const row = S.leaderboard[rankIdx] || { points: 0, games: 0 };
  const history = S.games.filter((g) => g.status === "settled" && g.results[me] != null);
  return navbar({ title: p.name }) +
    `<h1 class="largetitle">Profilo</h1>
    <div class="section"><div class="list"><div class="row" style="padding:16px">
      <div class="avatar lg">${esc(initials(p.name))}</div>
      <div class="grow"><div style="font-size:22px;font-weight:600">${esc(p.name)}</div>
      <div class="sub">#${rankIdx + 1} di ${S.leaderboard.length} · ${row.points} pt · ${row.games} partit${row.games === 1 ? "a" : "e"}</div></div>
    </div></div></div>
    ${history.length ? `<div class="section-h">Storico</div><div class="section"><div class="list">${history.map((g) =>
      `<a class="row" href="#/game/${g.id}"><div class="grow"><div class="title truncate">${esc(g.title)}</div><div class="sub">${esc(fmtDate(g.startsAt))}</div></div>
       <span class="pts-r ${g.results[me] > 0 ? "green" : ""}">+${g.results[me]}</span>${ICON.chev}</a>`).join("")}</div></div>` : ""}
    <div class="section"><div class="list"><button class="row" id="switch"><span class="grow tint">Cambia giocatore</span></button></div>
    <div class="section-f">Questo telefono si ricorda chi sei. Cambia se lo sta usando qualcun altro.</div></div>`;
}

document.addEventListener("click", (e) => {
  if (e.target.closest("#switch")) openWhoSheet(true);
});

// ---------- who are you? ----------
let sheetOpen = false;
function openWhoSheet(dismissable = false) {
  if (sheetOpen) return;
  sheetOpen = true;
  const wrap = document.createElement("div");
  const close = () => { wrap.remove(); sheetOpen = false; };
  wrap.innerHTML = `<div class="backdrop"></div><div class="sheet" role="dialog" aria-label="Scegli giocatore">
    <div class="grabber"></div>
    <h2>Chi gioca? 🏀</h2>
    <p class="lead">Scegli il tuo nome. Niente password — gioca pulito!</p>
    ${S.players.length ? `<div class="section-h">Giocatori</div><div class="section"><div class="list">${S.players.map((p) =>
      `<button class="row indent" data-pick="${p.id}"><span class="avatar">${esc(initials(p.name))}</span><span class="grow">${esc(p.name)}</span>${p.id === me ? ICON.check : ""}</button>`).join("")}</div></div>` : ""}
    <div class="section-h">Sei nuovo?</div>
    <div class="section"><div class="list"><div class="field"><input id="newname" placeholder="Il tuo nome" maxlength="30" autocomplete="nickname"></div></div></div>
    <div class="section"><button class="btn" id="join">Entra nella sfida</button>${dismissable ? `<button class="btn plain" id="cancel">Annulla</button>` : ""}</div>
  </div>`;
  document.body.appendChild(wrap);
  const pick = (id) => { me = id; store.set("playerId", id); close(); load(); };
  wrap.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => pick(b.dataset.pick)));
  const join = async () => {
    const name = $("#newname", wrap).value.trim();
    if (!name) return $("#newname", wrap).focus();
    try { const p = await rpc("add_player", { p_name: name }); pick(p.id); toast(`Benvenuto, ${p.name}!`); }
    catch (e) { toast(e.message, true); }
  };
  $("#join", wrap).addEventListener("click", join);
  $("#newname", wrap).addEventListener("keydown", (e) => e.key === "Enter" && join());
  if (dismissable) { $("#cancel", wrap).addEventListener("click", close); $(".backdrop", wrap).addEventListener("click", close); }
}

// refresh periodically, but never wipe unsaved picks
load();
setInterval(() => {
  if (document.hidden || sheetOpen || document.activeElement?.type === "range") return;
  load();
}, 20000);
document.addEventListener("visibilitychange", () => !document.hidden && load());
