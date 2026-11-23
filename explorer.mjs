// Region names match the office roster and the published IEM summary.
export const regions = [
  {
    id: "southwest",
    offices: "ABQ FGZ PSR TWC EPZ MAF".split(" "),
    name: "Southwest",
    short: "Southwest",
    states: "AZ, NM and Midland/Odessa, TX",
  },
  {
    id: "rockies",
    offices: "BOU PUB GJT SLC RIW CYS BYZ MSO TFX GGW LBF".split(" "),
    name: "Southern & Central Rockies",
    short: "Central & S. Rockies",
    states: "CO, WY, UT, MT and North Platte, NE",
  },
  {
    id: "california",
    offices: "LOX SGX MTR STO HNX EKA VEF REV LKN".split(" "),
    name: "California & Great Basin",
    short: "CA & Great Basin",
    states: "CA and NV",
  },
  {
    id: "northwest",
    offices: "SEW OTX PQR MFR PDT BOI PIH".split(" "),
    name: "Pacific Northwest",
    short: "Pacific Northwest",
    states: "WA, OR and ID",
  },
];

export const seasons = [
  {
    id: "summer",
    label: "Jul–Sep",
    color: "#5cf86c",
    lightMapColor: "#006e36",
    months: [7, 8, 9],
  },
  {
    id: "cool",
    label: "Oct–Mar",
    color: "#30caff",
    months: [10, 11, 12, 1, 2, 3],
  },
  { id: "spring", label: "Apr–Jun", color: "#ad9aff", months: [4, 5, 6] },
];

export const seasonForMonth = (month) =>
  seasons.find((s) => s.months.includes(month));
export function seasonMapColor(season, basemap) {
  if (basemap === "topo" || basemap === "osm")
    return season.lightMapColor ?? season.color;
  return season.color;
}
export const hotspotMinimum = 30;
export const tiers = [
  { min: 101, label: "Extreme", range: ">100", color: "#ff426f", radius: 10 },
  {
    min: hotspotMinimum,
    label: "High",
    range: "30–100",
    color: "#ff8b32",
    radius: 8.5,
  },
  { min: 10, label: "Moderate", range: "10–29", color: "#f0bf2a", radius: 7.5 },
  { min: 1, label: "Low", range: "1–9", color: "#3cbcff", radius: 6.5 },
  { min: 0, label: "None", range: "0", color: "#65748d", radius: 5 },
];
export const tierFor = (count) => tiers.find((t) => count >= t.min);

// A warning can explicitly describe several meteorological processes.
export const weatherTypes = {
  thunderstorm: { label: "Thunderstorms / convection", color: "#ffb640" },
  monsoon: { label: "Monsoon", color: "#f276d5" },
  ar: { label: "Atmospheric river", color: "#35d5e3" },
  front: { label: "Front / frontal band", color: "#70a6ff" },
  rainband: { label: "Rainbands", color: "#91db83" },
  tropical: { label: "Tropical cyclone / remnants", color: "#c99aff" },
  mixed: { label: "Multiple signals", color: "#ffe28a" },
  unspecified: { label: "No tracked setup named", color: "#a5b6c8" },
  pending: { label: "Text review pending", color: "#777d8f" },
};
export function weatherClass(event) {
  if (!event.weather_evidence) return "pending";
  const keys = Object.keys(event.weather_evidence);
  if (keys.length > 1) return "mixed";
  return keys[0] || "unspecified";
}
export function matchesWeather(event, selection) {
  return (
    selection === "all" ||
    weatherClass(event) === selection ||
    Object.hasOwn(event.weather_evidence || {}, selection)
  );
}

