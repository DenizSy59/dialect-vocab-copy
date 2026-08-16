"""Fetch freely licensed Korean and Chinese video from Wikimedia Commons.

FLEURS gives clean read speech with reference transcripts. This gives the
opposite: spontaneous speech, background noise, real video. Between them the
pipeline gets tested on both the easy and the hard condition.

These have no reference transcripts, so they answer word-timing coverage and
exercise clip cutting, but they cannot produce error rates. Use FLEURS for that.

Every file here is CC BY or CC BY-SA, which means **attribution is required**.
The manifest records author, licence and source page for each file so the report
can credit them properly.

Usage:
    python src/fetch_commons.py
"""

import json
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).parent.parent / "data" / "samples" / "commons"
API = "https://commons.wikimedia.org/w/api.php"

# Wikimedia asks for a descriptive User-Agent identifying the tool and a contact.
UA = "dialect-vocab-capstone/0.1 (student research; deniz-sismanyazici@hotmail.com)"

# Matched as substrings against Commons file titles, so they survive the long
# and punctuation-heavy real names.
WANTED = [
    ("ko", "손호준"),          # studio interview, two speakers
    ("ko", "정희웅 그라운드"),   # post-match, crowd noise — the hard case
    ("ko", "정성규 선수"),      # different speaker and setting
    ("zh", "C919"),           # news report with street interviews
    ("zh", "Húkǒu huà"),      # Hukou dialect — for the day 19+ dialect work
]

CATEGORIES = ["Videos in Korean", "Videos in Chinese"]


def api(params: dict) -> dict:
    params = {**params, "format": "json"}
    url = f"{API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def list_category(category: str) -> list:
    data = api({
        "action": "query",
        "generator": "categorymembers",
        "gcmtitle": f"Category:{category}",
        "gcmlimit": "100",
        "gcmtype": "file",
        "prop": "imageinfo",
        "iiprop": "url|size|mime|extmetadata",
    })
    return list(data.get("query", {}).get("pages", {}).values())


def field(meta: dict, key: str) -> str:
    value = (meta.get(key) or {}).get("value", "")
    # extmetadata values are HTML fragments; good enough to strip crudely since
    # this only ever ends up in a credits list.
    import re
    return re.sub(r"<[^>]+>", "", value).strip()


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    pages = []
    for category in CATEGORIES:
        pages.extend(list_category(category))

    entries = []
    for lang, needle in WANTED:
        match = next(
            (p for p in pages if needle.lower() in p["title"].lower()), None,
        )
        if match is None:
            print(f"!! no Commons file matched {needle!r} — skipped")
            continue

        info = match["imageinfo"][0]
        meta = info.get("extmetadata", {})
        title = match["title"].replace("File:", "")
        # Commons titles contain spaces and punctuation that make shell use
        # painful, so store under a short stable name.
        dest = OUT / f"{lang}_{needle.replace(' ', '_')[:20]}.webm"

        if dest.exists():
            print(f"have {dest.name}")
        else:
            print(f"downloading {title[:52]} ({info['size'] / 1e6:.1f} MB)")
            req = urllib.request.Request(info["url"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=600) as r:
                dest.write_bytes(r.read())

        entries.append({
            "file": str(dest.relative_to(OUT.parent.parent.parent)),
            "language": lang,
            "commons_title": title,
            "author": field(meta, "Artist"),
            "licence": field(meta, "LicenseShortName"),
            "source": info.get("descriptionurl"),
            "duration_sec": round(info.get("duration") or 0, 1),
            "speech_type": "spontaneous",
            "reference": None,  # no ground truth — coverage and clips only
        })

    manifest = OUT / "manifest.json"
    manifest.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    print(f"\n{len(entries)} files -> {OUT}")
    print(f"manifest (with attribution) -> {manifest}")


if __name__ == "__main__":
    main()
