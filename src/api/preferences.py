"""Preferences API routes."""

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from src.preferences import Preferences, load_preferences, save_preferences

router = APIRouter(tags=["preferences"])

_COUNTRY_LOCATIONS_PATH = Path(__file__).parent.parent.parent / "data" / "country_locations.json"


@router.get("/preferences")
def get_preferences():
    prefs = load_preferences()
    return prefs.model_dump()


@router.post("/preferences")
def update_preferences(prefs: Preferences):
    save_preferences(prefs)
    return {"status": "saved", "preferences": prefs.model_dump()}


@router.get("/preferences/location-presets")
def get_location_presets():
    """Return country → location pattern mapping for the UI's
    one-click country-exclusion buttons."""
    if not _COUNTRY_LOCATIONS_PATH.exists():
        raise HTTPException(status_code=404, detail="Country presets file missing")
    try:
        data = json.loads(_COUNTRY_LOCATIONS_PATH.read_text())
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Country presets file is malformed: {e}")
    # Strip metadata keys
    return {k: v for k, v in data.items() if not k.startswith("_")}
