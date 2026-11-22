import { qualifyingAlerts } from "./alerts.mjs";

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString("en-US");
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const dateText = (value) => {
  const d = new Date(value);
  return dateFmt.format(d) + " · " + d.toISOString().slice(11, 16) + " UTC";
};
const state = {
  rows: [],
  years: [],
  geo: null,
  events: new Map(),
  names: new Map(),
  selected: null,
  sort: "total_ffw",
  dir: -1,
  heat: "month",
  limit: 16,
  meta: null,
};
const officeIds = new Set();
const mapOffices = new Map(),
  mapEvents = new Map();
const fullBounds = [
  [30.7, -125.15],
  [49.55, -100.0],
];
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
let archiveRenderer,
  activeRenderer,
  map,
  baseLayer,
  baseVersion = 0,
  officeGroup,
  historyGroup,
  liveGroup,
  lastAlerts = [],
  lastPoll = 0,
  activeBusy = false,
  archiveBusy = false;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function link(label, href) {
  const a = el("a", label);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}
function popup(title, subtitle, rows = [], href = null) {
  const box = el("div");
  box.append(el("strong", title), el("p", subtitle, "sub"));
  rows.filter(Boolean).forEach((text) => box.append(el("p", text)));
  if (href) box.append(link("Open IEM event record", href));
  return box;
}
function notifyArchive(text) {
  const box = $("archive-error");
  box.textContent = text;
  box.hidden = !text;
}
async function get(url, timeout = 25000) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response;
}
function checkLayer(input, layer) {
  if (!map || !layer) return;
  if ($(input).checked) {
    if (!map.hasLayer(layer)) layer.addTo(map);
  } else if (map.hasLayer(layer)) map.removeLayer(layer);
}
function home() {
  if (map)
    map.fitBounds(fullBounds, {
      padding: [12, 10],
      animate: false,
      maxZoom: 6,
    });
}
const tiles = "https://server.arcgisonline.com/ArcGIS/rest/services/";
const esri =
  '<a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>';
