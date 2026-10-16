// Shared helpers for the player app and the admin page.
const $ = (sel, el = document) => el.querySelector(sel);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Supabase project (the anon key is public by design; the database functions enforce the rules)
const SUPABASE_URL = "https://rchvxermhfnhvauunmle.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjaHZ4ZXJtaGZuaHZhdXVubWxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxNTA1MTcsImV4cCI6MjEwNzcyNjUxN30.wh1e77MCctszyscZlriRneTX0A-8J9-lCcTVN8DKzqk";

async function rpc(fn, args = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify(args),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Error ${res.status}`);
  return data;
}

// ---------- scoring (mirrors what everyone can see once a game is locked) ----------
function wagerPoints(g, w) {
  const bet = g.bets.find((b) => b.id === w.betId);
  if (!bet || bet.result == null) return 0;
  if (bet.result === "void") return w.amount;
  if (bet.result !== w.optionId) return 0;
  const opt = bet.options.find((o) => o.id === w.optionId);
  return Math.round(w.amount * (opt ? opt.odds : 1));
}

// Adds g.results {playerId: points} to each game and builds the leaderboard.
function enrich(state) {
  const rows = Object.fromEntries(state.players.map((p) => [p.id, { playerId: p.id, name: p.name, points: 0, games: 0, wins: 0 }]));
  for (const g of state.games) {
    g.results = {};
    if (g.status !== "settled") continue;
    const res = Object.fromEntries(g.bets.map((b) => [b.id, b.result]));
    for (const [pid, ws] of Object.entries(g.wagers)) {
      if (!ws.length) continue;
      g.results[pid] = ws.reduce((s, w) => s + wagerPoints(g, w), 0);
      if (!rows[pid]) continue;
      rows[pid].games++;
      rows[pid].points += g.results[pid];
      rows[pid].wins += ws.filter((w) => res[w.betId] === w.optionId).length;
    }
  }
  state.leaderboard = Object.values(rows).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return state;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

function toast(msg, err = false) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) +
    " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function countdown(ms) {
  if (ms <= 0) return "Started";
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h left`;
  if (h > 0) return `${h}h ${m % 60}m left`;
  return `${Math.max(1, m)}m left`;
}

function gameStatus(g) {
  if (g.status === "settled") return { cls: "final", label: "Final" };
  if (g.locked) return { cls: "live", label: g.status === "closed" ? "Awaiting results" : "Closed" };
  return { cls: "open", label: "Open" };
}

const odds = (o) => "×" + Number(o).toFixed(o % 1 ? 2 : 1).replace(/0$/, "");

const ICON = {
  back: '<svg viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2 2 10l8 8"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m1.5 1.5 5 5-5 5"/></svg>',
  check: '<svg class="check" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9.5 4 4 8-9"/></svg>',
  ball: '<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="13" cy="13" r="10"/><path d="M3 13h20M13 3v20M6 5.5c3 2.5 4.5 5 4.5 7.5S9 18 6 20.5M20 5.5c-3 2.5-4.5 5-4.5 7.5s1.5 5 4.5 7.5"/></svg>',
  trophy: '<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M8 4h10v6a5 5 0 0 1-10 0V4Z"/><path d="M8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M18 6h3.5v1.5A3.5 3.5 0 0 1 18 11M13 15v4M9 22h8M10 19h6"/></svg>',
  person: '<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="13" cy="9" r="4.5"/><path d="M4.5 22c1-4.5 4.5-7 8.5-7s7.5 2.5 8.5 7"/></svg>',
  minus: '<svg viewBox="0 0 22 22"><circle cx="11" cy="11" r="10" fill="currentColor"/><path d="M6.5 11h9" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
};
