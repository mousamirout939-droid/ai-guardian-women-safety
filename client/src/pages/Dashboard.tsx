import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { GuardianBeacon } from "@/components/GuardianBeacon";
import { useAlertsSocket } from "@/hooks/useAlertsSocket";
import api from "@/lib/api";
import { Alert, RiskPrediction } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { AlertTriangle, Users, Activity, TrendingUp, Phone, MapPin } from "lucide-react";
import clsx from "clsx";

const SEVERITY_STYLES: Record<Alert["severity"], string> = {
  low: "text-signal-400 bg-signal-500/10 border-signal-500/20",
  medium: "text-beacon-400 bg-beacon-500/10 border-beacon-500/20",
  high: "text-beacon-500 bg-beacon-500/15 border-beacon-500/30",
  critical: "text-alarm-400 bg-alarm-500/10 border-alarm-500/20",
};

export default function Dashboard() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [risk, setRisk] = useState<RiskPrediction | null>(null);
  const [contactCount, setContactCount] = useState<number>(0);
  const [nearbyStations, setNearbyStations] = useState<Array<{ name: string; address: string; phone: string; latitude: number; longitude: number }>>([]);
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
      const nearbyRes = await api.get<{ stations: Array<{ name: string; address: string; phone: string; latitude: number; longitude: number }> }>('/safety/police-stations', {
        params: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
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
          {nearbyStations.length === 0 ? (
            <p className="text-sm text-ink-500">Location permission is needed to fetch nearby police stations.</p>
          ) : (
            <div className="space-y-3">
              {nearbyStations.map((station) => (
                <div key={`${station.name}-${station.address}`} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-ink-100">{station.name}</p>
                      <p className="mt-1 text-xs text-ink-400">{station.address}</p>
                    </div>
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
              ))}
            </div>
          )}
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
