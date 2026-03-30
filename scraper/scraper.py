#!/usr/bin/env python3
"""
Lorain County Jail Roster Scraper
Scrapes the Tyler Technologies inmate inquiry system and saves booking data + mugshots.
Designed to run via GitHub Actions on a cron schedule.
"""

import os
import sys
import json
import hashlib
import logging
import time
from datetime import datetime, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ── Config ──────────────────────────────────────────────────────────
BASE_URL = "https://loraincooh-wii.publicsafety.tylerapp.com/Default"
SEARCH_URL = f"{BASE_URL}"
DETAIL_URL = f"{BASE_URL}/Inmate/Detail"
PHOTO_URL = f"{BASE_URL}/Inmate/Photo"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
IMAGES_DIR = PROJECT_ROOT / "images"
BOOKINGS_FILE = DATA_DIR / "bookings.json"

# How many days back to search (covers weekends/holidays)
LOOKBACK_DAYS = 3

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

session = requests.Session()
session.headers.update({
    "User-Agent": "LorainBookings/1.0 (Public Records Aggregator)"
})


# ── Helpers ─────────────────────────────────────────────────────────
def load_existing_bookings() -> dict:
    """Load existing bookings from JSON file, keyed by booking_id."""
    if BOOKINGS_FILE.exists():
        with open(BOOKINGS_FILE, "r") as f:
            data = json.load(f)
            return {b["booking_id"]: b for b in data.get("bookings", [])}
    return {}


