# Western U.S. Burn-Scar Flash Flood Warning Tracker

An interactive archive of initial NWS flash flood warnings that explicitly identify a post-fire flood or debris-flow threat in 33 western forecast offices. The map combines historical warning polygons and the NWS active-alert feed. The right panel provides a searchable office table, monthly and annual heatmaps, a recent-event feed, and CSV and GeoJSON exports.

## Using the dashboard

- The main page opens the **WFO breakdown**. A region-only link opens the regional heat map. Selecting a region zooms the map and updates the office totals, archived and active warning layers, analytics and exports. Copy the page URL to share the current region, map background and tab. **Reset Western U.S.** restores all 33 offices.
- The heat map opens in monthly count mode. Switch to annual values from 2015 onward or select **Share %** to compare the percentage of each row’s full archive. Hover, tap or use the arrow keys to inspect a cell. Click to pin its details and open the latest IEM warning in that cell. Monthly cells give seasonal weather context. Annual cells report the busiest month or tied months from that year’s warnings. The current year is partial.
- Office markers show lifetime warning counts. Pink marks more than 100 warnings, orange 30–100, gold 10–29, blue 1–9, and gray zero. Offices with 30 or more warnings appear in the hotspot group. Archived warning footprints are colored by issuance month. The legend independently switches the July–September, October–March and April–June layers and the live NWS layer. The seasonal cards summarize timing. They do not identify the mechanism of an individual storm.
- Choose **Dark Gray**, **Topographic**, **Satellite** or **OpenStreetMap** in the **Map background** bar above the map. Toggle WFO labels, state boundaries and archived polygons on the map. **Overlays** controls office markers and dark-map place names. If tiles are missing, a status message identifies the selected background and local terrain fills gaps.
- The WFO table supports sorting and searches by code, city, state, region or named burn. CSV exports the displayed offices, including all calendar years and monthly totals. GeoJSON exports every archived warning issued by those same offices. Recent events link to their IEM VTEC records and mapped warning footprints.

## Archive method and coverage

1. The backfill begins November 1, 2005. For each interval, retrieve the original FFW products for all 33 office PILs from IEM AFOS in ZIP format. Read individual ZIP entries, including products with identical office and minute filenames.
2. Inspect each NWS product segment independently. Require the exact operational `/O.NEW.Kxxx.FF.W.nnnn.begin-end/` tag. Use office, VTEC year and ETN as the event key. Continuations, extensions, expirations, cancellations, tests and county duplicates do not create records. Inspect hydrologic VTEC cause in the same segment and the matched GIS record to exclude dam or levee failures.
3. Require positive burn-scar, burn-area, recently burned land or post-fire wording in the local hazard, locations, impacts or other relevant warning text. General preparedness advice by itself is insufficient. Wording and extracted scar names vary by forecaster and era. An implied fire threat without recognizable burned-land wording may be missed. Named burns are identified from the text. A warning can name multiple burns and still counts once. Excerpts and event links support review.
4. Read the initial storm-based polygons from IEM watchwarn’s zipped shapefile using both `limit1=1` and `limitps=1` with FF/W filters. Match the issuing office, VTEC year, ETN and issuance or product time. If IEM lacks the matching shape, decode that warning segment’s published LAT…LON. A text-verified warning without either shape is counted and has null GeoJSON geometry. Polygon footprints describe warned areas, not burned-area boundaries.
5. WFO groups and map points follow the supplied 33-office project roster, including MAF and LBF. The event state field refers to the office location. A warning can cover part of another state in that office’s warning area.

The text search extends into the period before operational flash flood VTEC tagging was widespread. Some early post-fire FFWs (including a Gaviota burn-area warning on November 9, 2005) lack the required NEW tag. The searched period therefore begins earlier than the first qualifying record. IEM also identifies October 1, 2007 as the start of official storm-based warnings. Early counts are incomplete for climatological comparisons. The archive counts warnings, not verified occurrences of flash floods or debris flows.

## Updates

The workflow **Update IEM Burn-Scar FFW Data** is scheduled every 30 minutes and supports manual dispatch. Normal updates revisit a seven-day window and merge by event key. After an interruption, the job also covers the gap since its previous successful check. Full backfill scans one year at a time and subdivides an interval if the AFOS 9,999-product limit is reached. Downloads are retried; a failed or truncated source job exits before the publish step. A single Git commit publishes the complete archive, summary and metadata. Scheduled Actions start times can vary.

GitHub Pages is served from **main / (root)**. The repository workflow has `contents: write` for its data commit and `pages: write` to request a Pages rebuild explicitly after a bot push. The latest successful IEM check is recorded in `data/metadata.json`. Unchanged warning data retain their version and only the small heartbeat file changes. The browser checks archive versions for consistency before replacing its current view.

The separate browser-side live layer polls NWS every two minutes, requires an actual active FF.W from a tracked office, and filters for post-fire language or a matched archived event. Live replacement messages share the VTEC event key. A missing CAP polygon is indicated in the banner. If polling fails, the count shows unavailable and any previously received, still-unexpired alerts are identified as such. Use official NWS products for warning decisions.

## Run locally

Requires Python 3.11+ for the collector. The dashboard itself is static and ships with the populated archive.

```sh
python -m pip install -r requirements.txt
python scripts/fetch_iem_burn_scar_ffw.py --lookback-days 7
python -m http.server 8000
```

Open `http://localhost:8000/`. Use `--backfill` to rebuild the archive. On GitHub use **Actions → Update IEM Burn-Scar FFW Data → Run workflow** on main and select the backfill checkbox for the initial manual run.

## Sources

- [IEM warning GIS export and schema](https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py?help)
- [IEM AFOS original bulletin archive](https://mesonet.agron.iastate.edu/cgi-bin/afos/retrieve.py?help)
- [IEM VTEC event browser](https://mesonet.agron.iastate.edu/vtec/) and [storm-based warning coverage](https://mesonet.agron.iastate.edu/cow/sbwsum.phtml)
- [National Weather Service alerts API](https://www.weather.gov/documentation/services-web-api)
- [Map and terrain sources](assets/SOURCES.md), [Leaflet license](vendor/leaflet/LICENSE) and [DM Sans license](assets/DM-Sans-LICENSE.txt)
