# Study Grove

A personal study planner where every focus session grows a tree on a small 3D island.

- **Today**: your island, the focus timer, today's tasks, reviews due and exam countdowns.
- **Subjects**: subjects split into topics, each with a status (to do, learning, done) and a 1–5 confidence rating.
- **Reviews**: finished topics come back after 1, 3, 7, 21 and 45 days. "Shaky" restarts the schedule.
- **Exams**: days left and how many topics a day keep you on track.
- **Stats**: a 26-week heatmap, streaks, time per subject and your level.

The lantern in the middle of the island stays lit while your streak is alive. Fireflies come out after 3 days in a row. The sky follows the time of day.

## Run it on the laptop

Double-click `start.cmd`, or run:

```
npx serve -l tcp://127.0.0.1:5173 E:\study-grove
```

Then open http://localhost:5173. Only this computer can reach it. It needs a local server; opening `index.html` directly from the folder won't work, because browsers block ES modules on `file://` pages.

Keyboard: `Space` starts or pauses the timer, `N` adds a task, `Esc` leaves focus mode.

## Use it on the phone (POCO X8 Pro)

**On the same Wi-Fi (quick test).** Run `start-phone.cmd` instead of `start.cmd`. This makes the app reachable from other devices, so only do it on a network you trust. Find the laptop's IP with `ipconfig` (e.g. 192.168.1.20) and open `http://192.168.1.20:5173` in Chrome on the phone. Everything works, but Chrome only offers "Install app" on HTTPS pages.

**Installed as an app (recommended).** Host the folder on any free HTTPS static host (Vercel, Netlify or GitHub Pages). Open the link in Chrome on the phone, then tap ⋮ and choose **Add to Home screen** (or **Install app**). It opens full-screen like a normal app and works offline after the first load.

HyperOS tip: if the timer chime doesn't play when the screen is off, go to Settings → Apps → Chrome → Battery saver and choose **No restrictions**.

## Your data

Everything is saved in the browser on each device (localStorage); nothing is uploaded. The laptop and phone keep separate data. To move it, use **Settings → Export backup** on one device and **Import backup** on the other. Export a backup now and then to keep it safe.

## Security

- **Nothing loads from other servers.** Three.js (`vendor/three`, from the official npm package) and the fonts (`fonts/`) are bundled with the app.
- **A strict Content-Security-Policy** (in `index.html`, `serve.json` and `vercel.json`) allows only this site's own files. The one inline script is the import map, which is pinned by its SHA-256 hash. If you edit the import map, recompute the hash and update it in all three files:
  ```
  powershell -c "$h=[IO.File]::ReadAllText('index.html'); $m=[regex]::Match($h,'<script type=""importmap"">(.*?)</script>','Singleline').Groups[1].Value; 'sha256-'+[Convert]::ToBase64String([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($m)))"
  ```
- **All text you type is escaped** before it reaches the page.
- **Imported backups are rebuilt field by field.** Unknown keys are dropped, ids, colours and dates are validated, sizes are capped, and files over 5 MB are refused.
- **`start.cmd` listens only on this computer.** `serve.json` turns off folder listings and adds security headers.
- **The service worker (offline mode) only runs on HTTPS**, so the local server never serves stale files.

## Try the flow quickly

Add `?fast` to the address (http://localhost:5173/?fast) and minutes become seconds, so a 25-minute session finishes in 25 seconds.

## Files

| Path | What it does |
|------|--------------|
| `index.html` | App shell, icons, navigation |
| `css/styles.css` | Theme tokens (light and dark), layout, components |
| `js/app.js` | Routing, events, timer flow, focus mode |
| `js/store.js` | Saved state and every action that changes it |
| `js/views.js` | The screens |
| `js/grove.js` | The Three.js island |
| `js/timer.js` | Focus timer, rain sound, chime |
| `js/srs.js` / `js/stats.js` | Review scheduling, streaks, levels, heatmap |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and install as an app |
| `vendor/three/`, `fonts/`, `css/fonts.css` | Bundled Three.js 0.160.0 (MIT) and fonts (OFL) |
| `serve.json`, `vercel.json` | Security headers for the local server and for hosting |
| `start.cmd`, `start-phone.cmd` | Run on this computer only, or share on trusted Wi-Fi |
