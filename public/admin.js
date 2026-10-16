// PolSenna Bets — admin page (reached via admin.html?key=...)
const app = $("#app");
const qsKey = new URLSearchParams(location.search).get("key");
if (qsKey) store.set("adminKey", qsKey);
const KEY = qsKey || store.get("adminKey") || "";
const adm = (fn, args = {}) => rpc("admin_" + fn, { p_key: KEY, ...args });
const siteUrl = new URL("./", location.href).href;

let S = null;
let ed = null;        // game being edited
let res = null;       // results being entered
let tab = "games";

const player = (id) => S?.players.find((p) => p.id === id);
const gameById = (id) => S?.games.find((g) => g.id === id);
const uid = () => Math.random().toString(36).slice(2, 10);

async function load() {
  try { S = enrich(await adm("state")); render(); }
  catch (e) {
    app.innerHTML = `<div class="empty" style="padding-top:120px"><div class="ico">🔒</div><h3>Solo admin</h3><p>${esc(e.message)}. Apri admin.html?key=LA_TUA_CHIAVE (la chiave compare alla fine dello script di setup di Supabase).</p></div>`;
  }
}

function route() { const [, view = "home", id] = location.hash.split("/"); return { view, id }; }
window.addEventListener("hashchange", () => { prepare(); render(); window.scrollTo(0, 0); });
window.addEventListener("scroll", () => $(".navbar")?.classList.toggle("scrolled", window.scrollY > 30), { passive: true });

function prepare() {
  const r = route();
  if (r.view === "edit") {
    const g = r.id === "new" ? null : gameById(r.id);
    const next = new Date(Date.now() + 3 * 864e5); next.setHours(21, 0, 0, 0);
    ed = g ? JSON.parse(JSON.stringify({ id: g.id, title: g.title, location: g.location, startsAt: toLocal(g.startsAt), bets: g.bets }))
      : { title: "", location: "", startsAt: toLocal(next.toISOString()), bets: [tpl.winner()] };
  }
  if (r.view === "settle") {
    const g = gameById(r.id);
    res = {}; g?.bets.forEach((b) => (res[b.id] = b.result ?? null));
  }
}

