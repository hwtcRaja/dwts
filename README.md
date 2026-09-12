# Dance Party Score Tracker

A weekly ballroom-style score tracker with live phone voting for guests.
Self-hosted version — Node/Express backend, Postgres database, plain HTML/JS
frontend. No build step.

## What's inside

- `server.js` — Express API + serves the frontend. Creates its own database
  tables on first boot.
- `public/` — the frontend (`index.html`, `app.js`, `styles.css`). Plain
  JavaScript, no framework or bundler.
- Data model: a season (name, judges, points-per-vote, active week), couples,
  weeks, per-couple scores, and one vote row per guest per week.

## Deploying to Railway

1. **Push this folder to a GitHub repo** (Railway deploys from a repo, or you
   can use the Railway CLI to deploy a local folder directly — `railway up`
   from inside this directory works too, if you'd rather skip GitHub).

2. **Create a new Railway project** and deploy this repo as a service.
   Railway auto-detects Node from `package.json` and runs `npm install` then
   `npm start`.

3. **Add a PostgreSQL database** to the project: in the Railway dashboard,
   click **+ New → Database → PostgreSQL**. Railway automatically injects a
   `DATABASE_URL` variable into your service — you don't need to copy
   anything by hand, just make sure the Postgres plugin and your app service
   are in the same Railway project.

4. **Generate a public domain** for the service: in your service's
   **Settings → Networking**, click **Generate Domain**. That gives you a
   `https://your-app.up.railway.app` URL.

5. Open that URL. On first load the app creates its tables automatically —
   nothing else to run.

That's it — send the Railway URL to your guests. On their phones they'll tap
**I'm voting**; you tap **I'm hosting** on whatever device you're running the
show from.

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
  the roster, and vote. There's no login. That's fine for a link you only
  share with your own guests, but don't post it anywhere public. If you want
  real access control later, the natural next step is adding a simple host
  password on the season-editing routes.
- The "Switch view" button just changes what your *own* browser shows
  (stored in `localStorage`) — it doesn't affect anyone else's device.
- Judge scores, bonus points, and votes all live in Postgres, so the season
  persists across restarts and redeploys.
