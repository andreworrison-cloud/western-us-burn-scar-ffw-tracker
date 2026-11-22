#!/usr/bin/env python3
"""Publish initial western burn-scar FFWs from the IEM AFOS and GIS archives."""
import argparse
import calendar
import io
import hashlib
import json
import os
import re
import tempfile
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zipfile import BadZipFile, ZipFile

import shapefile
from burn_language import UNNAMED, analyze_segment, warning_weather

ROOT = Path(__file__).resolve().parents[1]
OFFICES = json.loads((ROOT / "scripts/offices.json").read_text())
START = datetime(2005, 11, 1, tzinfo=timezone.utc)
AFOS = "https://mesonet.agron.iastate.edu/cgi-bin/afos/retrieve.py"
GIS = "https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py"
NEW = re.compile(
    r"/O\.NEW\.K([A-Z]{3})\.FF\.W\.(\d{4})\.(\d{6}T\d{4}Z)-(\d{6}T\d{4}Z)/"
)
DAM = re.compile(r"/[A-Z0-9]{5}\.[A-Z0-9]\.DM\.\d{6}T\d{4}Z\.")
PIL = re.compile(r"(FFW[A-Z]{3})_(\d{12})(?:[^/]*)\.txt$")
MONTHS = list(calendar.month_abbr)[1:]
RULE_VERSION = 2


def utc(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def minute(date):
    return date.strftime("%Y-%m-%dT%H:%MZ")


def iso(date):
    return date.strftime("%Y-%m-%dT%H:%M:%SZ")


def vtime(value, fallback):
    return (
        fallback
        if value.startswith("000000")
        else datetime.strptime(value, "%y%m%dT%H%MZ").replace(tzinfo=timezone.utc)
    )


def download(url, parameters):
    request = Request(
        url + "?" + urlencode(parameters),
        headers={
            "User-Agent": "Western-Burn-Scar-FFW-Tracker/1.0 (github.com/andreworrison-cloud/western-us-burn-scar-ffw-tracker)",
            "Accept": "application/zip",
        },
    )
    for attempt in range(4):
        try:
            with urlopen(request, timeout=120) as response:
                payload = response.read()
            with ZipFile(io.BytesIO(payload)) as archive:
                if archive.testzip() is not None:
                    raise BadZipFile("Damaged IEM archive")
            return payload
        except (OSError, BadZipFile):
            if attempt == 3:
                raise
            time.sleep(2 ** (attempt + 1))


def source_data(start, end):
    offices = ",".join(OFFICES)
    texts = download(
        AFOS,
        {
            "pil": ",".join("FFW" + x for x in OFFICES),
            "sdate": minute(start),
            "edate": minute(end),
            "fmt": "zip",
            "limit": 9999,
        },
    )
    with ZipFile(io.BytesIO(texts)) as archive:
        capped = len(archive.infolist()) >= 9999
    if capped:
        mid = (start + (end - start) / 2).replace(second=0, microsecond=0)
        if mid <= start or mid >= end:
            raise ValueError("IEM product cap reached in a one-minute interval")
        yield from source_data(start, mid)
        yield from source_data(mid, end)
        return
    polygons = download(
        GIS,
        {
            "accept": "shapefile",
            "limit1": "1",
            "limitps": "1",
            "phenomena": "FF",
            "significance": "W",
            "wfo": offices,
            "sts": minute(start),
            "ets": minute(end),
        },
    )
    yield texts, polygons


def bulletin_geometry(segment):
    match = re.search(
        r"LAT\.\.\.LON[ \t]+((?:[\d \t]+(?:\r?\n[ \t]+(?=\d))?)+)", segment
    )
    if not match:
        return None
    nums = match[1].split()
    if len(nums) < 6 or len(nums) % 2:
        return None
    ring = []
    for lat, lon in zip(nums[::2], nums[1::2]):
        latitude, west = int(lat) / 100, int(lon) / 100
        if west < 65:
            west += 100
        if not 15 <= latitude <= 60 or not 65 <= west <= 150:
            return None
        ring.append([-round(west, 2), latitude])
    if len(set(map(tuple, ring))) < 3:
        return None
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    if sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) < 0:
        ring.reverse()
    return {"type": "Polygon", "coordinates": [ring]}