const osm =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const sources = {
  dark: [
    tiles + "Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    esri + ", HERE, Garmin, " + osm + ", GIS user community",
    0.32,
    16,
  ],
  topo: [
    tiles + "World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    esri +
      ", USGS, NOAA, " +
      osm +
      ' · <a href="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer" target="_blank" rel="noopener">All sources</a>',
    1,
    18,
  ],
  imagery: [
    tiles + "World_Imagery/MapServer/tile/{z}/{y}/{x}",
    esri + ", Vantor, Earthstar Geographics, GIS user community",
    1,
    19,
  ],
  osm: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png", osm, 1, 19],
};
function selectBasemap() {
  const id = $("basemap").value,
    [url, attribution, opacity, maxNativeZoom] = sources[id];
  if (baseLayer) map.removeLayer(baseLayer);
  const version = ++baseVersion;
  $("map").dataset.basemap = id;
  baseLayer = L.tileLayer(url, {
    pane: "tiles",
    maxNativeZoom,
    maxZoom: 19,
    attribution,
    opacity,
    updateWhenIdle: true,
    keepBuffer: 1,
  }).addTo(map);
  let valid = 0,
    failed = 0;
  baseLayer.on("tileload", () => {
    valid++;
    if (version === baseVersion && valid === 1)
      $("map").removeAttribute("data-tile-error");
  });
  baseLayer.on("tileerror", () => {
    if (++failed > 2 && !valid && version === baseVersion)
      $("map").dataset.tileError = "true";
  });
}
function setupMap() {
  if (!window.L) {
    $("map").textContent =
      "Map unavailable. The warning table and exports are available below.";
    return;
  }
  map = L.map("map", {
    preferCanvas: true,
    zoomSnap: 0.1,
    zoomDelta: 1,
    scrollWheelZoom: false,
    minZoom: 3,
    maxZoom: 17,
    zoomControl: false,
  });
  for (const [name, z] of Object.entries({
    relief: 180,
    tiles: 220,
    borders: 330,
    scarPolygons: 400,
    offices: 470,
    live: 490,
    postal: 520,
  })) {
    const pane = map.createPane(name);
    pane.style.zIndex = z;
    if (["relief", "tiles", "borders", "postal"].includes(name))
      pane.style.pointerEvents = "none";
  }
  home();
  L.imageOverlay(
    "./assets/western_relief.webp",
    [
      [22, -140],
      [56, -84],
    ],
    {
      pane: "relief",
      interactive: false,
      attribution: "Terrain: Natural Earth",
    },
  ).addTo(map);
  selectBasemap();
  L.control.zoom({ position: "topleft" }).addTo(map);
  L.control
    .scale({
      position: "bottomleft",
      imperial: true,
      metric: false,
      maxWidth: 75,
    })
    .addTo(map);
  officeGroup = L.layerGroup().addTo(map);
  historyGroup = L.layerGroup().addTo(map);
  liveGroup = L.layerGroup().addTo(map);
  $("map-reset").addEventListener("click", home);
  $("basemap").addEventListener("change", selectBasemap);
  [
    ["toggle-archive", historyGroup],
    ["toggle-offices", officeGroup],
    ["toggle-active", liveGroup],
  ].forEach(([id, group]) =>
    $(id).addEventListener("change", () => checkLayer(id, group)),
  );
  get("./assets/western_states.geojson")
    .then((r) => r.json())
    .then((states) => {
      L.geoJSON(states, {
        pane: "borders",
        style: { color: "#aab7bd", opacity: 0.58, weight: 1.05, fill: false },
        interactive: false,
        attribution: "Boundaries: U.S. Census Bureau",
      }).addTo(map);
      const labels = L.layerGroup();
      for (const state of states.features)
        L.tooltip({
          pane: "postal",
          permanent: true,
          direction: "center",
          className: "state-label",
          opacity: 1,
          interactive: false,
        })
          .setLatLng(state.properties.label)
          .setContent(el("span", state.properties.postal))
          .addTo(labels);
      labels.addTo(map);
    })
    .catch(() => {
      $("map-heading").title = "State boundaries unavailable";
    });
  new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(
    $("map"),
  );
}
function renderMap() {
  if (!map) return;
  officeGroup.clearLayers();
  historyGroup.clearLayers();
  mapOffices.clear();
  mapEvents.clear();
  const renderer = L.canvas({ pane: "scarPolygons", padding: 0.3 });
  if (archiveRenderer) map.removeLayer(archiveRenderer);
  archiveRenderer = renderer;
  for (const feature of [...state.geo.features].reverse()) {
    if (!feature.geometry) continue;
    const p = feature.properties;
    const layer = L.geoJSON(feature, {
      pane: "scarPolygons",
      renderer,
      style: {
        pane: "scarPolygons",
        renderer,
        color: "#f3ae64",
        weight: 1.25,
        opacity: 0.75,
        fillColor: "#e99a4f",
        fillOpacity: 0.18,
        smoothFactor: 0.6,
      },
    });
    layer.bindPopup(
      () =>
        popup(
          p.burn_scars.join(" / ") || "Burn name unspecified",
          p.wfo + " · " + dateText(p.issued_utc),
          [p.text_excerpt],
          p.vtec_url,
        ),
      { maxWidth: 300 },
    );
    layer.addTo(historyGroup);
    mapEvents.set(p.event_uid, layer);
  }
  for (const r of state.rows) {
    const marker = L.circleMarker([r.lat, r.lon], {
      pane: "offices",
      radius: 4.1,
      color: "#94e2d9",
      weight: 1.45,
      fillColor: "#224e53",
      fillOpacity: 1,
      bubblingMouseEvents: false,
    });
    marker.bindTooltip(r.wfo + " · " + r.name, {
      direction: "top",
      offset: [0, -4],
    });
    marker.bindPopup(
      () =>
        popup(r.wfo + " · " + r.name, r.region, [
          fmt(r.total_ffw) + " verified warnings",
          r.total_ffw ? "Peak season: " + r.peak_season : "",
          r.top_scars ? "Most frequently named: " + r.top_scars : "",
        ]),
      { maxWidth: 285, autoPan: false },
    );
    marker.addTo(officeGroup);
    mapOffices.set(r.wfo, marker);
  }
}
function bringMapIntoView() {
  if (window.matchMedia("(max-width:800px)").matches)
    $("map-heading").scrollIntoView({
      block: "start",
      behavior: reduced.matches ? "instant" : "smooth",
    });
}
function focusOffice(code) {
  const marker = mapOffices.get(code);
  if (!marker) return;
  state.selected = code;
  renderTable();
  $("toggle-offices").checked = true;
  checkLayer("toggle-offices", officeGroup);
  bringMapIntoView();
  map.stop();
  map.flyTo(marker.getLatLng(), 7, {
    duration: 0.65,
    animate: !reduced.matches,
  });
  marker.openPopup();
}
function focusEvent(uid) {
  const layer = mapEvents.get(uid);
  if (!layer) return;
  $("toggle-archive").checked = true;
  checkLayer("toggle-archive", historyGroup);
  bringMapIntoView();
  map.stop();
  map.fitBounds(layer.getBounds(), {
    padding: [35, 35],
    maxZoom: 11,
    animate: false,
  });
  layer.openPopup(layer.getBounds().getCenter());
}
const fold = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const statesFull = {
  AZ: "Arizona",
  NM: "New Mexico",
  CO: "Colorado",
  UT: "Utah",
  WY: "Wyoming",
  MT: "Montana",
  CA: "California",
  NV: "Nevada",
  WA: "Washington",
  OR: "Oregon",
  ID: "Idaho",
  TX: "Texas",
  NE: "Nebraska",
};
function shownRows() {
  const query = fold($("search").value.trim());
  return state.rows
    .filter((r) => !query || state.names.get(r.wfo).includes(query))
    .sort((a, b) => {
      let n =
        state.sort === "total_ffw"
          ? a.total_ffw - b.total_ffw
          : String(a[state.sort]).localeCompare(String(b[state.sort]));
      return n * state.dir || a.wfo.localeCompare(b.wfo);
    });
}
function renderTable() {
  const rows = shownRows(),
    output = document.createDocumentFragment();
  for (const r of rows) {
    const tr = el("tr");
    tr.classList.toggle("selected", r.wfo === state.selected);
    const cell = el("td"),
      button = el("button", null, "wfo-button");
    button.type = "button";
    button.setAttribute(
      "aria-label",
      "Locate " + r.wfo + ", " + r.name + " on the map",
    );
    button.append(
      el("span", r.wfo, "wfo-code"),
      el("span", r.name.replace(/, [A-Z]{2}$/, ""), "office-city"),
    );
    cell.append(button);
    const peak = el(
      "td",
      r.peak_season.includes(" / ")
        ? r.peak_season.split(" / ")[0] +
            " +" +
            (r.peak_season.split(" / ").length - 1)
        : r.peak_season,
    );
    peak.title = r.peak_season;
    tr.append(cell, el("td", r.state), el("td", fmt(r.total_ffw)), peak);
    tr.addEventListener("click", () => focusOffice(r.wfo));
    output.append(tr);
  }
  $("office-rows").replaceChildren(output);
  $("no-offices").hidden = !!rows.length;
  $("office-count").textContent =
    rows.length + " of " + state.rows.length + " offices";
  document.querySelectorAll("[data-sort]").forEach((b) => {
    const th = b.closest("th");
    if (b.dataset.sort === state.sort)
      th.setAttribute("aria-sort", state.dir > 0 ? "ascending" : "descending");
    else th.removeAttribute("aria-sort");
  });
  $("export-csv").disabled = !rows.length;
}
function renderHeat() {
  const monthly = state.heat === "month";
  const cols = monthly ? months : state.years;
  $("heat-month").setAttribute("aria-pressed", monthly);
  $("heat-year").setAttribute("aria-pressed", !monthly);
  const t = el("table", null, "heat");
  const head = t.createTHead().insertRow();
  head.append(el("th", "WFO"));
  for (const col of cols) {
    const h = el("th", String(col));
    h.scope = "col";
    head.append(h);
  }
  const body = t.createTBody(),
    values = (r) => (monthly ? r.monthly : cols.map((c) => r.yearly[c] || 0));
  const max = Math.max(1, ...state.rows.flatMap(values));
  const palette = [
    "#243136",
    "#453d33",
    "#70513b",
    "#95653e",
    "#bb824d",
    "#e0a15f",
    "#f6bd7d",
  ];
  for (const r of state.rows) {
    const tr = body.insertRow(),
      h = el("th", r.wfo);
    h.scope = "row";
    tr.append(h);
    values(r).forEach((n, i) => {
      const td = el("td", String(n));
      const band = n
        ? Math.max(1, Math.round((Math.log1p(n) / Math.log1p(max)) * 6))
        : 0;
      td.style.backgroundColor = palette[band];
      td.style.color = band >= 4 ? "#131a1f" : "#e0e6e8";
      td.title =
        r.wfo + " · " + cols[i] + " · " + n + " warning" + (n === 1 ? "" : "s");
      tr.append(td);
    });
  }
  $("heat-table").replaceChildren(t);
  $("heat-caption").textContent = monthly
    ? "All years combined"
    : "Since 2015 · current year partial";
}
function renderFeed() {
  const rows = state.geo?.features || [],
    out = document.createDocumentFragment();
  for (const f of rows.slice(0, state.limit)) {
    const p = f.properties,
      card = el("article", null, "feed-event"),
      head = el("div", null, "event-head");
    const tm = el("time", dateText(p.issued_utc));
    tm.dateTime = p.issued_utc;
    head.append(
      el("span", p.wfo + " · " + String(p.etn).padStart(4, "0"), "wfo-code"),
      tm,
    );
    const title = el(
        "span",
        p.burn_scars.join(" / ") || "Burn name unspecified",
        "event-title",
      ),
      bottom = el("div", null, "feed-meta");
    const focus = el("button", "Locate on map", "event-map");
    focus.type = "button";
    focus.addEventListener("click", () => focusEvent(p.event_uid));
    bottom.append(
      f.geometry ? focus : el("span", "Polygon unavailable"),
      link("IEM event record", p.vtec_url),
    );
    card.append(head, title, bottom);
    out.append(card);
  }
  if (!rows.length)
    out.append(el("p", "No verified events in this archive.", "empty"));
  $("recent-feed").replaceChildren(out);
  $("feed-count").textContent =
    "Showing " + Math.min(state.limit, rows.length) + " of " + fmt(rows.length);
  $("feed-more").hidden = state.limit >= rows.length;
}
function tabView(name) {
  document.querySelectorAll("[role=tab]").forEach((b) => {
    const on = b.dataset.view === name;
    b.setAttribute("aria-selected", on);
    b.tabIndex = on ? 0 : -1;
    $("panel-" + b.dataset.view).hidden = !on;
  });
  if (name === "heat") renderHeat();
  if (name === "recent") renderFeed();
}
function downloadFile(name, bytes, type) {
  const u = URL.createObjectURL(new Blob([bytes], { type })),
    a = el("a");
  a.href = u;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}
