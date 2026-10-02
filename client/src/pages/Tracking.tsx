import { FormEvent, lazy, Suspense, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, MapPin, ShieldCheck } from "lucide-react";
import api from "@/lib/api";

const PoliceHelpMap = lazy(() => import("@/components/PoliceHelpMap"));

interface TrackedLocation {
  latitude: number;
  longitude: number;
  timestamp: string;
}

interface TrackingStatus {
  user_name: string;
  status: string;
  severity: string;
  message: string;
  created_at: string;
  location: { latitude: number; longitude: number } | null;
  location_history: TrackedLocation[];
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  escalation_state: string;
}

export default function Tracking() {
  const { token = "" } = useParams();
  const [tracking, setTracking] = useState<TrackingStatus | null>(null);
  const [contactName, setContactName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState(false);
  const activeRef = useRef(true);
  const loadedOnceRef = useRef(false);

  useEffect(() => {
    activeRef.current = true;
    loadedOnceRef.current = false;
    let mounted = true;

    const refresh = async () => {
      try {
        const { data } = await api.get<TrackingStatus>(`/safety/tracking/${encodeURIComponent(token)}`);
        if (!mounted) return;
        setTracking(data);
        setError("");
        loadedOnceRef.current = true;
        activeRef.current = data.status === "active";
      } catch (requestError) {
        if (!mounted) return;
        const status = (requestError as { response?: { status?: number } }).response?.status;
        if (status === 404 || status === 410) activeRef.current = false;
        setError(loadedOnceRef.current ? "Live updates are temporarily unavailable. Retrying…" : "This tracking link is invalid or has expired.");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      if (activeRef.current) void refresh();
    }, 5000);
    return () => {
      mounted = false;
      activeRef.current = false;
      window.clearInterval(interval);
    };
  }, [token]);

  async function acknowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactName.trim()) return;
    setAcknowledging(true);
    setError("");
    try {
      const { data } = await api.post<{ status: string; acknowledged_at: string; acknowledged_by: string }>(
        `/safety/tracking/${encodeURIComponent(token)}/acknowledge`,
        { name: contactName.trim() }
      );
      setTracking((current) => current ? {
        ...current,
        status: data.status,
        acknowledged_at: data.acknowledged_at,
        acknowledged_by: data.acknowledged_by,
        escalation_state: "acknowledged",
      } : current);
      activeRef.current = false;
    } catch {
      setError("Could not acknowledge this alert. It may have already been acknowledged.");
    } finally {
      setAcknowledging(false);
    }
  }

  const history = tracking?.location_history ?? [];
  const latest = tracking?.location ?? history.at(-1) ?? null;
  const routeUrl = latest && history.length > 0
    ? createGoogleRouteUrl(history, latest)
    : null;
  const acknowledged = tracking?.status !== "active";

  return (
    <main className="min-h-screen bg-night-950 px-4 py-8 text-ink-100 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-signal-400" />
          <span className="font-display text-lg font-semibold">Guardian Shield</span>
        </header>

        {loading ? (
          <p className="text-sm text-ink-400">Loading SOS status…</p>
        ) : error && !tracking ? (
          <section className="glass-panel rounded-xl p-6" role="alert">
            <h1 className="font-display text-xl font-semibold">Tracker unavailable</h1>
            <p className="mt-2 text-sm text-ink-400">{error}</p>
          </section>
        ) : tracking ? (
          <>
            <section className="glass-panel rounded-xl p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="font-display text-2xl font-semibold">SOS for {tracking.user_name}</h1>
                  <p className="mt-1 text-sm text-ink-400">{tracking.message}</p>
                </div>
                <span className={
                  acknowledged
                    ? "inline-flex items-center gap-2 rounded-full bg-signal-500/15 px-3 py-1.5 text-sm text-signal-300"
                    : "inline-flex items-center gap-2 rounded-full bg-alarm-500/15 px-3 py-1.5 text-sm text-alarm-300"
                }>
                  {acknowledged ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                  {tracking.status.replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-4 text-xs text-ink-500">
                Alert started {new Date(tracking.created_at).toLocaleString()} · Location refreshes every 5 seconds while active.
              </p>
              {tracking.acknowledged_by && (
                <p className="mt-3 text-sm text-signal-300">
                  Acknowledged by {tracking.acknowledged_by}{tracking.acknowledged_at ? ` at ${new Date(tracking.acknowledged_at).toLocaleTimeString()}` : ""}.
                </p>
              )}
            </section>

            <section className="glass-panel mt-5 rounded-xl p-5">
              <div className="mb-3 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-signal-400" />
                <h2 className="font-display text-base font-medium">Live location</h2>
              </div>
              {latest ? (
                <>
                  <Suspense fallback={<div className="flex h-80 items-center justify-center text-sm text-ink-400">Loading map…</div>}>
                    <PoliceHelpMap
                      currentLocation={latest}
                      startLabel={history.length > 1 ? "Latest location" : "SOS location"}
                      destination={null}
                      stations={[]}
                      walkingRoute={history.map(({ latitude, longitude }) => [latitude, longitude] as [number, number])}
                      googleDirectionsUrl={routeUrl}
                    />
                  </Suspense>
                  {history.length > 0 && (
                    <p className="mt-3 text-xs text-ink-500">
                      Last update {new Date(history.at(-1)!.timestamp).toLocaleTimeString()} · {history.length} location points
                    </p>
                  )}
                </>
              ) : (
                <p className="py-10 text-center text-sm text-ink-400">Waiting for the user’s first location update.</p>
              )}
            </section>

            {!acknowledged && (
              <form onSubmit={acknowledge} className="glass-panel mt-5 rounded-xl p-5">
                <h2 className="font-display text-base font-medium">Let them know you’re responding</h2>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <input
                    required
                    maxLength={80}
                    value={contactName}
                    onChange={(event) => setContactName(event.target.value)}
                    placeholder="Your name"
                    aria-label="Your name"
                    className="glass-input min-w-0 flex-1"
                  />
                  <button type="submit" disabled={acknowledging} className="btn-beacon flex items-center justify-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    {acknowledging ? "Sending…" : "Acknowledge SOS"}
                  </button>
                </div>
              </form>
            )}
            {error && <p role="status" className="mt-3 text-sm text-beacon-300">{error}</p>}
          </>
        ) : null}
      </div>
    </main>
  );
}

function createGoogleRouteUrl(
  locations: TrackedLocation[],
  latest: { latitude: number; longitude: number }
): string {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", `${locations[0].latitude},${locations[0].longitude}`);
  url.searchParams.set("destination", `${latest.latitude},${latest.longitude}`);
  url.searchParams.set("travelmode", "walking");
  const middlePoints = locations.slice(1, -1);
  if (middlePoints.length > 0) {
    const sampled = middlePoints.filter((_, index) => index % Math.max(1, Math.ceil(middlePoints.length / 8)) === 0).slice(0, 8);
    url.searchParams.set("waypoints", sampled.map(({ latitude, longitude }) => `${latitude},${longitude}`).join("|"));
  }
  return url.toString();
}