def round_coords(coords):
    if len(coords) and isinstance(coords[0], (int, float)):
        return [round(v, 5) for v in coords[:2]]
    return [round_coords(c) for c in coords]


def read_gis(payload):
    shapes = defaultdict(list)
    with ZipFile(io.BytesIO(payload)) as archive:

        def member(ext):
            return io.BytesIO(
                archive.read(next(n for n in archive.namelist() if n.endswith(ext)))
            )

        with shapefile.Reader(
            shp=member(".shp"), shx=member(".shx"), dbf=member(".dbf")
        ) as reader:
            fields = {field[0] for field in reader.fields[1:]}
            if (
                not {
                    "WFO",
                    "VTEC_YR",
                    "ETN",
                    "STATUS",
                    "PHENOM",
                    "GTYPE",
                    "SIG",
                    "INIT_ISS",
                    "PROD_ID",
                    "HV_CAUSE",
                }
                <= fields
            ):
                raise ValueError("IEM GIS schema has changed")
            for record in reader.iterShapeRecords():
                p = record.record.as_dict()
                if (p["STATUS"], p["PHENOM"], p["GTYPE"], p["SIG"]) != (
                    "NEW",
                    "FF",
                    "P",
                    "W",
                ):
                    continue
                if p["WFO"] not in OFFICES or not record.shape.points:
                    continue
                geometry = record.shape.__geo_interface__
                if geometry["type"] not in ("Polygon", "MultiPolygon"):
                    continue
                pretty = {
                    "type": geometry["type"],
                    "coordinates": round_coords(geometry["coordinates"]),
                }
                key = (p["WFO"], p["VTEC_YR"], p["ETN"])
                shapes[key].append((p, pretty))
    return shapes


def merged_geometry(geometries):
    polygons = []
    for geom in geometries:
        if geom:
            for polygon in (
                [geom["coordinates"]]
                if geom["type"] == "Polygon"
                else geom["coordinates"]
            ):
                if polygon not in polygons:
                    polygons.append(polygon)
    if not polygons:
        return None
    return (
        {"type": "Polygon", "coordinates": polygons[0]}
        if len(polygons) == 1
        else {"type": "MultiPolygon", "coordinates": polygons}
    )


