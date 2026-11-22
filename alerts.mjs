// CAP bulletins are already scoped to a single alert. Keep a stable VTEC key
// across replacement messages, even if an update no longer repeats the fire name.
const burn =
  /\b(?:burn(?:ed|t)?[ -]+(?:scars?|areas?)|(?:wild)?fire[ -]+scars?|post[ -]?fire|recently[ -]+burn(?:ed|t)|(?:area|terrain|hillside|watershed)s? (?:recently )?burned (?:by|in|during))\b/i;
const generic =
  /\b(?:if you (?:live|are)|avoid (?:areas|burn|recently)|residents and motorists|people (?:who |living )|stay away from|move (?:quickly )?away from|warning for (?:a |an )?(?:recent )?burn (?:area|scar) means|soils? in a burn scar|does not (?:include|affect|cover)|will not (?:affect|impact)|excludes? (?:the|a))\b/i;
const dam = /\/[A-Z0-9]{5}\.[A-Z0-9]\.DM\./i;
const vtec =
  /\/O\.(NEW|CON|EXT|EXA|EXB|COR)\.K([A-Z]{3})\.FF\.W\.(\d{4})\.(\d{6}T\d{4}Z)-/g;
export function mentionsBurn(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[!?])\s+|(?<!\.)\.\s+|\s+\*\s+/)
    .some((s) => burn.test(s) && !generic.test(s));
}
export function qualifyingAlerts(features, offices, archive, now = Date.now()) {
  const result = new Map();
  for (const f of features) {
    const p = f.properties || {};
    const expiry = Date.parse(p.ends || p.expires);
    if (
      p.event !== "Flash Flood Warning" ||
      p.status !== "Actual" ||
      p.messageType === "Cancel" ||
      !Number.isFinite(expiry) ||
      expiry <= now
    )
      continue;
    if (Date.parse(p.effective || p.onset) > now) continue;
    const params = p.parameters || {};
    const hydrologic = [params.HVTEC, params.hydroVTEC, p.description]
      .flat()
      .filter(Boolean)
      .join(" ");
    if (dam.test(hydrologic)) continue;
    const tags = Array.from(
      String((params.VTEC || []).toString()).matchAll(vtec),
    );
    for (const match of tags) {
      const [, , office, etn, start] = match;
      if (!offices.has(office)) continue;
      const year = start.startsWith("000000")
        ? new Date(p.sent).getUTCFullYear()
        : 2000 + Number(start.slice(0, 2));
      let key = [office, year, etn].join("-");
      if (start.startsWith("000000") && !archive.has(key)) {
        const prev = [office, year - 1, etn].join("-");
        const prior = archive.get(prev)?.properties;
        if (prior && Date.parse(prior.issued_utc) >= now - 86400000) key = prev;
      }
      const original = archive.get(key);
      const warningText = [p.headline, params.NWSheadline, p.description]
        .flat()
        .filter(Boolean)
        .join(". ");
      if (!original && !mentionsBurn(warningText)) continue;
      const record = {
        key,
        office,
        label:
          original?.properties?.burn_scars?.join(" / ") || p.areaDesc || office,
        headline: p.headline || "Flash Flood Warning",
        ends: expiry,
        sent: Date.parse(p.sent) || 0,
        geometry: f.geometry,
        description: p.description || "",
        url: null,
      };
      try {
        const url = new URL(f.id || p.id);
        if (url.protocol === "https:" && url.hostname === "api.weather.gov")
          record.url = url.href;
      } catch {}
      if (!result.has(key) || result.get(key).sent < record.sent)
        result.set(key, record);
    }
  }
  return [...result.values()].sort((a, b) => b.sent - a.sent);
}
