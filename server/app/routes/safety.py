from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.config import get_settings
from app.core.deps import get_current_user

router = APIRouter(prefix="/api/safety", tags=["safety"])
settings = get_settings()


def _format_station_address(tags: dict[str, Any]) -> str:
    street_number = str(tags.get("addr:housenumber") or "").strip()
    street_name = str(tags.get("addr:street") or "").strip()
    street_line = " ".join(part for part in [street_number, street_name] if part)

    city = tags.get("addr:city") or tags.get("addr:suburb") or tags.get("addr:town") or ""
    postcode = tags.get("addr:postcode") or ""

    address_parts = [part for part in [street_line, city, postcode] if part]
    return ", ".join(address_parts)


@router.get("/police-stations")
async def nearby_police_stations(
    latitude: float = Query(..., description="Current latitude"),
    longitude: float = Query(..., description="Current longitude"),
    radius_km: float = Query(5.0, description="Search radius in kilometers"),
    _: dict = Depends(get_current_user),
):
    """Return nearby police stations from OpenStreetMap Overpass using the user's current coordinates."""
    overpass_query = f"""
    [out:json][timeout:25];
    (
      node["amenity"="police"](around:{int(radius_km * 1000)},{latitude},{longitude});
      way["amenity"="police"](around:{int(radius_km * 1000)},{latitude},{longitude});
      relation["amenity"="police"](around:{int(radius_km * 1000)},{latitude},{longitude});
    );
    out center tags;
    """

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            "https://overpass-api.de/api/interpreter",
            data={"data": overpass_query},
        )
        response.raise_for_status()
        payload = response.json()

    stations = []
    for element in payload.get("elements", []):
        tags = element.get("tags", {})
        if not tags.get("name"):
            continue
        station = {
            "name": tags.get("name", "Police station"),
            "address": _format_station_address(tags),
            "phone": tags.get("phone") or tags.get("contact:phone") or "",
            "distance_km": round(0.0, 2),
            "latitude": element.get("lat") or element.get("center", {}).get("lat"),
            "longitude": element.get("lon") or element.get("center", {}).get("lon"),
        }
        stations.append(station)

    stations.sort(key=lambda item: (item["name"], item["address"]))
    if not stations:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No nearby police stations found in the current search radius.",
        )

    return {"stations": stations[:5]}