function toLocal(iso) {
  const d = new Date(iso), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function navbar({ title, back, right = "" }) {
  return `<header class="navbar"><div class="navrow">
    ${back ? `<a class="navbtn" href="${back.href}">${ICON.back}${esc(back.label)}</a>` : `<span style="min-width:60px"></span>`}
    <div class="center">${esc(title)}</div><div class="navbtn right">${right}</div></div></header>`;
}

function render() {
  if (!S) return;
  const r = route();
  let html;
  if (r.view === "edit" && ed) html = viewEdit();
  else if (r.view === "settle" && gameById(r.id)) html = viewSettle(gameById(r.id));
  else if (r.view === "game" && gameById(r.id)) html = viewGame(gameById(r.id));
  else html = viewHome();
  app.innerHTML = `<div class="view">${html}</div>`;
}

// ---------- home ----------
function viewHome() {
  const seg = `<div class="seg"><button data-tab="games" class="${tab === "games" ? "on" : ""}">Partite</button><button data-tab="players" class="${tab === "players" ? "on" : ""}">Giocatori</button></div>`;
  let body;
  if (tab === "games") {
    body = `<div class="section"><a class="btn" href="#/edit/new" style="text-decoration:none">＋ Nuova partita</a></div>` +
      (S.games.length ? `<div class="section"><div class="list">${S.games.map((g) => {
        const st = gameStatus(g);
        return `<a class="row" href="#/game/${g.id}"><div class="grow"><div class="title truncate">${esc(g.title)}</div>
          <div class="sub">${esc(fmtDate(g.startsAt))} · ${g.participants} in gara</div></div><span class="pill ${st.cls}">${st.label}</span>${ICON.chev}</a>`;
      }).join("")}</div></div>` : `<div class="empty"><div class="ico">🏀</div><h3>Ancora nessuna partita</h3><p>Crea la prima partita e aggiungi le scommesse.</p></div>`);
  } else {
    body = `<div class="section"><div class="list">${S.players.map((p) =>
      `<div class="row indent"><span class="avatar">${esc(initials(p.name))}</span><span class="grow truncate">${esc(p.name)}</span>
        <button class="btn plain" style="width:auto;min-height:0;padding:0 4px" data-rename="${p.id}">Rinomina</button>
        <button class="btn plain" style="width:auto;min-height:0;padding:0 4px;color:var(--red)" data-del="${p.id}">Elimina</button></div>`).join("") ||
      `<div class="row"><span class="grow detail">Ancora nessun giocatore — gli amici possono aggiungersi dall'app.</span></div>`}
      <div class="field"><input id="addp" placeholder="Aggiungi giocatore…" maxlength="30"><button class="btn plain" style="width:auto" id="addpb">Aggiungi</button></div>
    </div></div>`;
  }
  const playerLink = siteUrl;
  return navbar({ title: "Admin" }) + `<h1 class="largetitle">Admin</h1>` + seg + body +
    `<div class="section-h">Condividi</div><div class="section"><div class="list">
      <button class="row" data-copy="${esc(playerLink)}"><div class="grow"><div class="title">Copia link per i giocatori</div><div class="sub truncate">${esc(playerLink)}</div></div></button>
      <button class="row" data-copy="${esc(siteUrl + "admin.html?key=" + KEY)}"><div class="grow"><div class="title">Copia link admin</div><div class="sub">Tienilo segreto — chi lo ha può modificare tutto</div></div></button>
    </div></div>`;
}

// ---------- game detail ----------
function viewGame(g) {
  const st = gameStatus(g);
  const wagered = Object.entries(g.wagers).filter(([, ws]) => ws.length);
  const notIn = S.players.filter((p) => !g.wagers[p.id]?.length);
  return navbar({ title: g.title, back: { href: "#/", label: "Admin" }, right: `<span class="pill ${st.cls}">${st.label}</span>` }) +
    `<h1 class="largetitle">${esc(g.title)}</h1><p class="subtitle">${esc(fmtDate(g.startsAt))}${g.location ? " · " + esc(g.location) : ""}</p>
    <div class="section" style="display:flex;gap:10px">
      <a class="btn secondary" href="#/edit/${g.id}" style="text-decoration:none">Modifica</a>
      <a class="btn" href="#/settle/${g.id}" style="text-decoration:none">${g.status === "settled" ? "Modifica risultati" : "Inserisci risultati"}</a>
    </div>
    ${!g.locked ? `<div class="section-f" style="margin:-16px 32px 24px">Le giocate si chiudono automaticamente il ${esc(fmtDate(g.startsAt))}.</div>` : ""}
    ${g.bets.map((b, i) => `<div class="section-h">Scommessa ${i + 1}</div><div class="section"><div class="list">
      <div class="row"><div class="grow" style="font-weight:600">${esc(b.question)}</div></div>
      ${b.options.map((o) => {
        const picks = wagered.flatMap(([pid, ws]) => ws.filter((w) => w.betId === b.id && w.optionId === o.id).map((w) => esc(player(pid)?.name || "?") + " " + w.amount));
        return `<div class="row ${b.result ? (b.result === o.id ? "won" : "lost") : ""}">${b.result === o.id ? ICON.check : ""}<div class="grow"><div class="title">${esc(o.label)}</div>${picks.length ? `<div class="sub">${picks.join(" · ")}</div>` : ""}</div><span class="detail mono">${odds(o.odds)}</span></div>`;
      }).join("")}</div></div>`).join("")}
    <div class="section-h">Giocatori (${wagered.length}/${S.players.length})</div><div class="section"><div class="list">
      ${wagered.map(([pid, ws]) => `<div class="row"><span class="grow">${esc(player(pid)?.name || "?")}</span><span class="detail mono">${ws.reduce((s, w) => s + w.amount, 0)} crediti${g.status === "settled" ? ` · <b class="green">+${g.results[pid] || 0}</b>` : ""}</span></div>`).join("")}
      ${notIn.map((p) => `<div class="row"><span class="grow detail">${esc(p.name)}</span><span class="hint">nessuna giocata</span></div>`).join("")}
    </div></div>
    <div class="section">${g.status !== "open" ? `<button class="btn secondary" id="reopen" style="margin-bottom:10px">Cancella risultati e riapri</button>` : ""}
      <button class="btn destructive" id="delgame">Elimina partita</button></div>`;
}

// ---------- editor ----------
const tpl = {
  winner: () => ({ question: "Chi vince?", options: [{ label: "PolSenna", odds: 1.8 }, { label: "Avversari", odds: 2.2 }] }),
  total: () => ({ question: "Punti totali della partita", options: [{ label: "Over 120.5", odds: 1.9 }, { label: "Under 120.5", odds: 1.9 }] }),
  margin: () => ({ question: "Scarto finale", options: [{ label: "PolSenna di 1–9", odds: 3 }, { label: "PolSenna di 10+", odds: 3.5 }, { label: "Avversari di 1–9", odds: 3 }, { label: "Avversari di 10+", odds: 4 }] }),
  scorer: () => ({ question: "Miglior marcatore", options: [{ label: "", odds: 3 }, { label: "", odds: 3 }, { label: "", odds: 3 }] }),
  custom: () => ({ question: "", options: [{ label: "Sì", odds: 2 }, { label: "No", odds: 2 }] }),
};

function viewEdit() {
  const isNew = !ed.id;
  return navbar({ title: isNew ? "Nuova partita" : "Modifica partita", back: { href: isNew ? "#/" : `#/game/${ed.id}`, label: "Annulla" } }) +
    `<h1 class="largetitle">${isNew ? "Nuova partita" : "Modifica partita"}</h1>
    <div class="section-h">Partita</div><div class="section"><div class="list">
      <div class="field"><label>Titolo</label><input data-k="title" value="${esc(ed.title)}" placeholder="PolSenna vs Cantù"></div>
      <div class="field"><label>Dove</label><input data-k="location" value="${esc(ed.location)}" placeholder="Facoltativo"></div>
      <div class="field"><label>Palla a due</label><input type="datetime-local" data-k="startsAt" value="${esc(ed.startsAt)}"></div>
    </div><div class="section-f">Le giocate si chiudono automaticamente alla palla a due.</div></div>
    ${ed.bets.map((b, i) => `<div class="section-h" style="display:flex;justify-content:space-between"><span>Scommessa ${i + 1}</span><button class="btn plain" style="width:auto;min-height:0;padding:0;font-size:13px;color:var(--red)" data-delbet="${i}">RIMUOVI</button></div>
      <div class="section"><div class="list">
        <div class="field"><input data-q="${i}" value="${esc(b.question)}" placeholder="Domanda, es. Chi vince?" style="font-weight:600"></div>
        ${b.options.map((o, j) => `<div class="field">
          ${b.options.length > 2 ? `<button class="x" data-delopt="${i}.${j}" aria-label="Rimuovi opzione">${ICON.minus}</button>` : ""}
          <input data-ol="${i}.${j}" value="${esc(o.label)}" placeholder="Opzione ${j + 1}">
          <span class="hint">×</span><input class="odds" data-oo="${i}.${j}" type="number" inputmode="decimal" min="1" step="0.1" value="${o.odds}">
        </div>`).join("")}
        <button class="row" data-addopt="${i}"><span class="tint">＋ Aggiungi opzione</span></button>
      </div></div>`).join("")}
    <div class="section-h">Aggiungi una scommessa</div>
    <div class="section"><div class="chips" style="margin:0">
      <button class="chip" data-tpl="winner">Vincente</button><button class="chip" data-tpl="total">Over/Under</button>
      <button class="chip" data-tpl="margin">Scarto</button><button class="chip" data-tpl="scorer">Marcatore</button>
      <button class="chip" data-tpl="custom">Personalizzata</button>
    </div><div class="section-f" style="margin-left:0">Il numero × è la quota: 10 crediti puntati a ×2.5 vincono 25 punti.</div></div>
    <div style="height:90px"></div>
    <div class="dock"><div class="inner"><button class="btn" id="saveg">${isNew ? "Pubblica partita" : "Salva modifiche"}</button></div></div>`;
}

// ---------- results ----------
function viewSettle(g) {
  const done = g.bets.every((b) => res[b.id]);
  return navbar({ title: "Risultati", back: { href: `#/game/${g.id}`, label: "Indietro" } }) +
    `<h1 class="largetitle">Risultati</h1><p class="subtitle">${esc(g.title)} — indica cosa è successo davvero.</p>
    ${g.bets.map((b, i) => `<div class="section-h">Scommessa ${i + 1}</div><div class="section"><div class="list">
      <div class="row"><div class="grow" style="font-weight:600">${esc(b.question)}</div></div>
      ${[...b.options, { id: "void", label: "Annullata — restituisci le puntate", odds: null }].map((o) =>
        `<button class="row opt" data-res="${b.id}" data-v="${o.id}"><span class="radio ${res[b.id] === o.id ? "on" : ""}"></span><span class="grow ${o.id === "void" ? "detail" : ""}">${esc(o.label)}</span>${o.odds ? `<span class="odds">${odds(o.odds)}</span>` : ""}</button>`).join("")}
    </div></div>`).join("")}
    <div style="height:90px"></div>
    <div class="dock"><div class="inner"><button class="btn" id="saveres">${done ? "Pubblica risultati" : "Salva (la partita resta in sospeso)"}</button></div></div>`;
}

// Drop empty rows, give new bets/options ids, keep existing results.
function cleanBets(bets) {
  return bets.map((b) => ({
    id: b.id || uid(),
    question: b.question.trim().slice(0, 140),
    options: b.options.filter((o) => o.label.trim()).map((o) => ({ id: o.id || uid(), label: o.label.trim().slice(0, 60), odds: Math.max(1, Math.round((+o.odds || 1) * 100) / 100) })),
    result: b.result ?? null,
  })).filter((b) => b.question);
}

// ---------- events ----------
const [bi, oi] = [(s) => +s.split(".")[0], (s) => +s.split(".")[1]];

app.addEventListener("input", (e) => {
  const t = e.target, d = t.dataset;
  if (!ed) return;
  if (d.k) ed[d.k] = t.value;
  if (d.q) ed.bets[+d.q].question = t.value;
  if (d.ol) ed.bets[bi(d.ol)].options[oi(d.ol)].label = t.value;
  if (d.oo) ed.bets[bi(d.oo)].options[oi(d.oo)].odds = parseFloat(t.value) || 1;
});

app.addEventListener("click", async (e) => {
  const t = e.target.closest("button, a");
  if (!t) return;
  const d = t.dataset;
  try {
    if (d.tab) { tab = d.tab; render(); }
    else if (d.copy) { await navigator.clipboard.writeText(d.copy); toast("Link copiato"); }
    else if (d.tpl) { ed.bets.push(tpl[d.tpl]()); render(); window.scrollTo(0, document.body.scrollHeight); }
    else if (d.delbet) { ed.bets.splice(+d.delbet, 1); render(); }
    else if (d.addopt) { ed.bets[+d.addopt].options.push({ label: "", odds: 2 }); render(); }
    else if (d.delopt) { ed.bets[bi(d.delopt)].options.splice(oi(d.delopt), 1); render(); }
    else if (d.res) { res[d.res] = res[d.res] === d.v ? null : d.v; render(); }
    else if (t.id === "saveg") {
      if (!ed.title.trim()) return toast("Dai un titolo alla partita", true);
      const body = { id: ed.id, title: ed.title.trim(), location: ed.location.trim(), startsAt: new Date(ed.startsAt).toISOString(), bets: cleanBets(ed.bets) };
      t.disabled = true;
      const g = await adm("save_game", { p_game: body });
      toast(ed.id ? "Salvato" : "Partita pubblicata 🏀");
      ed = null; await load(); location.hash = `#/game/${g.id}`;
    }
    else if (t.id === "saveres") {
      const id = route().id;
      t.disabled = true;
      await adm("settle", { p_id: id, p_results: res });
      toast("Risultati salvati — classifica aggiornata");
      await load(); location.hash = `#/game/${id}`;
    }
    else if (t.id === "reopen") {
      if (!confirm("Cancellare i risultati e riaprire le giocate? (Si chiudono comunque alla palla a due.)")) return;
      await adm("reopen", { p_id: route().id }); await load();
    }
    else if (t.id === "delgame") {
      if (!confirm("Eliminare questa partita e tutte le giocate? Non si può annullare.")) return;
      await adm("delete_game", { p_id: route().id }); toast("Partita eliminata"); await load(); location.hash = "#/";
    }
    else if (d.rename) {
      const name = prompt("Nuovo nome", player(d.rename).name);
      if (name) { await adm("rename_player", { p_id: d.rename, p_name: name }); await load(); }
    }
    else if (d.del) {
      if (!confirm(`Rimuovere ${player(d.del).name} e tutte le sue giocate?`)) return;
      await adm("delete_player", { p_id: d.del }); await load();
    }
    else if (t.id === "addpb") {
      const name = $("#addp").value.trim();
      if (name) { await adm("add_player", { p_name: name }); await load(); }
    }
  } catch (err) { toast(err.message, true); t.disabled = false; }
});

load().then(prepare).then(render);