def save_bookings(bookings: dict):
    """Save bookings dict to JSON file."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    sorted_bookings = sorted(
        bookings.values(),
        key=lambda b: b.get("booking_date_raw", ""),
        reverse=True,
    )
    output = {
        "last_updated": datetime.utcnow().isoformat() + "Z",
        "total": len(sorted_bookings),
        "bookings": sorted_bookings,
    }
    with open(BOOKINGS_FILE, "w") as f:
        json.dump(output, f, indent=2)
    log.info(f"Saved {len(sorted_bookings)} bookings to {BOOKINGS_FILE}")


def download_mugshot(photo_id: str) -> str | None:
    """Download a mugshot image and return the relative path."""
    if not photo_id:
        return None

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{photo_id}.jpg"
    filepath = IMAGES_DIR / filename

    if filepath.exists():
        return f"images/{filename}"

    try:
        url = f"{PHOTO_URL}/{photo_id}?type=Detail"
        resp = session.get(url, timeout=15)
        if resp.status_code == 200 and len(resp.content) > 500:
            with open(filepath, "wb") as f:
                f.write(resp.content)
            log.info(f"  Downloaded mugshot: {filename}")
            return f"images/{filename}"
    except Exception as e:
        log.warning(f"  Failed to download mugshot {photo_id}: {e}")

    return None


# ── Scraping ────────────────────────────────────────────────────────
def search_bookings(from_date: str, to_date: str) -> list[dict]:
    """
    Search the inmate roster for a date range.
    Returns a list of partial booking records (from the search results table).
    """
    params = {
        "Name": "",
        "SubjectNumber": "",
        "BookingNumber": "",
        "BookingFromDate": from_date,
        "BookingToDate": to_date,
        "Facility": "",
    }

    log.info(f"Searching bookings: {from_date} to {to_date}")

    try:
        resp = session.get(SEARCH_URL, params=params, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        log.error(f"Search request failed: {e}")
        return []

    soup = BeautifulSoup(resp.text, "lxml")
    table = soup.find("table")
    if not table:
        log.info("  No results table found")
        return []

    rows = table.find_all("tr")[1:]  # skip header
    results = []

    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 12:
            continue

        # Extract the detail link and inmate ID
        link = cells[1].find("a")
        if not link:
            continue

        href = link.get("href", "")
        inmate_id = href.split("/")[-1] if "/" in href else ""
        name = link.text.strip()

        # Extract thumbnail photo ID
        img = cells[0].find("img")
        photo_id = img.get("alt", "") if img else ""

        # Extract table data
        record = {
            "inmate_id": inmate_id,
            "name": name,
            "subject_number": cells[2].text.strip(),
            "in_custody": cells[3].text.strip(),
            "scheduled_release": cells[4].text.strip(),
            "race": cells[5].text.strip(),
            "gender": cells[6].text.strip(),
            "dob": cells[7].text.strip(),
            "height": cells[8].text.strip(),
            "weight": cells[9].text.strip(),
            "multiple_bookings": cells[10].text.strip(),
            "housing_facility": cells[11].text.strip(),
            "photo_id": photo_id,
            "detail_url": f"{DETAIL_URL}/{inmate_id}",
        }
        results.append(record)

    log.info(f"  Found {len(results)} inmates in search results")
    return results


def scrape_detail(inmate_id: str) -> dict:
    """
    Scrape the full detail page for an inmate.
    Returns charge info, booking details, bond info, etc.
    """
    url = f"{DETAIL_URL}/{inmate_id}"

    try:
        resp = session.get(url, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        log.warning(f"  Detail request failed for {inmate_id}: {e}")
        return {}

    soup = BeautifulSoup(resp.text, "lxml")
    detail = {}

    # ── Demographic fields ──
    field_map = {
        "Name": "name",
        "SubjectNumber": "subject_number",
        "DateOfBirth": "dob",
        "Age": "age",
        "Gender": "gender",
        "Race": "race",
        "Height": "height",
        "Weight": "weight",
        "Address": "address",
    }
    for html_id, key in field_map.items():
        el = soup.find(id=html_id)
        if el:
            detail[key] = el.text.strip()

    # ── Photo IDs ──
    photos = []
    for img in soup.select("#Photos img"):
        alt = img.get("alt", "")
        if alt:
            photos.append(alt)
    detail["photo_ids"] = photos

    # ── Booking info ──
    booking_section = soup.find(id="BookingHistory") or soup.find("h3", string=lambda s: s and "Booking" in s)

    # Parse booking fields from the FieldList structure
    for li in soup.select("#BookingHistory .FieldList li, .BookingDetail .FieldList li"):
        label_el = li.find("label")
        value_el = li.find("span")
        if label_el and value_el:
            label = label_el.text.strip().rstrip(":")
            value = value_el.text.strip()
            label_lower = label.lower().replace(" ", "_")
            detail[f"booking_{label_lower}"] = value

    # ── Charges ──
    charges = []
    charge_tables = soup.find_all("table")
    for table in charge_tables:
        headers = [th.text.strip().lower() for th in table.find_all("th")]
        if "charge description" in " ".join(headers) or "charge_description" in " ".join(headers):
            for row in table.find_all("tr")[1:]:
                cells = row.find_all("td")
                if len(cells) >= 6:
                    charge = {
                        "number": cells[0].text.strip() if len(cells) > 0 else "",
                        "description": cells[1].text.strip() if len(cells) > 1 else "",
                        "counts": cells[2].text.strip() if len(cells) > 2 else "",
                        "offense_date": cells[3].text.strip() if len(cells) > 3 else "",
                        "docket_number": cells[4].text.strip() if len(cells) > 4 else "",
                        "crime_class": cells[10].text.strip() if len(cells) > 10 else "",
                        "arresting_agency": cells[11].text.strip() if len(cells) > 11 else "",
                    }
                    if charge["description"]:
                        charges.append(charge)

    detail["charges"] = charges

    # ── Bond info ──
    bonds = []
    for table in charge_tables:
        headers = [th.text.strip().lower() for th in table.find_all("th")]
        if "bond number" in " ".join(headers):
            for row in table.find_all("tr")[1:]:
                cells = row.find_all("td")
                if len(cells) >= 3:
                    bond = {
                        "bond_number": cells[0].text.strip(),
                        "bond_type": cells[1].text.strip(),
                        "bond_amount": cells[2].text.strip(),
                    }
                    if bond["bond_number"]:
                        bonds.append(bond)

    detail["bonds"] = bonds

    return detail


def generate_booking_id(inmate_id: str, booking_date: str) -> str:
    """Generate a stable unique ID for a booking."""
    raw = f"{inmate_id}-{booking_date}"
    return hashlib.md5(raw.encode()).hexdigest()[:12]


# ── Main ────────────────────────────────────────────────────────────
def main():
    log.info("=" * 60)
    log.info("Lorain County Booking Scraper - Starting")
    log.info("=" * 60)

    existing = load_existing_bookings()
    log.info(f"Loaded {len(existing)} existing bookings")

    # Search the last N days
    today = datetime.now()
    from_date = (today - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    to_date = today.strftime("%Y-%m-%d")

    search_results = search_bookings(from_date, to_date)

    new_count = 0
    updated_count = 0

    for result in search_results:
        inmate_id = result["inmate_id"]

        # Scrape the full detail page
        time.sleep(0.5)  # be polite
        detail = scrape_detail(inmate_id)

        if not detail:
            log.warning(f"  Skipping {result['name']} - no detail data")
            continue

        # Determine booking date for the ID
        booking_date = detail.get("booking_booking_date", result.get("dob", "unknown"))
        booking_id = generate_booking_id(inmate_id, booking_date)

        # Download mugshot(s)
        mugshot_paths = []
        photo_ids = detail.get("photo_ids", [])
        if not photo_ids and result.get("photo_id"):
            photo_ids = [result["photo_id"]]

        for pid in photo_ids:
            path = download_mugshot(pid)
            if path:
                mugshot_paths.append(path)

        # Build the full record
        booking = {
            "booking_id": booking_id,
            "inmate_id": inmate_id,
            "name": detail.get("name", result["name"]),
            "dob": detail.get("dob", result["dob"]),
            "age": detail.get("age", ""),
            "gender": detail.get("gender", result["gender"]),
            "race": detail.get("race", result["race"]),
            "height": detail.get("height", result["height"]),
            "weight": detail.get("weight", result["weight"]),
            "address": detail.get("address", ""),
            "in_custody": result.get("in_custody", ""),
            "housing_facility": result.get("housing_facility", ""),
            "booking_date": detail.get("booking_booking_date", ""),
            "booking_date_raw": detail.get("booking_booking_date", ""),
            "release_date": detail.get("booking_release_date", ""),
            "booking_origin": detail.get("booking_booking_origin", ""),
            "prisoner_type": detail.get("booking_prisoner_type", ""),
            "classification": detail.get("booking_classification", ""),
            "total_bond": detail.get("booking_total_bond_amount", ""),
            "total_bail": detail.get("booking_total_bail_amount", ""),
            "charges": detail.get("charges", []),
            "bonds": detail.get("bonds", []),
            "mugshots": mugshot_paths,
            "photo_ids": photo_ids,
            "subject_number": detail.get("subject_number", result["subject_number"]),
            "scraped_at": datetime.utcnow().isoformat() + "Z",
        }

        if booking_id in existing:
            # Update existing record (in case custody status changed etc.)
            existing[booking_id].update(booking)
            updated_count += 1
        else:
            existing[booking_id] = booking
            new_count += 1
            log.info(f"  NEW: {booking['name']} - {booking['booking_date']}")

    save_bookings(existing)

    log.info("=" * 60)
    log.info(f"Done! {new_count} new, {updated_count} updated, {len(existing)} total")
    log.info("=" * 60)

    # Set GitHub Actions output
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"new_bookings={new_count}\n")
            f.write(f"total_bookings={len(existing)}\n")
            f.write(f"has_new={'true' if new_count > 0 else 'false'}\n")


if __name__ == "__main__":
    main()