function exportCsv() {
  const years = Object.keys(state.rows[0].yearly),
    columns = [
      "wfo",
      "name",
      "state",
      "region",
      "total_ffw",
      "peak_season",
      "top_scars",
      "latest_issued_utc",
      ...months,
      ...years,
    ];
  const lines = [
    columns,
    ...shownRows().map((r) => [
      r.wfo,
      r.name,
      r.state,
      r.region,
      r.total_ffw,
      r.peak_season,
      r.top_scars,
      r.latest_issued_utc,
      ...r.monthly,
      ...years.map((y) => r.yearly[y]),
    ]),
  ];
  const csv = lines
    .map((row) =>
      row
        .map((v) => '"' + String(v ?? "").replaceAll('"', '""') + '"')
        .join(","),
    )
    .join("\r\n");
  downloadFile(
    "burn-scar-wfo-summary.csv",
    "\ufeff" + csv + "\r\n",
    "text/csv;charset=utf-8",
  );
}
async function archiveSnapshot() {
  const v = "?v=" + Date.now();
  const [summary, metadata] = await Promise.all([
    get("./data/wfo_summary.json" + v).then((r) => r.json()),
    get("./data/metadata.json" + v).then((r) => r.json()),
  ]);
  if (
    !metadata.full_backfill_utc ||
    metadata.geojson_sha256 !== summary.geojson_sha256
  )
    throw new Error("Archive versions differ");
  if (state.geo && state.meta?.geojson_sha256 === metadata.geojson_sha256)
    return { summary, metadata, geo: state.geo };
  const payload = await get("./data/burn_scar_polygons.geojson" + v).then((r) =>
    r.arrayBuffer(),
  );
  if (crypto.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", payload);
    const digest = Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    if (digest !== metadata.geojson_sha256)
      throw new Error("Archive snapshot incomplete");
  }
  const geo = JSON.parse(new TextDecoder().decode(payload));
  if (
    geo.type !== "FeatureCollection" ||
    !Array.isArray(geo.features) ||
    summary.wfos?.length !== 33 ||
    geo.features.length !== summary.total_verified_events
  )
    throw new Error("Invalid archive");
  return { summary, metadata, geo };
}
async function loadArchive() {
  if (archiveBusy) return;
  archiveBusy = true;
  try {
    let data;
    try {
      data = await archiveSnapshot();
    } catch {
      data = await archiveSnapshot();
    }
    const { summary, metadata, geo } = data;
    const changed = state.meta?.geojson_sha256 !== metadata.geojson_sha256;
    state.meta = metadata;
    state.years = summary.years;
    state.rows = summary.wfos;
    state.geo = geo;
    state.events = new Map(
      geo.features.map((f) => [f.properties.event_uid, f]),
    );
    state.names.clear();
    officeIds.clear();
    const namesByOffice = new Map(state.rows.map((r) => [r.wfo, new Set()]));
    geo.features.forEach((f) =>
      f.properties.burn_scars.forEach((n) =>
        namesByOffice.get(f.properties.wfo)?.add(n),
      ),
    );
    state.rows.forEach((r) => {
      officeIds.add(r.wfo);
      state.names.set(
        r.wfo,
        fold(
          [
            r.wfo,
            r.name,
            r.state,
            statesFull[r.state],
            r.region,
            ...namesByOffice.get(r.wfo),
          ].join(" "),
        ),
      );
    });
    $("stat-total").textContent = fmt(geo.features.length);
    $("stat-offices").textContent = state.rows.length;
    $("stat-range").textContent =
      metadata.archive_start.slice(0, 4) +
      "–" +
      metadata.checked_through_utc.slice(0, 4);
    $("last-sync-badge").dateTime = metadata.checked_through_utc;
    $("last-sync-badge").textContent = dateText(metadata.checked_through_utc);
    const stale =
      Date.now() - Date.parse(metadata.checked_through_utc) > 3 * 3600000;
    $("last-sync-badge").closest(".stamp").classList.toggle("stale", stale);
    $("mapped-count").textContent =
      fmt(metadata.mapped_events) +
      " mapped · " +
      fmt(geo.features.length - metadata.mapped_events) +
      " without geometry";
    $("export-geo").disabled = false;
    notifyArchive(
      stale
        ? "The last archive check was over three hours ago. The NWS live feed is checked independently."
        : "",
    );
    renderTable();
    if (changed) renderMap();
    if (!$("panel-heat").hidden) renderHeat();
    if (!$("panel-recent").hidden) renderFeed();
    await pollActive();
  } catch {
    notifyArchive(
      state.meta
        ? "Archive refresh unavailable. Showing the last loaded archive."
        : "Archive unavailable. Please retry or open the IEM archive.",
    );
    if (!state.meta) $("last-sync-badge").textContent = "Unavailable";
  } finally {
    archiveBusy = false;
  }
}
function showActive(alerts, failed = false) {
  const now = Date.now();
  lastAlerts = alerts.filter((a) => a.ends > now);
  const count = $("stat-active"),
    status = $("active-status"),
    banner = $("active-banner");
  banner.replaceChildren();
  count.className = failed ? "" : lastAlerts.length ? "live-hot" : "live-ok";
  count.textContent = failed ? "—" : String(lastAlerts.length);
  const stamp = lastPoll
    ? new Date(lastPoll).toISOString().slice(11, 16) + " UTC"
    : "";
  status.textContent = failed
    ? stamp
      ? "Unavailable · last check " + stamp
      : "NWS feed unavailable"
    : "NWS checked " + stamp;
  banner.hidden = !lastAlerts.length && !failed;
  banner.classList.toggle("hot", !!lastAlerts.length);
  if (failed)
    banner.append(
      el(
        "span",
        lastAlerts.length
          ? "NWS refresh unavailable. Previously reported alerts: "
          : "NWS live status unavailable. ",
      ),
    );
  liveGroup?.clearLayers();
  if (lastAlerts.length) {
    banner.append(
      el(
        "strong",
        lastAlerts.length +
          " active burn-scar warning" +
          (lastAlerts.length === 1 ? "" : "s") +
          " ",
      ),
    );
    lastAlerts.forEach((a, i) => {
      let layer;
      if (map && a.geometry) {
        if (!activeRenderer) activeRenderer = L.svg({ pane: "live" });
        layer = L.geoJSON(a.geometry, {
          pane: "live",
          style: {
            pane: "live",
            renderer: activeRenderer,
            color: "#ff655f",
            fillColor: "#ff5753",
            fillOpacity: 0.3,
            weight: 3,
            className: "live-polygon",
          },
        });
        layer
          .bindPopup(() => {
            const box = popup(a.office + " · Active FFW", a.label, [
              "Expires " + dateText(a.ends),
            ]);
            if (a.url) box.append(link("NWS alert", a.url));
            return box;
          })
          .addTo(liveGroup);
      }
      if (i) banner.append(document.createTextNode(" · "));
      if (layer) {
        const b = el("button", a.office);
        b.title = a.label;
        b.onclick = () => {
          bringMapIntoView();
          $("toggle-active").checked = true;
          checkLayer("toggle-active", liveGroup);
          map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 10 });
          layer.openPopup();
        };
        banner.append(b);
      } else
        banner.append(
          link(
            a.office + " (no polygon)",
            a.url || "https://www.weather.gov/alerts",
          ),
        );
    });
  } else if (failed)
    banner.append(
      link("Check official alerts", "https://www.weather.gov/alerts"),
    );
}
async function pollActive() {
  if (activeBusy) return;
  activeBusy = true;
  try {
    const collected = [],
      seen = new Set();
    let url =
      "https://api.weather.gov/alerts/active?event=Flash%20Flood%20Warning";
    while (url) {
      if (seen.has(url)) throw new Error("Repeated page");
      seen.add(url);
      const page = await (await get(url, 14500)).json();
      if (!Array.isArray(page.features)) throw new Error("Invalid alert data");
      collected.push(...page.features);
      url = page.pagination?.next || null;
      if (url && new URL(url).origin !== "https://api.weather.gov")
        throw new Error("Invalid alert source");
    }
    const alerts = qualifyingAlerts(collected, officeIds, state.events);
    lastPoll = Date.now();
    showActive(alerts);
  } catch {
    showActive(lastAlerts, true);
  } finally {
    activeBusy = false;
  }
}

