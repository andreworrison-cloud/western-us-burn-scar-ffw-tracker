"""Warning text evidence for post-fire flooding. Input is one NWS product segment."""

import re

UNNAMED = "Name unspecified"
# Match common NWS spellings across wrapped text. A debris-flow reference by itself
# also occurs in warnings for steep, unburned terrain.
FIRE_LAND = re.compile(
    r"\b(?:burn(?:ed|t)?[ -]+(?:scars?|areas?)|(?:wild)?fire[ -]+scars?|post[ -]?fire"
    r"|recently[ -]+burn(?:ed|t)|(?:areas?|terrain|basins?|hillsides?|watersheds?|drainages?)"
    r"\s+(?:(?:was|were|recently|previously|severely)\s+){0,2}burn(?:ed|t)\s+(?:by|during|in)\b)",
    re.I,
)
# Generic instructions occur in some otherwise unrelated NWS FF.W bulletins.
ADVICE = re.compile(
    r"\b(?:move (?:quickly )?away from|avoid|stay away from|if you (?:live|are)|"
    r"people (?:who |living )|residents (?:living|and motorists)|anyone living|"
    r"(?:a )?flash flood warning for (?:a |an )?(?:recent )?burn (?:area|scar) means|"
    r"are extremely dangerous and can|soils? in a burn scar|general(?:ly)? (?:true|susceptible))\b",
    re.I,
)
# Preparedness paragraphs can also contain local rainfall observations and named
# local impacts, particularly in early bullets. Keep those when directly supported.
LOCAL = re.compile(
    r"\b(?:warning (?:includes?|for)|warned area|(?:warning|affected) areas? (?:are|includes?)|"
    r"(?:rain(?:fall)?|runoff|flood(?:ing|s)?|flows?|slides?|thunderstorms?|radar|rainstorm)"
    r".{0,100}?(?:on|across|over|near|within|in|through|of|from|toward|affect|impact|along)|"
    r"(?:occur(?:ring)?|imminent|reported|observed|indicated|producing|moving|threaten(?:ing|s)?)|"
    r"\bthis (?:storm|warning|rainfall|rainstorm)|(?:burn (?:area|scar)|recently burned area) (?:may|will))\b",
    re.I,
)
GENERIC = re.compile(
    r"\b(?:in (?:any|a) burn scar|(?:any|a) recently burned area|"
    r"(?:in|near) recently burned areas (?:are|can be) (?:extremely |very )?dangerous|"
    r"rainfall on burned areas can cause|(?:soils|terrain) in a burn scar)\b",
    re.I,
)
SCAR = re.compile(
    r"\b(?:burn(?:ed|t)?[ -]+(?:scars?|areas?)|(?:wild)?fire[ -]+scars?)\b", re.I
)
WORD = re.compile(r"[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*|[^\w\s]")
# Distinguish bounded place names from surrounding warning prose in uppercase
# historical messages as well as the mixed-case language in later products.
STOP = set(
    """
a above across active additional adjacent affected after all along already also among an and anticipated any are area areas around as at away
basins because become been before being below between both but by can currently cover covered covering covers debris
depend did directly downstream due during entire especially even except existing extensive extreme
falling far few flooding flows following for former fresh freshly from future general had has have heavily
if immediate impact impacted impacting impacts in include included includes including into is isolated it its lack large last
listed location specific local mainly many mapped may mentioned minor more most multiple near nearby nearly newly of off old on only onto
or other our outside over particular particularly past portion portions possible potentially present previous previously producing prone rain rainfall
recent recently remains reported runoff same scattered sensitive several severe severely should since soils some specifically
steep surrounding susceptible burned burnt than that the their there these this those threatening through throughout to toward towards under
until up upon upstream urban warning was warned water were which while will with within would year years your
""".split()
)
DIRECTION = re.compile(
    r"^(?:(?:east|west|north|south|northeast|northwest|southeast|southwest)ern|central)$",
    re.I,
)
NAMELESS = {
    "scar",
    "burn",
    "wildfire",
    "fire",
    "basin",
    "basins",
    "numbers",
    "topography",
    "previously",
    "number",
    "existing",
    "multiple",
    "heavily",
    "prior",
    "numerous",
}
ALIAS = {
    "hermits peak calf canyon": "Hermits Peak–Calf Canyon",
    "hermits peak and calf canyon": "Hermits Peak–Calf Canyon",
    "calf canyon hermits peak": "Hermits Peak–Calf Canyon",
    "calf canyon and hermits peak": "Hermits Peak–Calf Canyon",
    "mcbride": "McBride",
    "mckinney": "McKinney",
    "mcghee": "McGhee",
    "mcguire": "McGuire",
    "mcfarland": "McFarland",
    "4 mile": "Fourmile",
    "four mile": "Fourmile",
    "horseshoe2": "Horseshoe 2",
    "horseshoe 2": "Horseshoe 2",
    "carpenter 1": "Carpenter One",
    "sqf complex": "SQF Complex",
    "knp complex": "KNP Complex",
    "lnu lightning complex": "LNU Lightning Complex",
    "czu lightning complex": "CZU Lightning Complex",
    "calwood": "CalWood",
    "bobcat": "Bobcat",
    "whitewater baldy": "Whitewater-Baldy",
    "hpcc": "Hermits Peak–Calf Canyon",
    "hermit's peak calf canyon": "Hermits Peak–Calf Canyon",
    "hermit's peak": "Hermits Peak",
    "hermits peak calf canyon north": "Hermits Peak–Calf Canyon",
    "northwest hermits peak calf canyon": "Hermits Peak–Calf Canyon",
    "horsehoe 2": "Horseshoe 2",
    "yavapai county goodwin": "Goodwin",
    "idaho kelley": "Kelley",
    "theavila": "Avila",
    "west pine gulch": "Pine Gulch",
    "northremingtonmcghee": "North Remington McGhee",
    "snake river complex": "Snake River Complex",
}
NEGATED = re.compile(
    r"\b(?:does not (?:include|cover|affect)|will not (?:affect|impact|reach)|excludes?)"
    r"[^.;!?]{0,65}\b(?:burn(?:ed|t)? (?:scar|area)s?|(?:wild)?fire scars?)\b"
    r"|^\s*burn (?:scar|area)s?\.{2,}\s*(?:none|no|n/?a)\b",
    re.I,
)
PREP = re.compile(
    r"(?im)^\s*(?:PRECAUTIONARY/PREPAREDNESS ACTIONS|PREPAREDNESS/PRECAUTIONARY ACTIONS)\s*\.{2,}"
)
PAIR = re.compile(
    r"\b((?:hermit'?s? peak|calf canyon)\s*(?:/|[-–]|and|\s)\s*(?:hermit'?s? peak|calf canyon))"
    r"(?:\s+(?:fire|wildfire))?\s+burn\s+(?:scar|area)s?\b",
    re.I,
)
BURNED_BY = re.compile(
    r"\bburn(?:ed|t)\s+(?:in\s+\d{4}\s+(?:by|during)|(?:by|during|in))\s+"
    r"(?:the\s+)?([\w'-]+(?: [\w'-]+){0,4}?) (?:wild ?fire|fire)\b",
    re.I,
)
SEGMENTS = re.compile(r"\s*\n\s*\n\s*")
SENTENCES = re.compile(r"(?<=[.!?])(?<!\.\.)\s+|(?=\* )")


