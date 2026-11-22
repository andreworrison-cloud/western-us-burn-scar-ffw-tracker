import { qualifyingAlerts } from "./alerts.mjs";
import {
  regions,
  seasons,
  seasonForMonth,
  tiers,
  tierFor,
  hotspotMinimum,
  aggregate,
  heatBand,
  describeHeatPeriod,
} from "./explorer.mjs?v=map3";

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
  asShare: false,
  region: "all",
  basemap: "dark",
  view: "wfo",
  scopeRows: [],
  scopeFeatures: [],
  limit: 16,
  meta: null,
};
const officeIds = new Set();
const officeRegions = new Map();
for (const region of regions) {
  for (const code of region.offices) {
    officeIds.add(code);
    officeRegions.set(code, region.name);
  }
}
const regionLayers = new Map();
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
  officeGroup,
  historyGroup,
  liveGroup,
  labelGroup,
  borderGroup,
  placeLayer,
  lastLiveFailed = false,
  lastAlerts = [],
  lastPoll = 0,
  activeBusy = false,
  archiveBusy = false,
  archiveInitialized = false;

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
function setLayer(parent, layer, on) {
  if (!parent || !layer) return;
  if (on && !parent.hasLayer(layer)) parent.addLayer(layer);
  else if (!on && parent.hasLayer(layer)) parent.removeLayer(layer);
}
function checkLayer(input, layer) {
  setLayer(map, layer, $(input).checked);
}
function selectedRegion() {
  return regions.find((r) => r.id === state.region);
}
function inScope(name) {
  return state.region === "all" || selectedRegion()?.name === name;
}
function fitRegion() {
  if (!map) return;
  const region = selectedRegion();
  const bounds = L.latLngBounds([]);
  for (const [name, group] of regionLayers)
    if ((!region || region.name === name) && group.bounds.isValid())
      bounds.extend(group.bounds);
  const extent = bounds.isValid() ? bounds : fullBounds;
  const height = map.getSize().y;
  map.stop();
  map.fitBounds(extent, {
    paddingTopLeft: [22, height < 450 ? 48 : 55],
    paddingBottomRight: [22, height < 450 ? 55 : 70],
    animate: false,
    maxZoom: 8,
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
    0.72,
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
function selectBasemap(id, writeUrl = true) {
  const radio = document.querySelector(
    'input[name="basemap"][value="' + id + '"]',
  );
  radio.checked = true;
  state.basemap = id;
  if (writeUrl) writePageSettings();
  if (!map) return;
  const [url, attribution, opacity, maxNativeZoom] = sources[id];
  if (baseLayer) map.removeLayer(baseLayer);
  $("map").dataset.basemap = id;
  $("tile-status").hidden = true;
  $("places-option").hidden = id !== "dark";
  if (!placeLayer)
    placeLayer = L.tileLayer(
      tiles + "Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      {
        pane: "placeNames",
        opacity: 0.83,
        maxNativeZoom: 16,
        maxZoom: 19,
        updateWhenIdle: true,
      },
    );
  setLayer(map, placeLayer, id === "dark" && $("toggle-places").checked);
  const layer = L.tileLayer(url, {
    pane: "tiles",
    maxNativeZoom,
    maxZoom: 19,
    attribution,
    opacity,
    updateWhenIdle: true,
    keepBuffer: 1,
  });
  baseLayer = layer;
  let missing = false;
  layer.on("loading", () => {
    missing = false;
  });
  layer.on("tileerror", () => {
    if (baseLayer !== layer) return;
    missing = true;
    $("tile-status").textContent =
      " · " +
      radio.labels[0].textContent.trim() +
      " tiles unavailable here. Local terrain fills gaps.";
    $("tile-status").hidden = false;
  });
  layer.on("load", () => {
    if (baseLayer === layer) $("tile-status").hidden = !missing;
  });
  layer.addTo(map);
}
function setupMap() {
  if (!window.L) {
    $("map").textContent =
      "Map unavailable. The office table and exports are still available.";
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
    placeNames: 340,
    scarPolygons: 400,
    postal: 440,
    offices: 470,
    officeLabels: 475,
    live: 490,
  })) {
    const pane = map.createPane(name);
    pane.style.zIndex = z;
    if (
      [
        "relief",
        "tiles",
        "borders",
        "placeNames",
        "postal",
        "officeLabels",
      ].includes(name)
    )
      pane.style.pointerEvents = "none";
  }
  fitRegion();
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
  selectBasemap(state.basemap, false);
  L.control.zoom({ position: "topright" }).addTo(map);
  L.control
    .scale({
      position: "bottomleft",
      imperial: true,
      metric: false,
      maxWidth: 70,
    })
    .addTo(map);
  officeGroup = L.layerGroup().addTo(map);
  historyGroup = L.layerGroup().addTo(map);
  liveGroup = L.layerGroup().addTo(map);
  borderGroup = L.layerGroup().addTo(map);
  labelGroup = L.layerGroup().addTo(map);
  archiveRenderer = L.canvas({ pane: "scarPolygons", padding: 0.25 });
  $("map-reset").addEventListener("click", () => selectRegion("all"));
  for (const id of [
    "toggle-archive",
    "toggle-offices",
    "toggle-labels",
    "toggle-borders",
    "toggle-active",
  ])
    $(id).addEventListener("change", applyMapLayers);
  get("./assets/western_states.geojson")
    .then((r) => r.json())
    .then((states) => {
      L.geoJSON(states, {
        pane: "borders",
        style: { color: "#9ab8d4", opacity: 0.8, weight: 1.2, fill: false },
        interactive: false,
        attribution: "Boundaries: U.S. Census Bureau",
      }).addTo(borderGroup);
      for (const state of states.features) {
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
          .addTo(borderGroup);
      }
    })
    .catch(() => {
      $("toggle-borders").closest("label").title =
        "State boundaries unavailable";
    });
  $("toggle-places").addEventListener("change", () => {
    setLayer(
      map,
      placeLayer,
      state.basemap === "dark" && $("toggle-places").checked,
    );
  });
  const coordinates = (point) => {
    const lat = point.lat,
      lng = point.wrap().lng;
    $("map-position").textContent =
      Math.abs(lat).toFixed(2) +
      "°" +
      (lat < 0 ? "S" : "N") +
      " " +
      Math.abs(lng).toFixed(2) +
      "°" +
      (lng < 0 ? "W" : "E");
  };
  map.on("mousemove", (e) => coordinates(e.latlng));
  map.on("moveend", () => {
    renderOfficeLabels();
    coordinates(map.getCenter());
  });
  coordinates(map.getCenter());
  new ResizeObserver(() => {
    map.invalidateSize({ pan: false });
  }).observe($("map"));
}
function renderOfficeLabels() {
  if (!map || !labelGroup) return;
  labelGroup.clearLayers();
  if (!$("toggle-labels").checked || !$("toggle-offices").checked) return;
  // Keep neighboring offices legible as the user changes region or zoom.
  const used = [];
  const size = map.getSize();
  for (const row of state.scopeRows) {
    const pos = map.latLngToContainerPoint([row.lat, row.lon]);
    if (
      pos.x < -24 ||
      pos.x > size.x + 24 ||
      pos.y < -15 ||
      pos.y > size.y + 15
    )
      continue;
    const d = tierFor(row.total_ffw).radius + 9;
    const offsets = [
      [0, -d],
      [0, d],
      [d + 8, 0],
      [-d - 8, 0],
      [d + 5, -d],
      [-d - 5, -d],
      [d + 5, d],
      [-d - 5, d],
    ];
    const offset = offsets.find(([dx, dy]) => {
      const x = pos.x + dx,
        y = pos.y + dy;
      return !used.some(
        (p) => Math.abs(p.x - x) < 29 && Math.abs(p.y - y) < 15,
      );
    });
    if (!offset) continue;
    used.push({ x: pos.x + offset[0], y: pos.y + offset[1] });
    L.tooltip({
      pane: "officeLabels",
      permanent: true,
      interactive: false,
      direction: "center",
      offset,
      className: "wfo-label",
      opacity: 1,
    })
      .setLatLng([row.lat, row.lon])
      .setContent(el("span", row.wfo))
      .addTo(labelGroup);
  }
}
function buildMapLayers() {
  if (!map) return;
  officeGroup.clearLayers();
  historyGroup.clearLayers();
  mapEvents.clear();
  mapOffices.clear();
  regionLayers.clear();
  for (const region of regions) {
    regionLayers.set(region.name, {
      offices: L.layerGroup(),
      bounds: L.latLngBounds([]),
      seasons: new Map(seasons.map((season) => [season.id, L.layerGroup()])),
    });
  }
  for (const feature of [...state.geo.features].reverse()) {
    if (!feature.geometry) continue;
    const p = feature.properties,
      group = regionLayers.get(p.region),
      season = seasonForMonth(p.month);
    if (!group || !season) continue;
    const layer = L.geoJSON(feature, {
      pane: "scarPolygons",
      renderer: archiveRenderer,
      style: {
        pane: "scarPolygons",
        renderer: archiveRenderer,
        color: season.color,
        fillColor: season.color,
        opacity: 0.8,
        weight: 1.4,
        fillOpacity: 0.14,
        smoothFactor: 0.6,
      },
    });
    layer.bindPopup(
      () =>
        popup(
          p.burn_scars.join(" / ") || "Burn name unspecified",
          p.wfo + " · " + dateText(p.issued_utc),
          [season.label + " issuance window", p.text_excerpt],
          p.vtec_url,
        ),
      { maxWidth: 300 },
    );
    group.seasons.get(season.id).addLayer(layer);
    group.bounds.extend(layer.getBounds());
    mapEvents.set(p.event_uid, layer);
  }
  for (const r of state.rows) {
    const group = regionLayers.get(r.region);
    if (!group) continue;
    const tier = tierFor(r.total_ffw);
    const marker = L.circleMarker([r.lat, r.lon], {
      pane: "offices",
      radius: tier.radius,
      color: "#f5faff",
      weight: 1.7,
      fillColor: tier.color,
      fillOpacity: 0.95,
      bubblingMouseEvents: false,
    });
    marker.bindTooltip(r.wfo + " · " + r.name, {
      direction: "top",
      offset: [0, -10],
    });
    marker.bindPopup(
      () =>
        popup(r.wfo + " · " + r.name, r.region, [
          fmt(r.total_ffw) + " verified warnings · " + tier.label + " activity",
          r.total_ffw ? "Peak season · " + r.peak_season : "",
          r.top_scars ? "Frequently named burns · " + r.top_scars : "",
          r.latest_issued_utc
            ? "Latest warning · " + dateText(r.latest_issued_utc)
            : "",
        ]),
      { maxWidth: 285, autoPan: false },
    );
    group.offices.addLayer(marker);
    group.bounds.extend(marker.getLatLng());
    mapOffices.set(r.wfo, marker);
  }
}
function applyMapLayers() {
  if (map) {
    for (const [region, group] of regionLayers) {
      const visible = inScope(region);
      setLayer(officeGroup, group.offices, visible);
      for (const [id, bucket] of group.seasons)
        setLayer(historyGroup, bucket, visible && $("season-" + id).checked);
    }
    checkLayer("toggle-archive", historyGroup);
    checkLayer("toggle-offices", officeGroup);
    checkLayer("toggle-active", liveGroup);
    checkLayer("toggle-borders", borderGroup);
    renderOfficeLabels();
  }
  if (!state.meta) return;
  const enabled = new Set(
    seasons.filter((s) => $("season-" + s.id).checked).flatMap((s) => s.months),
  );
  const mapped = state.scopeFeatures.filter((f) => f.geometry);
  const visible = $("toggle-archive").checked
    ? mapped.filter((f) => enabled.has(f.properties.month)).length
    : 0;
  const missing = state.scopeFeatures.length - mapped.length;
  $("mapped-count").textContent =
    fmt(visible) +
    " of " +
    fmt(mapped.length) +
    " polygons shown" +
    (missing ? " · " + fmt(missing) + " without geometry" : "");
}
function bringMapIntoView() {
  if (window.matchMedia("(max-width:800px)").matches)
    $("map-stage").scrollIntoView({
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
  renderOfficeLabels();
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
  const event = state.events.get(uid);
  $("season-" + seasonForMonth(event.properties.month).id).checked = true;
  applyMapLayers();
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
  return state.scopeRows
    .filter((r) => !query || state.names.get(r.wfo)?.includes(query))
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
    rows.length + " of " + state.scopeRows.length + " offices";
  document.querySelectorAll("[data-sort]").forEach((b) => {
    const th = b.closest("th");
    if (b.dataset.sort === state.sort)
      th.setAttribute("aria-sort", state.dir > 0 ? "ascending" : "descending");
    else th.removeAttribute("aria-sort");
  });
  $("export-csv").disabled = !rows.length;
  $("export-geo").disabled = !rows.length;
}
const defaultView = (region) => (region === "all" ? "wfo" : "heat");
function readPageSettings() {
  const params = new URLSearchParams(location.search);
  const region =
    regions.find((r) => r.id === params.get("region"))?.id || "all";
  const view = params.get("view");
  const basemap = params.get("basemap");
  return {
    region,
    view: ["wfo", "heat", "recent"].includes(view) ? view : defaultView(region),
    basemap: Object.hasOwn(sources, basemap) ? basemap : "dark",
  };
}
function writePageSettings() {
  if (!["https:", "http:"].includes(location.protocol)) return;
  const url = new URL(location.href);
  for (const [key, fallback] of [
    ["region", "all"],
    ["basemap", "dark"],
    ["view", defaultView(state.region)],
  ]) {
    if (state[key] === fallback) url.searchParams.delete(key);
    else url.searchParams.set(key, state[key]);
  }
  if (url.href !== location.href) history.pushState(null, "", url);
}
function selectRegion(id, writeUrl = true) {
  if (id !== "all" && !regions.some((r) => r.id === id)) return;
  state.region = id;
  state.selected = null;
  state.limit = 16;
  $("search").value = "";
  if (writeUrl) writePageSettings();
  map?.closePopup();
  refreshScope();
  fitRegion();
}
function refreshScope() {
  state.scopeRows = state.rows
    .filter((r) => inScope(r.region))
    .sort((a, b) => b.total_ffw - a.total_ffw || a.wfo.localeCompare(b.wfo));
  state.scopeFeatures = (state.geo?.features || []).filter((f) =>
    inScope(f.properties.region),
  );
  for (const button of document.querySelectorAll("[data-region]")) {
    const key = button.dataset.region,
      region = regions.find((r) => r.id === key);
    button.setAttribute("aria-pressed", key === state.region);
    if (region) button.title = region.states;
    if (state.meta)
      button.querySelector(".region-count").textContent = region
        ? state.rows.filter((r) => r.region === region.name).length
        : state.rows.length;
  }
  if (state.meta) {
    $("stat-total").textContent = fmt(state.scopeFeatures.length);
    $("stat-offices").textContent = state.scopeRows.length;
    $("stat-hotspots").textContent = state.scopeRows.filter(
      (r) => r.total_ffw >= hotspotMinimum,
    ).length;
  }
  applyMapLayers();
  renderTable();
  if (!$("panel-heat").hidden) renderHeat();
  if (!$("panel-recent").hidden) renderFeed();
  if (lastPoll || lastLiveFailed) showActive(lastAlerts, lastLiveFailed);
}
function setupLegend() {
  for (const t of tiers) {
    const item = el("span");
    item.style.setProperty("--swatch", t.color);
    item.append(
      el("i"),
      document.createTextNode(t.label + " (" + t.range + ")"),
    );
    $("office-tiers").append(item);
  }
  $("season-layers").append(el("span", "Issuance month"));
  for (const s of seasons) {
    const label = el("label"),
      input = el("input");
    input.type = "checkbox";
    input.id = "season-" + s.id;
    input.checked = true;
    input.setAttribute("aria-label", "Show " + s.label + " archived polygons");
    label.title = "Toggle " + s.label + " warning polygons";
    label.style.setProperty("--swatch", s.color);
    label.append(input, el("i"), document.createTextNode(s.label));
    input.addEventListener("change", applyMapLayers);
    $("season-layers").append(label);
  }
  const liveLabel = el("label", null, "live-key"),
    liveInput = el("input");
  liveInput.type = "checkbox";
  liveInput.id = "toggle-active";
  liveInput.checked = true;
  liveInput.setAttribute("aria-label", "Show active NWS warnings");
  liveLabel.style.setProperty("--swatch", "#ff655f");
  liveLabel.append(liveInput, el("i"), document.createTextNode("Live NWS"));
  $("season-layers").append(liveLabel);
}
const percent = (value) =>
  value > 0 && value < 0.1 ? "<0.1%" : Number(value.toFixed(1)) + "%";
function heatSection(body, label, columns, kind = "") {
  const row = body.insertRow(),
    header = el("th");
  row.className = "section-label " + kind;
  header.colSpan = columns + 1;
  header.append(el("span", label));
  row.append(header);
}
function heatDataRow(body, rowData, options) {
  const { label, code, city, select, isTotal, columns, monthly } = options;
  const tr = body.insertRow(),
    heading = el("th");
  heading.scope = "row";
  if (isTotal) tr.className = "total-row";
  const name = el(select ? "button" : "span");
  if (select) {
    name.type = "button";
    name.addEventListener("click", select);
    name.title = code ? "Locate " + label + " on the map" : "View " + label;
    name.setAttribute("aria-label", name.title);
  }
  if (code) name.append(el("strong", code), el("span", city, "office-short"));
  else name.textContent = label;
  heading.append(name);
  tr.append(heading);
  columns.forEach((col, i) => {
    const n = monthly ? rowData.monthly[i] : rowData.yearly[col] || 0;
    const share = rowData.total_ffw ? (100 * n) / rowData.total_ffw : 0;
    const td = tr.insertCell();
    const value = el(
      "button",
      state.asShare ? (rowData.total_ffw ? percent(share) : "—") : fmt(n),
      "heat-value band-" + heatBand(n, share, state.asShare),
    );
    value.type = "button";
    value.tabIndex = -1;
    value.dataset.col = String(i);
    value.dataset.scope = code || options.scope || "all";
    value.dataset.period = monthly ? i + 1 : col;
    value.dataset.heading = label + " · " + col;
    value.dataset.detail =
      fmt(n) +
      (n === 1 ? " warning" : " warnings") +
      " · " +
      percent(share) +
      " of " +
      fmt(rowData.total_ffw) +
      " archived";
    if (!rowData.total_ffw)
      value.dataset.detail =
        "0 verified warnings in the full archive. A percentage is unavailable.";
    if (monthly) value.dataset.detail += " · " + seasonForMonth(i + 1).label;
    value.setAttribute(
      "aria-label",
      value.dataset.heading + ". " + value.dataset.detail,
    );
    td.append(value);
  });
}
let pinnedHeatCell = null;
function releaseHeatCell() {
  pinnedHeatCell = null;
  $("heat-unpin").hidden = true;
  $("heat-example").parentElement.hidden = $("heat-example").hidden;
}
function showHeatCell(button) {
  const table = $("heat-table");
  const previous = table.querySelector(".heat-value.picked");
  if (previous === button) return;
  previous?.classList.remove("picked");
  button.classList.add("picked");
  $("heat-detail-title").textContent = button.dataset.heading;
  $("heat-detail-body").textContent = button.dataset.detail;
  const { latest, context } = describeHeatPeriod(
    state.scopeFeatures,
    button.dataset.scope,
    state.heat === "month",
    Number(button.dataset.period),
    months,
  );
  const weather = $("heat-weather"),
    example = $("heat-example");
  weather.textContent = context;
  weather.hidden = !context;
  example.hidden = !latest;
  if (latest) {
    example.href = latest.vtec_url;
    example.textContent =
      "Latest warning · " +
      latest.wfo +
      " · " +
      dateFmt.format(new Date(latest.issued_utc));
  } else example.removeAttribute("href");
  example.parentElement.hidden = !latest && !pinnedHeatCell;
}
function renderHeat() {
  const monthly = state.heat === "month",
    columns = monthly ? months : state.years;
  $("heat-month").setAttribute("aria-pressed", monthly);
  $("heat-year").setAttribute("aria-pressed", !monthly);
  $("unit-count").setAttribute("aria-pressed", !state.asShare);
  $("unit-share").setAttribute("aria-pressed", state.asShare);
  const labels = state.asShare
    ? ["0", "<5", "5–<10", "10–<20", "20–<30", "≥30"]
    : ["0", "1–4", "5–14", "15–29", "30–59", "60+"];
  const ramp = $("heat-ramp");
  ramp.replaceChildren();
  labels.forEach((label, i) => {
    const swatch = el("span", label, "band-" + i);
    swatch.title = state.asShare
      ? "Share of the row’s full archive (%)"
      : "Verified warning count";
    ramp.append(swatch);
  });
  if (!state.meta || !columns.length) return;
  releaseHeatCell();
  $("heat-weather").hidden = true;
  $("heat-example").hidden = true;
  $("heat-example").parentElement.hidden = true;
  const total = aggregate(state.scopeRows, state.years);
  const extent = monthly
    ? $("stat-range").textContent
    : state.years[0] + "–" + state.years.at(-1);
  $("annual-range").textContent = state.years[0] + "–" + state.years.at(-1);
  $("heat-detail-title").textContent = monthly
    ? "Seasonal heat map · " + extent
    : "Annual heat map · " + extent;
  $("heat-detail-body").textContent = monthly
    ? "Hover or select a cell for its share, seasonal weather context and latest warning. Click to pin."
    : "Explore each year’s warning share and busiest months. Click to pin. The current year is partial.";
  for (const id of ["summer", "cool"]) {
    const season = seasons.find((s) => s.id === id);
    const windowCount = (row) =>
      season.months.reduce((sum, month) => sum + row.monthly[month - 1], 0);
    const n = windowCount(total);
    const lead = $(id + "-leaders");
    lead.replaceChildren();
    if (n) {
      const high = Math.max(...state.scopeRows.map(windowCount));
      lead.append(document.createTextNode("Leading WFO · "));
      for (const office of state.scopeRows.filter(
        (row) => windowCount(row) === high,
      )) {
        const button = el("button", office.wfo + " (" + fmt(high) + ")");
        button.type = "button";
        button.title = "Locate " + office.name;
        button.addEventListener("click", () => focusOffice(office.wfo));
        lead.append(button);
      }
    }
    $(id + "-share").textContent =
      fmt(n) +
      " warnings · " +
      percent(total.total_ffw ? (100 * n) / total.total_ffw : 0);
  }
  const t = el("table", null, "heat");
  t.setAttribute(
    "aria-label",
    monthly
      ? "Warnings by region, office and month"
      : "Warnings by region, office and year",
  );
  const head = t.createTHead().insertRow();
  for (const c of ["Subregion / WFO", ...columns]) {
    const h = el("th", String(c));
    h.scope = "col";
    head.append(h);
  }
  const body = t.createTBody();
  heatSection(body, "Regional totals · " + extent, columns.length);
  for (const region of regions.filter((r) => inScope(r.name))) {
    const rows = state.scopeRows.filter((r) => r.region === region.name);
    heatDataRow(body, aggregate(rows, state.years), {
      label: region.short,
      scope: region.name,
      select: () => selectRegion(region.id),
      columns,
      monthly,
    });
  }
  if (state.region === "all")
    heatDataRow(body, total, {
      label: "All western WFOs",
      isTotal: true,
      columns,
      monthly,
    });
  const hotspots = state.scopeRows.filter((r) => r.total_ffw >= hotspotMinimum);
  const others = state.scopeRows.filter((r) => r.total_ffw < hotspotMinimum);
  for (const group of [
    {
      rows: hotspots,
      label: "Signature hotspots · ≥30 warnings",
      kind: "offices-section",
    },
    {
      rows: others,
      label: "Other forecast offices · <30 warnings",
      kind: "other-section",
    },
  ]) {
    if (!group.rows.length) continue;
    heatSection(body, group.label, columns.length, group.kind);
    for (const r of group.rows) {
      const city = r.name.replace(/, [A-Z]{2}$/, "");
      heatDataRow(body, r, {
        label: r.wfo + " · " + city,
        code: r.wfo,
        city,
        select: () => focusOffice(r.wfo),
        columns,
        monthly,
      });
    }
  }
  $("heat-table").replaceChildren(t);
  const latest = state.scopeFeatures[0]?.properties;
  const scope = selectedRegion()?.name || "all";
  const period = monthly ? latest?.month : latest?.year;
  const initial =
    t.querySelector(
      '.heat-value[data-scope="' + scope + '"][data-period="' + period + '"]',
    ) || t.querySelector(".heat-value");
  if (initial) {
    initial.tabIndex = 0;
    showHeatCell(initial);
  }
}
function renderFeed() {
  const rows = state.scopeFeatures,
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
    out.append(el("p", "No verified events in this region.", "empty"));
  $("recent-feed").replaceChildren(out);
  $("feed-count").textContent =
    "Showing " + Math.min(state.limit, rows.length) + " of " + fmt(rows.length);
  $("feed-more").hidden = state.limit >= rows.length;
}
function tabView(name, writeUrl = true) {
  state.view = name;
  if (writeUrl) writePageSettings();
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
    "burn-scar-" + state.region + "-wfo-summary.csv",
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
    const refreshAnalysis =
      changed || state.years.at(-1) !== summary.years.at(-1);
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
    for (const row of state.rows) officeRegions.set(row.wfo, row.region);
    const range =
      metadata.archive_start.slice(0, 4) +
      "–" +
      metadata.checked_through_utc.slice(0, 4);
    $("stat-range").textContent = range;
    $("legend-years").textContent = range;
    $("last-sync-badge").dateTime = metadata.checked_through_utc;
    $("last-sync-badge").textContent = dateText(metadata.checked_through_utc);
    const stale =
      Date.now() - Date.parse(metadata.checked_through_utc) > 3 * 3600000;
    $("last-sync-badge").closest(".stamp").classList.toggle("stale", stale);
    $("archive-status").dataset.state = stale ? "stale" : "ready";
    $("archive-status").querySelector("span").textContent = stale
      ? "Archive delayed"
      : "Archive ready";
    notifyArchive(
      stale
        ? "The last IEM archive check was over three hours ago. NWS alerts refresh independently."
        : "",
    );
    const firstLoad = !archiveInitialized;
    archiveInitialized = true;
    if (changed) buildMapLayers();
    if (refreshAnalysis) refreshScope();
    if (firstLoad) fitRegion();
    await pollActive();
  } catch {
    notifyArchive(
      state.meta
        ? "Archive refresh unavailable. Showing the last loaded archive."
        : "Archive unavailable. Please retry or open the IEM archive.",
    );
    if (!state.meta) $("last-sync-badge").textContent = "Unavailable";
    $("archive-status").dataset.state = "error";
    $("archive-status").querySelector("span").textContent = state.meta
      ? "Cached archive"
      : "Archive unavailable";
  } finally {
    archiveBusy = false;
  }
}
function showActive(alerts, failed = false) {
  const now = Date.now();
  lastLiveFailed = failed;
  lastAlerts = alerts.filter((a) => a.ends > now);
  const inRegion = lastAlerts.filter(
    (a) => !officeRegions.has(a.office) || inScope(officeRegions.get(a.office)),
  );
  const elsewhere = lastAlerts.length - inRegion.length;
  const count = $("stat-active"),
    status = $("active-status"),
    banner = $("active-banner");
  banner.replaceChildren();
  count.className = failed ? "" : inRegion.length ? "live-hot" : "live-ok";
  count.textContent = failed ? "—" : String(inRegion.length);
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
        inRegion.length
          ? "NWS refresh unavailable. Previously reported alerts · "
          : "NWS live status unavailable. ",
      ),
    );
  let openWarning;
  liveGroup?.eachLayer((layer) => {
    if (layer.isPopupOpen()) openWarning = layer.options.warningKey;
  });
  liveGroup?.clearLayers();
  if (inRegion.length) {
    banner.append(
      el(
        "strong",
        inRegion.length +
          " active burn-scar warning" +
          (inRegion.length === 1 ? "" : "s") +
          " ",
      ),
    );
    inRegion.forEach((a, i) => {
      let layer;
      if (map && a.geometry) {
        if (!activeRenderer) activeRenderer = L.svg({ pane: "live" });
        layer = L.geoJSON(a.geometry, {
          pane: "live",
          warningKey: a.key,
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
        if (a.key === openWarning) layer.openPopup();
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
  if (elsewhere) {
    if (inRegion.length || failed)
      banner.append(document.createTextNode(" · "));
    const button = el(
      "button",
      elsewhere +
        (failed ? " previously reported" : " active") +
        " elsewhere · Show all regions",
    );
    button.type = "button";
    button.addEventListener("click", () => selectRegion("all"));
    banner.append(button);
  }
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
$("export-geo").addEventListener("click", () => {
  const codes = new Set(shownRows().map((r) => r.wfo));
  const features = state.scopeFeatures.filter((f) =>
    codes.has(f.properties.wfo),
  );
  downloadFile(
    "burn-scar-" + state.region + "-warnings.geojson",
    JSON.stringify({ type: "FeatureCollection", features }),
    "application/geo+json",
  );
});
$("feed-more").addEventListener("click", () => {
  state.limit += 16;
  renderFeed();
});
for (const mode of ["month", "year"])
  $("heat-" + mode).addEventListener("click", () => {
    state.heat = mode;
    renderHeat();
  });
for (const unit of ["count", "share"])
  $("unit-" + unit).addEventListener("click", () => {
    state.asShare = unit === "share";
    renderHeat();
  });
for (const button of document.querySelectorAll("[data-region]"))
  button.addEventListener("click", () => selectRegion(button.dataset.region));
for (const radio of document.querySelectorAll('input[name="basemap"]'))
  radio.addEventListener("change", () => selectBasemap(radio.value));
addEventListener("popstate", () => {
  const { region, view, basemap } = readPageSettings();
  if (region !== state.region) selectRegion(region, false);
  if (basemap !== state.basemap) selectBasemap(basemap, false);
  if (view !== state.view) tabView(view, false);
});
const heatTable = $("heat-table");
$("heat-unpin").addEventListener("click", () => {
  pinnedHeatCell?.focus();
  releaseHeatCell();
});
for (const type of ["pointerover", "focusin", "click"])
  heatTable.addEventListener(type, (event) => {
    const cell = event.target.closest(".heat-value");
    if (!cell) return;
    if (type === "pointerover" && pinnedHeatCell) return;
    if (type === "focusin" && pinnedHeatCell !== cell) releaseHeatCell();
    if (type === "click") {
      pinnedHeatCell = cell;
      $("heat-unpin").hidden = false;
      $("heat-unpin").parentElement.hidden = false;
    }
    showHeatCell(cell);
    if (type !== "pointerover") {
      const old = heatTable.querySelector('.heat-value[tabindex="0"]');
      if (old) old.tabIndex = -1;
      cell.tabIndex = 0;
    }
  });
$("panel-heat").addEventListener("keydown", (event) => {
  if (event.key === "Escape" && pinnedHeatCell) {
    pinnedHeatCell.focus();
    releaseHeatCell();
  }
});
heatTable.addEventListener("keydown", (event) => {
  const cell = event.target.closest(".heat-value");
  if (
    !cell ||
    ![
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
    ].includes(event.key)
  )
    return;
  event.preventDefault();
  const row = cell.closest("tr"),
    buttons = [...row.querySelectorAll(".heat-value")];
  const index = Number(cell.dataset.col);
  let next;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    const rows = [...heatTable.querySelectorAll("tbody tr")].filter((r) =>
      r.querySelector(".heat-value"),
    );
    next = rows[
      rows.indexOf(row) + (event.key === "ArrowUp" ? -1 : 1)
    ]?.querySelector('[data-col="' + index + '"]');
  } else {
    const col = {
      Home: 0,
      End: buttons.length - 1,
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
    }[event.key];
    next = buttons[col];
  }
  if (next) next.focus();
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
Object.assign(state, readPageSettings());
tabView(state.view, false);
setupLegend();
setupMap();
refreshScope();
loadArchive();
pollActive();
setInterval(pollActive, 120000);
setInterval(loadArchive, 1800000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - lastPoll >= 120000) pollActive();
});
