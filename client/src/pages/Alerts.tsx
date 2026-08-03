import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import api from "@/lib/api";
import { Alert, AlertStatus } from "@/lib/types";
import { useAlertsSocket } from "@/hooks/useAlertsSocket";
import { useAuth } from "@/context/AuthContext";
import clsx from "clsx";
import { CheckCircle2, XCircle, Circle } from "lucide-react";

const SEVERITY_STYLES: Record<Alert["severity"], string> = {
  low: "text-signal-400 bg-signal-500/10 border-signal-500/20",
  medium: "text-beacon-400 bg-beacon-500/10 border-beacon-500/20",
  high: "text-beacon-500 bg-beacon-500/15 border-beacon-500/30",
  critical: "text-alarm-400 bg-alarm-500/10 border-alarm-500/20",
};

const STATUS_OPTIONS: { value: AlertStatus; label: string; icon: typeof CheckCircle2 }[] = [
  { value: "acknowledged", label: "Acknowledge", icon: Circle },
  { value: "resolved", label: "Mark resolved", icon: CheckCircle2 },
  { value: "false_alarm", label: "False alarm", icon: XCircle },
];

export default function Alerts() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const isAdminFeed = user?.role === "admin" || user?.role === "police";

  const loadAlerts = useCallback(async () => {
    const feedPath = isAdminFeed ? "/alerts/feed" : "/alerts";
    const res = await api.get<Alert[]>(feedPath, { params: { limit: 100 } });
    setAlerts(res.data);
    setLoading(false);
  }, [isAdminFeed]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  useAlertsSocket((event) => {
    if (event.type === "new_alert" || event.type === "alert_updated") {
      setAlerts((prev) => {
        const withoutOld = prev.filter((a) => a.id !== event.alert.id);
        return [event.alert, ...withoutOld];
      });
    }
  });

  async function updateStatus(alertId: string, status: AlertStatus) {
    const res = await api.patch<Alert>(`/alerts/${alertId}/status`, { status });
    setAlerts((prev) => prev.map((a) => (a.id === alertId ? res.data : a)));
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {isAdminFeed ? "Live help feed" : "Alerts"}
          </h1>
          <p className="mt-1 text-ink-400">
            {isAdminFeed
              ? "Incoming help requests from every user appear here in real time."
              : "Every trigger, from every module, in one timeline."}
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : alerts.length === 0 ? (
          <div className="glass-panel rounded-2xl p-10 text-center">
            <p className="text-ink-400">No alerts yet. This page fills in the moment anything triggers.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div key={alert.id} className="glass-panel rounded-2xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span
                      className={clsx(
                        "mt-0.5 rounded-lg border px-2.5 py-1 font-mono text-xs uppercase",
                        SEVERITY_STYLES[alert.severity]
                      )}
                    >
                      {alert.severity}
                    </span>
                    <div>
                      <p className="font-medium text-ink-100">{alert.source.replace(/_/g, " ")}</p>
                      <p className="mt-0.5 text-sm text-ink-400">{alert.message || "No additional details"}</p>
                      <p className="mt-1 font-mono text-xs text-ink-500">
                        {new Date(alert.created_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {" · "}
                        confidence {Math.round(alert.confidence * 100)}%
                      </p>
                    </div>
                  </div>
                  <span
                    className={clsx(
                      "shrink-0 rounded-full px-3 py-1 text-xs font-medium capitalize",
                      alert.status === "active" && "bg-alarm-500/15 text-alarm-400",
                      alert.status === "acknowledged" && "bg-beacon-500/15 text-beacon-400",
                      alert.status === "resolved" && "bg-signal-500/15 text-signal-400",
                      alert.status === "false_alarm" && "bg-white/10 text-ink-400"
                    )}
                  >
                    {alert.status.replace("_", " ")}
                  </span>
                </div>

                {alert.status === "active" && (
                  <div className="mt-4 flex gap-2 border-t border-white/[0.06] pt-4">
                    {STATUS_OPTIONS.map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => updateStatus(alert.id, value)}
                        className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-ink-300 transition-colors hover:bg-white/[0.06]"
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
