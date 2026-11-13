# Bihar Grid & Weather

Links circle-level outages (Daily Outage Analytics – Bihar) and 1912 supply complaints with weather for all 38 districts of Bihar. It flags circles hit beyond normal, predicts today's and tomorrow's outages and complaints, emails a morning alert, and serves an interactive page with a PDF report.

## Layout

| Path | What it is |
|---|---|
| `index.html` | The page for GitHub Pages. It loads the figures from the Apps Script web app's JSON feed (`GRID_API`). |
| `apps-script/Code.gs` | The Apps Script code, bound to the **Bihar Grid Weather Archive** sheet: daily run, archive, prediction, email, JSON feed. |
| `apps-script/Index.html` | The same page, for serving from the Apps Script web app (uses `google.script.run`). |
| `docs/explainer.html` | Technical explainer: architecture, data sources, status logic, prediction model, code map. |

The two page files are identical apart from one line, the `GRID_API` setting.

## Setup

### Apps Script (data, schedule, email)
1. Open the Bihar Grid Weather Archive sheet → Extensions → Apps Script.
2. Paste `apps-script/Code.gs` into `Code.gs` and `apps-script/Index.html` into an HTML file named `Index`. Save.
3. Run `setup()` once and allow the permissions. It creates a trigger that checks every 30 minutes from 9:30 AM IST and runs the day once both source sheets are ready.
4. Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone. Copy the `/exec` link.

### GitHub Pages (the page)
1. In `index.html`, replace `PASTE_WEB_APP_EXEC_URL_HERE` with the `/exec` link.
2. Repository Settings → Pages → Source: deploy from branch `main`, folder `/ (root)`.
3. The page is served at `https://<owner>.github.io/<repo>/`. The explainer is at `.../docs/explainer.html`.

## Making changes
- **Page only** (`index.html`): commit and push; GitHub Pages updates within a minute. Copy the same change into `apps-script/Index.html` to keep them in step.
- **Code.gs**: paste into Apps Script and save. Scheduled runs use the saved code at once. The web app feed uses the deployed version, so for feed changes use Deploy → Manage deployments → Edit → Version: New version (the `/exec` link stays the same).

## Sources
- Outages: `SBPDCL History Divisions` and `NBPDCL History Divisions` tabs of Daily Outage Analytics – Bihar (read only).
- Supply complaints: `DB_GEO`, `DB_META`, `DB_DAILY` tabs of Customer Call Center – 1912 (read only).
- Weather: Open-Meteo (best-match model in the script; six-model consensus on the page). District boundaries: Census 2011 via datameet/maps.

## Access
The JSON feed is open to anyone with the `/exec` link, and on GitHub Pages that link is visible in the page source. Keep the repository private (GitHub Pages from a private repository needs a paid plan) if the figures should not be public.
