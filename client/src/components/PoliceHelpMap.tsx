import { useEffect, useMemo } from "react";
import { latLngBounds } from "leaflet";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

interface Coordinates {
  latitude: number;
  longitude: number;
}

interface PoliceStation extends Coordinates {
  name: string;
  address: string;
  phone: string;
  distance_km: number;
}

interface Destination extends Coordinates {
  name: string;
}

interface PoliceHelpMapProps {
  currentLocation: Coordinates;
  startLabel: string;
  destination: Destination | null;
  stations: PoliceStation[];
  walkingRoute: Array<[number, number]> | null;
}

export default function PoliceHelpMap({ currentLocation, startLabel, destination, stations, walkingRoute }: PoliceHelpMapProps) {
  const currentPosition = useMemo<[number, number]>(
    () => [currentLocation.latitude, currentLocation.longitude],
    [currentLocation.latitude, currentLocation.longitude]
  );
  const mapPoints = useMemo(
    () => [
      currentPosition,
      ...(destination ? [[destination.latitude, destination.longitude] as [number, number]] : []),
      ...stations.map((station): [number, number] => [station.latitude, station.longitude]),
      ...(walkingRoute ?? []),
    ],
    [currentPosition, destination, stations, walkingRoute]
  );

  return (
    <div className="relative z-0 h-80 overflow-hidden rounded-xl border border-white/[0.08]">
      <MapContainer center={currentPosition} zoom={14} scrollWheelZoom={false} className="h-full w-full">
        <FitMapBounds points={mapPoints} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <CircleMarker
          center={currentPosition}
          radius={9}
          pathOptions={{ color: "#ffffff", fillColor: "#2dd4bf", fillOpacity: 1, weight: 3 }}
        >
          <Popup>{startLabel}</Popup>
        </CircleMarker>
        {destination && (
          <CircleMarker
            center={[destination.latitude, destination.longitude]}
            radius={9}
            pathOptions={{ color: "#ffffff", fillColor: "#f5b942", fillOpacity: 1, weight: 3 }}
          >
            <Popup>{destination.name}</Popup>
          </CircleMarker>
        )}
        {stations.map((station) => (
          <CircleMarker
            key={`${station.name}-${station.latitude}-${station.longitude}`}
            center={[station.latitude, station.longitude]}
            radius={7}
            pathOptions={{ color: "#ffffff", fillColor: "#e11d48", fillOpacity: 1, weight: 2 }}
          >
            <Popup>{station.name}</Popup>
          </CircleMarker>
        ))}
        {walkingRoute && (
          <Polyline positions={walkingRoute} pathOptions={{ color: "#0f766e", weight: 5, opacity: 0.9 }} />
        )}
      </MapContainer>
    </div>
  );
}

function FitMapBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();

  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(latLngBounds(points), { padding: [32, 32], maxZoom: 14 });
    }
  }, [map, points]);

  return null;
}