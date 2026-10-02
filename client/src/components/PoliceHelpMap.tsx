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
  googleDirectionsUrl: string | null;
}

export default function PoliceHelpMap({
  currentLocation,
  startLabel,
  destination,
  stations,
  walkingRoute,
  googleDirectionsUrl,
}: PoliceHelpMapProps) {
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
      {googleDirectionsUrl && (
        <a
          href={googleDirectionsUrl}
          target="_blank"
          rel="noreferrer"
          className="absolute right-3 top-3 z-[1000] inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-night-950 shadow-lg"
        >
          Open full route in Google Maps
        </a>
      )}
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
          <Popup>
            <div className="space-y-1">
              <p>{startLabel}</p>
              {googleDirectionsUrl && <a href={googleDirectionsUrl} target="_blank" rel="noreferrer">Open full route</a>}
            </div>
          </Popup>
        </CircleMarker>
        {destination && (
          <CircleMarker
            center={[destination.latitude, destination.longitude]}
            radius={9}
            pathOptions={{ color: "#ffffff", fillColor: "#f5b942", fillOpacity: 1, weight: 3 }}
          >
            <Popup>
              <div className="space-y-1">
                <p>{destination.name}</p>
                {googleDirectionsUrl && <a href={googleDirectionsUrl} target="_blank" rel="noreferrer">Open full route</a>}
              </div>
            </Popup>
          </CircleMarker>
        )}
        {stations.map((station) => (
          <CircleMarker
            key={`${station.name}-${station.latitude}-${station.longitude}`}
            center={[station.latitude, station.longitude]}
            radius={7}
            pathOptions={{ color: "#ffffff", fillColor: "#e11d48", fillOpacity: 1, weight: 2 }}
          >
            <Popup>
              <div className="space-y-1">
                <p>{station.name}</p>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&origin=${currentLocation.latitude},${currentLocation.longitude}&destination=${station.latitude},${station.longitude}&travelmode=walking`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Directions to station
                </a>
              </div>
            </Popup>
          </CircleMarker>
        ))}
        {walkingRoute && (
          <Polyline
            positions={walkingRoute}
            pathOptions={{ color: "#0f766e", weight: 7, opacity: 0.95 }}
            eventHandlers={{
              click: () => {
                if (googleDirectionsUrl) window.open(googleDirectionsUrl, "_blank", "noopener,noreferrer");
              },
            }}
          />
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