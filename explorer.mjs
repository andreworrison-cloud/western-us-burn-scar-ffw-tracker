// Region names match the office roster and the published IEM summary.
export const regions = [
  {
    id: "southwest",
    offices: "ABQ FGZ PSR TWC EPZ MAF".split(" "),
    name: "Southwest Monsoon",
    short: "Southwest Monsoon",
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
  { id: "summer", label: "Jul–Sep", color: "#ffb631", months: [7, 8, 9] },
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
    if (
      ["all", "Southwest Monsoon", "ABQ", "FGZ", "PSR", "TWC", "EPZ"].includes(
        scope,
      )
    )
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