document.querySelectorAll("[role=tab]").forEach((b, index, all) => {
  b.addEventListener("click", () => tabView(b.dataset.view));
  b.addEventListener("keydown", (e) => {
    const next = {
      ArrowRight: (index + 1) % all.length,
      ArrowLeft: (index + all.length - 1) % all.length,
      Home: 0,
      End: all.length - 1,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    tabView(all[next].dataset.view);
    all[next].focus();
  });
});
document.querySelectorAll("[data-sort]").forEach((b) =>
  b.addEventListener("click", () => {
    const k = b.dataset.sort;
    state.dir = k === state.sort ? -state.dir : k === "total_ffw" ? -1 : 1;
    state.sort = k;
    renderTable();
  }),
);
$("search").addEventListener("input", renderTable);
$("export-csv").addEventListener("click", exportCsv);
$("export-geo").addEventListener("click", () =>
  downloadFile(
    "burn-scar-warnings.geojson",
    JSON.stringify(state.geo),
    "application/geo+json",
  ),
);
$("feed-more").addEventListener("click", () => {
  state.limit += 16;
  renderFeed();
});
for (const mode of ["month", "year"])
  $("heat-" + mode).addEventListener("click", () => {
    state.heat = mode;
    renderHeat();
  });
for (const id of ["method-open", "coverage-info"])
  $(id).addEventListener("click", () => $("method-dialog").showModal());
$("method-close").addEventListener("click", () => $("method-dialog").close());
$("method-dialog").addEventListener("click", (e) => {
  if (
    e.target === $("method-dialog") &&
    e.offsetX >= 0 &&
    !e.target.matches(":focus")
  ) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      e.target.close();
  }
});
setupMap();
// Retain office scoping when the archive server is unavailable.
"ABQ FGZ PSR TWC EPZ BOU PUB GJT SLC RIW CYS BYZ MSO TFX GGW LOX SGX MTR STO HNX EKA VEF REV LKN SEW OTX PQR MFR PDT BOI PIH MAF LBF"
  .split(" ")
  .forEach((v) => officeIds.add(v));
loadArchive();
pollActive();
setInterval(pollActive, 120000);
setInterval(loadArchive, 1800000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - lastPoll >= 120000) pollActive();
});