// Recompute the same office statistics as the collector for a weather subset.
export function officeRowsForFeatures(offices, features, years, monthNames) {
  const bins = new Map(
    offices.map((r) => [
      r.wfo,
      {
        row: { ...r, ...aggregate([], years), latest_issued_utc: null },
        scars: new Map(),
      },
    ]),
  );
  for (const { properties: p } of features) {
    const { row, scars } = bins.get(p.wfo);
    row.total_ffw++;
    row.monthly[p.month - 1]++;
    row.yearly[p.year]++;
    if (!row.latest_issued_utc || p.issued_utc > row.latest_issued_utc)
      row.latest_issued_utc = p.issued_utc;
    for (const name of p.burn_scars)
      scars.set(name, (scars.get(name) || 0) + 1);
  }
  return [...bins.values()].map(({ row, scars }) => {
    const m = row.monthly;
    const windows = m.map((n, i) => n + m[(i + 1) % 12] + m[(i + 2) % 12]);
    const peak = Math.max(...windows);
    row.peak_season = peak
      ? windows
          .flatMap((n, i) =>
            n === peak ? [monthNames[i] + "–" + monthNames[(i + 2) % 12]] : [],
          )
          .join(" / ")
      : "—";
    row.top_scars = [...scars]
      .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, 3)
      .map(([name]) => name)
      .join(", ");
    return row;
  });
}

export function aggregate(rows, years) {
  const monthly = Array(12).fill(0);
  const yearly = Object.fromEntries(years.map((year) => [year, 0]));
  let total_ffw = 0;
  for (const row of rows) {
    total_ffw += row.total_ffw;
    row.monthly.forEach((n, i) => {
      monthly[i] += n;
    });
    for (const year of years) yearly[year] += row.yearly[year] || 0;
  }
  return { monthly, yearly, total_ffw };
}

export function heatBand(count, share, asShare) {
  if (!count) return 0;
  const value = asShare ? share : count;
  const thresholds = asShare ? [5, 10, 20, 30] : [5, 15, 30, 60];
  return 1 + thresholds.filter((limit) => value >= limit).length;
}

// These notes describe seasonal weather settings. Individual event mechanisms
// require review of the warning and meteorological evidence.
function weatherSetting(scope, season) {
  if (season === "summer") {
    if (["all", "Southwest", "ABQ", "FGZ", "PSR", "TWC", "EPZ"].includes(scope))
      return "Monsoon moisture can fuel short, intense thunderstorms over burn scars in the Southwest.";
    return "A slow-moving thunderstorm can concentrate intense rain over a single burned watershed.";
  }
  if (
    season === "cool" &&
    [
      "all",
      "California & Great Basin",
      "Pacific Northwest",
      "LOX",
      "SGX",
      "MTR",
      "STO",
      "HNX",
      "EKA",
      "SEW",
      "PQR",
      "MFR",
    ].includes(scope)
  )
    return "On the West Coast, atmospheric rivers supply moisture and frontal rainbands can focus heavy rain.";
  return "Short bursts of intense rain from thunderstorms or bands within a larger storm can produce runoff on burned slopes.";
}

export function describeHeatPeriod(
  features,
  scope,
  monthly,
  period,
  monthLabels,
) {
  const histogram = Array(12).fill(0);
  let latest = null;
  for (const { properties: event } of features) {
    if (scope !== "all" && scope !== event.wfo && scope !== event.region)
      continue;
    if ((monthly ? event.month : event.year) !== period) continue;
    histogram[event.month - 1]++;
    if (!latest || event.issued_utc > latest.issued_utc) latest = event;
  }
  if (!latest) return { latest: null, context: "" };
  if (monthly)
    return {
      latest,
      context:
        "Seasonal context · " +
        weatherSetting(scope, seasonForMonth(period).id),
    };

  const peak = Math.max(...histogram);
  const months = histogram.flatMap((count, index) =>
    count === peak ? [index + 1] : [],
  );
  const labels = months.map((month) => monthLabels[month - 1]).join(", ");
  const peakSeasons = new Set(months.map((month) => seasonForMonth(month).id));
  const setting =
    peakSeasons.size === 1
      ? " Seasonal context · " +
        weatherSetting(scope, seasonForMonth(months[0]).id)
      : " Those months span more than one seasonal window.";
  const peakText =
    (months.length === 1 ? "Busiest month" : "Tied busiest months") +
    " · " +
    labels +
    " (" +
    peak +
    (peak === 1 ? " warning" : " warnings") +
    (months.length > 1 ? " each)." : ").");
  return { latest, context: peakText + setting };
}