def parse_archives(texts, polygons):
    shapes = read_gis(polygons)
    events = {}
    earliest = {}
    with ZipFile(io.BytesIO(texts)) as archive:
        for item in sorted(archive.infolist(), key=lambda f: f.filename):
            file_id = PIL.fullmatch(item.filename)
            if not file_id or file_id[1][3:] not in OFFICES:
                raise ValueError(f"Unexpected AFOS filename {item.filename}")
            file_time = datetime.strptime(file_id[2], "%Y%m%d%H%M").replace(
                tzinfo=timezone.utc
            )
            bulletin = archive.read(item).decode("latin-1").replace("\r", "")
            if file_id[1] not in bulletin:
                raise ValueError(f"Missing expected AFOS header in {item.filename}")
            for segment in re.split(r"^\s*\$\$\s*$", bulletin, flags=re.M):
                # Match the operational NEW in this particular warning segment, including the ETN.
                for tag in NEW.finditer(segment):
                    office, serial = tag[1], int(tag[2])
                    if office not in OFFICES:
                        continue
                    issued = vtime(tag[3], file_time)
                    year = issued.year
                    uid = f"{office}-{year}-{serial:04d}"
                    if uid in earliest and file_time > earliest[uid]:
                        continue
                    if uid in earliest and file_time < earliest[uid]:
                        events.pop(uid, None)
                    earliest[uid] = file_time
                    if DAM.search(segment):
                        continue
                    classification = analyze_segment(segment)
                    if not classification:
                        continue
                    names, excerpt = classification
                    name = names[0] if names else UNNAMED
                    start_code = issued.strftime("%Y%m%d%H%M")
                    candidates = [
                        (p, g)
                        for p, g in shapes.get((office, year, serial), ())
                        if p["INIT_ISS"] == start_code
                        or p["PROD_ID"].startswith(file_id[2] + "-")
                    ]
                    if any(p["HV_CAUSE"] == "DM" for p, _ in candidates):
                        continue
                    weather = warning_weather(segment)
                    geom = merged_geometry(g for _, g in candidates)
                    source = "IEM storm-based GIS"
                    if not geom:
                        geom = bulletin_geometry(segment)
                        source = "NWS bulletin LAT...LON" if geom else "Unmapped"
                    if uid in events:
                        stored = events[uid]
                        stored["geometry"] = merged_geometry([stored["geometry"], geom])
                        details = stored["properties"]
                        for key, quote in weather.items():
                            details["weather_evidence"].setdefault(key, quote)
                        details["burn_scars"] = list(
                            dict.fromkeys(details["burn_scars"] + names)
                        )
                        if details["burn_scars"]:
                            details["burn_scar"] = details["burn_scars"][0]
                        continue
                    meta = OFFICES[office]
                    props = {
                        "event_uid": uid,
                        "wfo": office,
                        "wfo_name": meta["name"],
                        "state": meta["state"],
                        "region": meta["region"],
                        "year": year,
                        "month": issued.month,
                        "etn": serial,
                        "issued_utc": iso(issued),
                        "expired_utc": (
                            iso(vtime(tag[4], file_time))
                            if not tag[4].startswith("000000")
                            else None
                        ),
                        "burn_scar": name,
                        "burn_scars": names,
                        "vtec_code": tag[0],
                        "text_excerpt": excerpt,
                        "weather_evidence": weather,
                        "geometry_source": source,
                        "vtec_url": f"https://mesonet.agron.iastate.edu/vtec/?year={year}&wfo=K{office}&phenomena=FF&significance=W&eventid={serial:04d}",
                    }
                    events[uid] = {
                        "type": "Feature",
                        "geometry": geom,
                        "properties": props,
                    }
    return events


def peak_window(months):
    if not sum(months):
        return "—"
    windows = [sum((months + months)[i : i + 3]) for i in range(12)]
    return " / ".join(
        f"{MONTHS[i]}–{MONTHS[(i+2)%12]}"
        for i, n in enumerate(windows)
        if n == max(windows)
    )


def aggregate(features, last_year):
    by_office = defaultdict(list)
    for feature in features:
        by_office[feature["properties"]["wfo"]].append(feature["properties"])
    rows = []
    for code, station in OFFICES.items():
        evs = by_office[code]
        months = [0] * 12
        years = {str(year): 0 for year in range(START.year, last_year + 1)}
        scars = Counter()
        for event in evs:
            months[event["month"] - 1] += 1
            years[str(event["year"])] += 1
            scars.update(event["burn_scars"])
        top = sorted(scars, key=lambda k: (-scars[k], k))
        rows.append(
            {
                "wfo": code,
                **station,
                "total_ffw": len(evs),
                "peak_season": peak_window(months),
                "top_scars": ", ".join(top[:3]),
                "latest_issued_utc": evs[0]["issued_utc"] if evs else None,
                "monthly": months,
                "yearly": years,
            }
        )
    return sorted(rows, key=lambda row: (-row["total_ffw"], row["wfo"]))


