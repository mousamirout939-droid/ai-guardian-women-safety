import { FormEvent, lazy, Suspense, useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { GuardianBeacon } from "@/components/GuardianBeacon";
import { useAlertsSocket } from "@/hooks/useAlertsSocket";
import api from "@/lib/api";
import { Alert, RiskPrediction } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { AlertTriangle, Users, Activity, TrendingUp, Phone, MapPin, Navigation } from "lucide-react";
import clsx from "clsx";

const PoliceHelpMap = lazy(() => import("@/components/PoliceHelpMap"));

const SEVERITY_STYLES: Record<Alert["severity"], string> = {
  low: "text-signal-400 bg-signal-500/10 border-signal-500/20",
  medium: "text-beacon-400 bg-beacon-500/10 border-beacon-500/20",
  high: "text-beacon-500 bg-beacon-500/15 border-beacon-500/30",
  critical: "text-alarm-400 bg-alarm-500/10 border-alarm-500/20",
};

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

interface Place extends Coordinates {
  name: string;
}

interface WalkingRoute {
  coordinates: Array<[number, number]>;
  distance_km: number;
  duration_minutes: number;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [risk, setRisk] = useState<RiskPrediction | null>(null);
  const [contactCount, setContactCount] = useState<number>(0);
  const [nearbyStations, setNearbyStations] = useState<PoliceStation[]>([]);
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null);
  const [walkingRoute, setWalkingRoute] = useState<Array<[number, number]> | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [startLabel, setStartLabel] = useState("Your location");
  const [startQuery, setStartQuery] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [routeStatus, setRouteStatus] = useState("");
  const [routeError, setRouteError] = useState("");
  const [searchingRoute, setSearchingRoute] = useState(false);
  const [manualRoute, setManualRoute] = useState(false);
  const [loading, setLoading] = useState(true);
  const isAdminFeed = user?.role === "admin" || user?.role === "police";

  const loadData = useCallback(async () => {
    const feedPath = isAdminFeed ? "/alerts/feed" : "/alerts";
    const [alertsRes, contactsRes] = await Promise.all([
      api.get<Alert[]>(feedPath, { params: { limit: 8 } }),
      api.get("/contacts"),
    ]);
    setAlerts(alertsRes.data);
    setContactCount(contactsRes.data.length);

    const now = new Date();
    const riskRes = await api.post<RiskPrediction>("/ai/risk-prediction", {
      hour_of_day: now.getHours(),
      is_weekend: now.getDay() === 0 || now.getDay() === 6,
      nearby_crime_count: 3,
      motion_level: 0.2,
      noise_level_db: 48,
      light_level_lux: now.getHours() >= 7 && now.getHours() <= 19 ? 350 : 20,
      weather_severity: 0,
      previous_alerts_30d: alertsRes.data.length,
    });
    setRisk(riskRes.data);

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 8000,
        });
      });
      const location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setCurrentLocation(location);
      setStartLabel("Your current location");
      const nearbyRes = await api.get<{ stations: PoliceStation[] }>('/safety/police-stations', {
        params: {
          ...location,
          radius_km: 5,
        },
      });
      setNearbyStations(nearbyRes.data.stations || []);
    } catch {
      setNearbyStations([]);
    }

    setLoading(false);
  }, [isAdminFeed]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const nearestStation = nearbyStations[0];
    if (manualRoute) return;
    if (!currentLocation || !nearestStation) {
      setWalkingRoute(null);
      return;
    }

    const controller = new AbortController();
    api.get<WalkingRoute>("/safety/walking-route", {
      params: {
        start_latitude: currentLocation.latitude,
        start_longitude: currentLocation.longitude,
        end_latitude: nearestStation.latitude,
        end_longitude: nearestStation.longitude,
      },
      signal: controller.signal,
    })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setWalkingRoute(data.coordinates);
      })
      .catch(() => {
        if (!controller.signal.aborted) setWalkingRoute(null);
      });

    return () => controller.abort();
  }, [currentLocation, nearbyStations, manualRoute]);

  async function findRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchingRoute(true);
    setRouteError("");
    setRouteStatus("");
    setWalkingRoute(null);
    setManualRoute(true);

    try {
      const destinationResponse = await api.get<{ results: Place[] }>("/safety/geocode", {
        params: { query: destinationQuery },
      });
      const resolvedDestination = destinationResponse.data.results[0];
      if (!resolvedDestination) throw new Error("Destination not found. Try adding a city or postcode.");

      let resolvedStart: Place | Coordinates | null = currentLocation;
      if (startQuery.trim()) {
        const startResponse = await api.get<{ results: Place[] }>("/safety/geocode", {
          params: { query: startQuery },
        });
        resolvedStart = startResponse.data.results[0] ?? null;
        if (!resolvedStart) throw new Error("Starting place not found. Try adding a city or postcode.");
        setStartLabel("Starting point");
      } else if (resolvedStart) {
        setStartLabel("Your current location");
      }
      if (!resolvedStart) throw new Error("Enter a starting place or allow location access to use your current location.");

      setCurrentLocation({ latitude: resolvedStart.latitude, longitude: resolvedStart.longitude });
      setDestination(resolvedDestination);

      const [routeResponse, stationsResponse] = await Promise.all([
        api.get<WalkingRoute>("/safety/walking-route", {
          params: {
            start_latitude: resolvedStart.latitude,
            start_longitude: resolvedStart.longitude,
            end_latitude: resolvedDestination.latitude,
            end_longitude: resolvedDestination.longitude,
          },
        }),
        api.get<{ stations: PoliceStation[] }>("/safety/police-stations", {
          params: {
            latitude: resolvedDestination.latitude,
            longitude: resolvedDestination.longitude,
            radius_km: 5,
          },
        }).catch(() => null),
      ]);

      setWalkingRoute(routeResponse.data.coordinates);
      setNearbyStations(stationsResponse?.data.stations ?? []);
      setRouteStatus(
        `Estimated walk: ${routeResponse.data.distance_km} km, about ${routeResponse.data.duration_minutes} minutes.`
      );
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : "Could not find that route. Please try again.");
      setNearbyStations([]);
    } finally {
      setSearchingRoute(false);
    }
  }

  function useCurrentLocation() {
    setStartQuery("");
    if (currentLocation) {
      setStartLabel("Your current location");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setCurrentLocation({ latitude: coords.latitude, longitude: coords.longitude });
        setStartLabel("Your current location");
      },
      () => setRouteError("Could not access your location. Enter a starting place instead."),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  useAlertsSocket((event) => {
    if (event.type === "new_alert" || event.type === "alert_updated") {
      setAlerts((prev) => {
        const withoutOld = prev.filter((a) => a.id !== event.alert.id);
        return [event.alert, ...withoutOld].slice(0, 8);
      });
    }
  });

  const beaconState = risk?.risk_level === "critical" || risk?.risk_level === "high"
    ? "caution"
    : "calm";

  const activeAlerts = alerts.filter((a) => a.status === "active").length;

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-ink-400">Everything looks like this in real time — nothing to refresh.</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="glass-panel flex flex-col items-center justify-center rounded-2xl p-8 lg:col-span-1">
            <GuardianBeacon state={beaconState} />
          </div>

          <div className="glass-panel rounded-2xl p-6 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-medium">Current risk read</h2>
              <TrendingUp className="h-4 w-4 text-ink-500" />
            </div>
            {risk ? (
              <div>
                <div className="mb-4 flex items-baseline gap-3">
                  <span
                    className={clsx(
                      "font-display text-4xl font-semibold capitalize",
                      risk.risk_level === "low" && "text-signal-400",
                      risk.risk_level === "medium" && "text-beacon-400",
                      (risk.risk_level === "high" || risk.risk_level === "critical") && "text-alarm-400"
                    )}
                  >
                    {risk.risk_level}
                  </span>
                  <span className="font-mono text-sm text-ink-500">
                    score {risk.risk_score.toFixed(2)}
                  </span>
                </div>
                <div className="space-y-2">
                  {Object.entries(risk.class_probabilities).map(([label, prob]) => (
                    <div key={label} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 font-mono text-xs uppercase text-ink-500">{label}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full bg-signal-500"
                          style={{ width: `${Math.round(prob * 100)}%` }}
                        />
                      </div>
                      <span className="w-10 text-right font-mono text-xs text-ink-500">
                        {Math.round(prob * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-500">Calculating…</p>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <StatCard icon={AlertTriangle} label="Active alerts" value={activeAlerts} accent="alarm" />
          <StatCard icon={Activity} label="Total alerts logged" value={alerts.length} accent="signal" />
          <StatCard icon={Users} label="Trusted contacts" value={contactCount} accent="beacon" />
        </div>

        <div className="glass-panel mt-6 rounded-2xl p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-medium">Nearby police help</h2>
            <MapPin className="h-4 w-4 text-beacon-400" />
          </div>
          <div className="space-y-4">
            <form onSubmit={findRoute} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <label className="text-xs font-medium text-ink-400">
                From
                <input
                  value={startQuery}
                  onChange={(event) => setStartQuery(event.target.value)}
                  placeholder={currentLocation ? "Use current location or enter a place" : "Enter starting area, address, or city"}
                  className="glass-input mt-1.5 w-full"
                />
              </label>
              <label className="text-xs font-medium text-ink-400">
                To
                <input
                  required
                  minLength={3}
                  value={destinationQuery}
                  onChange={(event) => setDestinationQuery(event.target.value)}
                  placeholder="Enter destination, address, or city"
                  className="glass-input mt-1.5 w-full"
                />
              </label>
              <button disabled={searchingRoute} type="submit" className="btn-beacon self-end">
                {searchingRoute ? "Finding route…" : "Show route"}
              </button>
            </form>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <button type="button" onClick={useCurrentLocation} className="btn-ghost px-3 py-2 text-xs">
                Use my location as start
              </button>
              {currentLocation && <span className="text-xs text-ink-500">Start: {startLabel}</span>}
            </div>
            {routeError && <p role="alert" className="text-sm text-alarm-400">{routeError}</p>}
            {routeStatus && <p className="text-sm text-signal-300">{routeStatus}</p>}
            {nearbyStations.length === 0 && !routeStatus && (
              <p className="text-sm text-ink-500">
                Search for a destination to see nearby police stations. GPS is optional.
              </p>
            )}
            {routeStatus && nearbyStations.length === 0 && (
              <p className="text-sm text-ink-500">No police stations were found within 5 km of the destination.</p>
            )}
            {(currentLocation || destination) && (
              <div className="space-y-3">
              <p className="text-xs text-ink-500">
                Place names are searched with OpenStreetMap Nominatim; route coordinates go to its walking router. Routes are estimates, not safety-verified.
              </p>
              {currentLocation && (nearbyStations.length > 0 || walkingRoute) && (
                <Suspense fallback={<div className="flex h-80 items-center justify-center rounded-xl bg-white/[0.03] text-sm text-ink-400">Loading map…</div>}>
                  <PoliceHelpMap
                    currentLocation={currentLocation}
                    startLabel={startLabel}
                    destination={destination}
                    stations={nearbyStations}
                    walkingRoute={walkingRoute}
                  />
                </Suspense>
              )}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-400">
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-signal-400" />{startLabel}</span>
                {destination && <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-beacon-400" />{destination.name}</span>}
                {nearbyStations.length > 0 && <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-alarm-500" />Police station</span>}
                {walkingRoute && <span className="flex items-center gap-2"><span className="h-1 w-4 rounded bg-teal-700" />{destination ? "Walking route" : "Walking route to nearest station"}</span>}
                {!walkingRoute && <span>Route preview unavailable; use Directions below.</span>}
              </div>
              {nearbyStations.map((station) => (
                <div key={`${station.name}-${station.address}`} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-ink-100">{station.name}</p>
                      <p className="mt-1 text-xs text-ink-400">{station.address || "Address not listed"}</p>
                      <p className="mt-1 font-mono text-xs text-ink-500">{station.distance_km.toFixed(1)} km away</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <a
                        href={`https://www.google.com/maps/dir/?api=1${currentLocation ? `&origin=${currentLocation.latitude},${currentLocation.longitude}` : ""}&destination=${station.latitude},${station.longitude}&travelmode=walking`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg border border-signal-500/30 bg-signal-500/10 px-3 py-1.5 text-xs font-medium text-signal-300"
                      >
                        <Navigation className="h-3.5 w-3.5" />
                        Directions
                      </a>
                      {station.phone ? (
                        <a
                          href={`tel:${station.phone}`}
                          className="inline-flex items-center gap-2 rounded-lg border border-beacon-500/30 bg-beacon-500/10 px-3 py-1.5 text-xs font-medium text-beacon-300"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          Call
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
              </div>
            )}
          </div>
        </div>

        <div className="glass-panel mt-6 rounded-2xl p-6">
          <h2 className="mb-4 font-display text-lg font-medium">Recent activity</h2>
          {loading ? (
            <p className="text-sm text-ink-500">Loading alert history…</p>
          ) : alerts.length === 0 ? (
            <p className="text-sm text-ink-500">
              No alerts yet. Once a module detects something — or you trigger the beacon — it shows up here instantly.
            </p>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className={clsx("rounded-lg border px-2.5 py-1 font-mono text-xs uppercase", SEVERITY_STYLES[alert.severity])}>
                      {alert.severity}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-ink-100">
                        {alert.source.replace(/_/g, " ")}
                      </p>
                      <p className="text-xs text-ink-500">{alert.message || "No additional details"}</p>
                    </div>
                  </div>
                  <span className="font-mono text-xs text-ink-500">
                    {new Date(alert.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof AlertTriangle;
  label: string;
  value: number;
  accent: "alarm" | "signal" | "beacon";
}) {
  const accentClasses = {
    alarm: "bg-alarm-500/10 text-alarm-400",
    signal: "bg-signal-500/10 text-signal-400",
    beacon: "bg-beacon-500/10 text-beacon-400",
  }[accent];

  return (
    <div className="glass-panel rounded-2xl p-5">
      <div className={clsx("mb-3 flex h-10 w-10 items-center justify-center rounded-xl", accentClasses)}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="font-display text-2xl font-semibold">{value}</p>
      <p className="text-sm text-ink-400">{label}</p>
    </div>
  );
}
