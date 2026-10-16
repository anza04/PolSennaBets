# PolSenna Bets 🏀

Friendly points-only betting on our basketball games. No money, no passwords.

**Live:** https://anza04.github.io/PolSennaBets/ · Admin: `…/admin.html?key=YOUR_KEY`

## How it works
- **Players** open the link, pick their name (or add themselves) and get **100 credits per game**.
- For each game they split credits across the bets (one pick per bet). Picks can be changed until **tip-off**, then betting locks automatically and everyone's picks become visible (before that, you only see your own).
- **Points won** = credits staked × odds of the winning option. A *void* bet refunds the stake as points. Unused credits are lost.
- **Standings** sum the points over all finished games.
- **Admin** creates games, adds bets (templates: winner, over/under, margin, top scorer, custom), sets odds, enters results and manages players.

## Architecture
- `public/` — static site (HTML/CSS/JS, no build step), deployed to **GitHub Pages** by `.github/workflows/pages.yml` on every push to `main`.
- `supabase/setup.sql` — database tables plus the functions the site calls. The tables are locked (RLS, no direct access); the functions enforce the rules: the tip-off lock, the 100-credit cap, one pick per bet, hidden picks before tip-off, and the admin key.

## Setup (one time)
1. **Supabase** → SQL Editor → paste `supabase/setup.sql` → Run. The result row shows your **admin key**. (Lost it? Run `select admin_key from settings;`. To change it: `update settings set admin_key = 'something-new';`.)
2. **GitHub** → repo Settings → Pages → Source: **GitHub Actions**.
3. Push to `main`; the site goes live at the URL above.

The Supabase URL and anon key are in `public/common.js`. The anon key is meant to be public.

## Run locally
```bash
python -m http.server 8000 --directory public
```
Then open http://localhost:8000. It talks to the same Supabase database.

On iPhone: open the link in Safari → Share → **Add to Home Screen**.