def _name(tokens):
    while tokens and (
        DIRECTION.fullmatch(tokens[0]) or re.fullmatch(r"(?:19|20)\d{2}", tokens[0])
    ):
        tokens = tokens[1:]
    while tokens and tokens[-1].casefold() in {
        "fire",
        "fires",
        "wildfire",
        "wild",
        "scar",
    }:
        tokens = tokens[:-1]
    if not tokens or len(tokens) > 5:
        return None
    if any(word.casefold() in STOP or word.casefold() in NAMELESS for word in tokens):
        return None
    raw = " ".join(tokens).replace("’", "'")
    if raw.isdigit() and raw != "416":
        return None
    normalized = re.sub(r"[\s/-]+", " ", raw.lower()).strip()
    if normalized in ALIAS:
        return ALIAS[normalized] or None
    # Preserve interior capitals in names such as McGhee, but standardize prose
    # capitalization and uppercase historical bulletins.
    rendered = " ".join(w.title() if w.islower() or w.isupper() else w for w in tokens)
    return re.sub(r"([A-Za-z])'S\b", r"\1's", rendered)


def _left_name(tokens):
    parts = []
    for word in reversed(tokens):
        if not word[0].isalnum() or word.casefold() in STOP or len(parts) >= 7:
            break
        parts.insert(0, word)
    return _name(parts), len(parts)


