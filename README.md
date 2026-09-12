# Dance Party Score Tracker

A weekly ballroom-style score tracker where your party guests *are* the
judges — everyone scores each couple 1–10 from their own phone, and the
average becomes that couple's score for the week. No separate host scoring,
no bonus points, just one source of truth.

Self-hosted version — Node/Express backend, Postgres database, plain HTML/JS
frontend. No build step.

## How it works

- **Host** manages the roster and the weeks (add couples, mark eliminations,
  start a new week, set the theme) and watches the leaderboard. The host
  never enters a score.
- **Judges** are anyone who opens the app on their phone and taps "I'm a
  judge." First time, they type their name (or pick it from a list of past
  judges); after that it's remembered on their phone, so they can come back
  week after week and just tap their name.
- Each judge scores every couple 1–10 for the current week, and can change
  any score at any time while that week is open. A couple's score for the
  week is the **average across every judge who scored them**. Those weekly
  averages sum into the season leaderboard.

## What's inside

- `server.js` — Express API + serves the frontend. Creates its own database
  tables on first boot.
- `public/` — the frontend (`index.html`, `app.js`, `styles.css`). Plain
  JavaScript, no framework or bundler.
- Data model: a season (name, active week), couples, weeks, and one score
  row per judge per couple per week.

## Deploying to Railway

1. **Push this folder to a GitHub repo** (Railway deploys from a repo, or you
   can use the Railway CLI to deploy a local folder directly — `railway up`
   from inside this directory works too, if you'd rather skip GitHub).

2. **Create a new Railway project** and deploy this repo as a service.
   Railway auto-detects Node from `package.json` and runs `npm install` then
   `npm start`.

3. **Add a PostgreSQL database** to the project: in the Railway dashboard,
   click **+ New → Database → PostgreSQL**. Then, on your app service's
   **Variables** tab, add a variable named exactly `DATABASE_URL` and set it
   to a *reference* (not typed text) pointing at the Postgres service's
   `DATABASE_URL` — Railway's variable picker will offer this for you.

4. **Generate a public domain** for the service: in your service's
   **Settings → Networking**, click **Generate Domain**. That gives you a
   `https://your-app.up.railway.app` URL.

5. Open that URL. On first load the app creates its tables automatically —
   nothing else to run.

That's it — send the Railway URL to everyone at the party. Guests tap
**I'm a judge**; you tap **I'm hosting** on whatever device you're running
the show from.

## Running locally

```bash
npm install
# create a local Postgres database, then:
cp .env.example .env
# edit .env with your local DATABASE_URL
npm start
```

Then open `http://localhost:3000`.

## Notes

- **This is a public app** by default — anyone with the URL can open it, see
  the roster, and judge. There's no login. That's fine for a link you only
  share with your own guests, but don't post it anywhere public. If you want
  real access control later, the natural next step is adding a simple host
  password on the season-editing routes.
- The "Switch view" button and "not you?" link only change what your *own*
  browser shows (stored in `localStorage`) — they don't affect anyone else's
  device or scores.
- If nobody scores a couple in a given week, that couple simply gets 0 for
  that week — there's no manual override.
- All scores live in Postgres, so the season persists across restarts and
  redeploys.