def save_archive(features, end, out, mode, previous):
    ordered = sorted(
        features.values(),
        key=lambda f: (f["properties"]["issued_utc"], f["properties"]["event_uid"]),
        reverse=True,
    )
    years = list(range(START.year, end.year + 1))
    geo = {"type": "FeatureCollection", "features": ordered}
    rows = aggregate(ordered, end.year)
    assert sum(r["total_ffw"] for r in rows) == len(ordered)
    with tempfile.TemporaryDirectory(dir=out) as tmp:
        stage = Path(tmp)

        def write(name, data):
            (stage / name).write_text(
                json.dumps(
                    data, ensure_ascii=False, allow_nan=False, separators=(",", ":")
                )
                + "\n",
                encoding="utf-8",
            )

        write("burn_scar_polygons.geojson", geo)
        digest = hashlib.sha256(
            (stage / "burn_scar_polygons.geojson").read_bytes()
        ).hexdigest()
        data_changed = (
            previous.get("geojson_sha256") != digest
            or previous.get("rules_version") != RULE_VERSION
        )
        data_time = (
            iso(end) if data_changed else previous.get("data_updated_utc", iso(end))
        )
        common = {
            "archive_start": START.date().isoformat(),
            "total_verified_events": len(ordered),
            "data_updated_utc": data_time,
            "geojson_sha256": digest,
            "rules_version": RULE_VERSION,
        }
        write(
            "wfo_summary.json",
            {**common, "updated_utc": data_time, "years": years, "wfos": rows},
        )
        write(
            "metadata.json",
            {
                **common,
                "updated_utc": iso(end),
                "checked_through_utc": iso(end),
                "last_mode": mode,
                "full_backfill_utc": (
                    iso(end) if mode == "backfill" else previous["full_backfill_utc"]
                ),
                "office_count": len(rows),
                "mapped_events": sum(f["geometry"] is not None for f in ordered),
                "first_issued_utc": (
                    ordered[-1]["properties"]["issued_utc"] if ordered else None
                ),
            },
        )
        # Outputs are only staged after every window succeeds and committed to Git together.
        for name in ("burn_scar_polygons.geojson", "wfo_summary.json", "metadata.json"):
            os.replace(stage / name, out / name)
    return len(ordered)


def synchronize(end, out, backfill=False, lookback=7, source=None):
    out.mkdir(parents=True, exist_ok=True)
    meta_file = out / "metadata.json"
    previous = json.loads(meta_file.read_text()) if meta_file.exists() else {}
    backfill = (
        backfill
        or not previous.get("full_backfill_utc")
        or previous.get("rules_version") != RULE_VERSION
    )
    if backfill:
        features, lower = {}, START
    else:
        # Catch up after downtime longer than the normal seven-day overlap.
        lower = max(
            START,
            min(
                end - timedelta(days=lookback),
                utc(previous["checked_through_utc"]) - timedelta(days=1),
            ),
        )
        if end < utc(previous["checked_through_utc"]):
            raise ValueError("Current source clock precedes previous archive check")
        old = json.loads((out / "burn_scar_polygons.geojson").read_text())
        features = {f["properties"]["event_uid"]: f for f in old["features"]}
    if end <= lower:
        raise ValueError("Invalid archive interval")
    cursor = lower
    while cursor < end:
        stop = min(end, datetime(cursor.year + 1, 1, 1, tzinfo=timezone.utc))
        print(f"Reading {minute(cursor)} through {minute(stop)}", flush=True)
        for texts, shapes in (source or source_data)(cursor, stop):
            features.update(parse_archives(texts, shapes))
        cursor = stop
    if backfill and previous.get("total_verified_events", 0) and not features:
        raise ValueError(
            "A full rebuild returned no historical warnings; preserving the previous archive"
        )
    return save_archive(
        features, end, out, "backfill" if backfill else "incremental", previous
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--backfill", action="store_true", help="Rebuild from November 2005"
    )
    parser.add_argument("--lookback-days", type=int, default=7)
    args = parser.parse_args()
    if args.lookback_days < 1:
        parser.error("--lookback-days must be positive")
    total = synchronize(
        datetime.now(timezone.utc).replace(second=0, microsecond=0),
        ROOT / "data",
        args.backfill,
        args.lookback_days,
    )
    print(f"Published {total:,} verified warnings across {len(OFFICES)} WFOs.")