def _names(sentence):
    names = []
    if PAIR.search(sentence):
        names.append("Hermits Peak–Calf Canyon")
    for marker in SCAR.finditer(sentence):
        before = sentence[max(0, marker.start() - 110) : marker.start()]
        tokens = WORD.findall(before)
        name, length = _left_name(tokens)
        if not name:
            continue
        # Two places may explicitly share a plural marker, e.g. "the Blue Cut
        # and Pilot Fire burn scars." Require the article before the pair.
        separator = len(tokens) - length - 1
        if (
            marker.group().lower().endswith("s")
            and separator > 0
            and tokens[separator].casefold() in {"and", "/", "&"}
        ):
            first, count = _left_name(tokens[:separator])
            if (
                first
                and separator > count
                and tokens[separator - count - 1].casefold() == "the"
            ):
                names.append(first)
        names.append(name)
    for match in BURNED_BY.finditer(sentence):
        name = _name(match[1].split())
        if name:
            names.append(name)
    return list(dict.fromkeys(names))


def _excerpt(sentence, position):
    width = 244
    start = max(0, position - 95) if len(sentence) > width else 0
    if start:
        start = sentence.rfind(" ", 0, start) + 1
    excerpt = sentence[start : start + width].strip(" *")
    if start:
        excerpt = "…" + excerpt
    if start + width < len(sentence):
        excerpt = excerpt.rsplit(" ", 1)[0] + "…"
    return excerpt


def analyze_segment(segment):
    """Return named scars and a verbatim evidence excerpt, or None if unsupported.

    A warning about an unnamed burned area may qualify. Generic safety advice
    without a local hazard or location does not establish a post-fire warning.
    """
    sanitized = segment.replace("\r", "").split("LAT...LON")[0]
    if not FIRE_LAND.search(" ".join(sanitized.split())):
        return None
    sections = PREP.split(sanitized, maxsplit=1)
    names, evidence = [], []
    for section_index, section in enumerate(sections):
        for paragraph in SEGMENTS.split(section):
            text = " ".join(paragraph.split())
            for sentence in SENTENCES.split(text):
                marker = FIRE_LAND.search(sentence)
                if not marker or NEGATED.search(sentence):
                    continue
                direct = _names(sentence)
                advice = ADVICE.search(sentence) or GENERIC.search(sentence)
                if advice and not direct:
                    continue
                if section_index and not (direct or LOCAL.search(sentence)):
                    continue
                names.extend(direct)
                evidence.append((bool(direct), _excerpt(sentence, marker.start())))
    if not evidence:
        return None
    if "Hermits Peak–Calf Canyon" in names:
        names = [name for name in names if name not in {"Hermits Peak", "Calf Canyon"}]
    best = next((quote for named, quote in evidence if named), evidence[0][1])
    return list(dict.fromkeys(names)), best
