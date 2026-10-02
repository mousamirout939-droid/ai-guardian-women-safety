from math import asin, cos, radians, sin, sqrt
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


def _distance_km(latitude: float, longitude: float, other_latitude: float, other_longitude: float) -> float:
    latitude_delta = radians(other_latitude - latitude)
    longitude_delta = radians(other_longitude - longitude)
    arc = sin(latitude_delta / 2) ** 2 + cos(radians(latitude)) * cos(radians(other_latitude)) * sin(longitude_delta / 2) ** 2
    return 6371 * 2 * asin(sqrt(arc))


def _serialize_place(place: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": place.get("display_name", ""),
        "latitude": float(place["lat"]),
        "longitude": float(place["lon"]),
    }

def _serialize_route(route: dict[str, Any]) -> dict[str, Any]:
    coordinates = route.get("geometry", {}).get("coordinates", [])
    return {
        "coordinates": [[latitude, longitude] for longitude, latitude in coordinates],
        "distance_km": round(route.get("distance", 0) / 1000, 2),
        "duration_minutes": round(route.get("duration", 0) / 60),
    }


@router.get("/geocode")
async def geocode_place(
    query: str = Query(..., min_length=3, max_length=200),
    _: dict = Depends(get_current_user),
):
    """Resolve a typed place name into map coordinates using OpenStreetMap."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": query, "format": "jsonv2", "limit": 3},
                headers={"User-Agent": f"{settings.APP_NAME}/1.0"},
            )
            response.raise_for_status()
            places = response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Place search is temporarily unavailable.") from exc

    return {"results": [_serialize_place(place) for place in places]}


@router.get("/walking-route")
async def walking_route(
    start_latitude: float = Query(..., ge=-90, le=90),
    start_longitude: float = Query(..., ge=-180, le=180),
    end_latitude: float = Query(..., ge=-90, le=90),
    end_longitude: float = Query(..., ge=-180, le=180),
    _: dict = Depends(get_current_user),
):
    """Return an estimated pedestrian route between two supplied locations."""
    route_url = (
        "https://routing.openstreetmap.de/routed-foot/route/v1/driving/"
        f"{start_longitude},{start_latitude};{end_longitude},{end_latitude}"
    )
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                route_url,
                params={"overview": "full", "geometries": "geojson"},
            )
            response.raise_for_status()
            routes = response.json().get("routes", [])
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Walking route service is temporarily unavailable.") from exc

    if not routes:
        raise HTTPException(status_code=404, detail="No pedestrian route found between those locations.")

    return _serialize_route(routes[0])


@router.get("/police-stations")
async def nearby_police_stations(
    latitude: float = Query(..., ge=-90, le=90, description="Current latitude"),
    longitude: float = Query(..., ge=-180, le=180, description="Current longitude"),
    radius_km: float = Query(5.0, gt=0, le=50, description="Search radius in kilometers"),
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

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://overpass-api.de/api/interpreter",
                data={"data": overpass_query},
                headers={"User-Agent": f"{settings.APP_NAME}/1.0", "Accept": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Police station search is temporarily unavailable.") from exc

    stations = []
    for element in payload.get("elements", []):
        tags = element.get("tags", {})
        if not tags.get("name"):
            continue
        coordinates = element.get("center", {})
        station_latitude = element.get("lat")
        station_longitude = element.get("lon")
        if station_latitude is None:
            station_latitude = coordinates.get("lat")
        if station_longitude is None:
            station_longitude = coordinates.get("lon")
        if station_latitude is None or station_longitude is None:
            continue
        station = {
            "name": tags.get("name", "Police station"),
            "address": _format_station_address(tags),
            "phone": tags.get("phone") or tags.get("contact:phone") or "",
            "distance_km": round(_distance_km(latitude, longitude, station_latitude, station_longitude), 2),
            "latitude": station_latitude,
            "longitude": station_longitude,
        }
        stations.append(station)

    stations.sort(key=lambda item: item["distance_km"])
    if not stations:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No nearby police stations found in the current search radius.",
        )

    return {"stations": stations[:5]}
