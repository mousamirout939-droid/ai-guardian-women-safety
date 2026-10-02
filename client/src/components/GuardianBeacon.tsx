import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import clsx from "clsx";

type BeaconState = "calm" | "caution" | "critical";
type SmsNotification = { status: string; sent: number; total: number };

const STATE_STYLES: Record<BeaconState, { ring: string; core: string; glow: string; label: string }> = {
  calm: {
    ring: "border-signal-500/40",
    core: "bg-signal-500",
    glow: "shadow-[0_0_60px_0_rgba(45,212,191,0.35)]",
    label: "All quiet",
  },
  caution: {
    ring: "border-beacon-500/40",
    core: "bg-beacon-500",
    glow: "shadow-beacon",
    label: "Stay alert",
  },
  critical: {
    ring: "border-alarm-500/40",
    core: "bg-alarm-500",
    glow: "shadow-[0_0_60px_0_rgba(225,29,72,0.45)]",
    label: "SOS active",
  },
};

export function GuardianBeacon({ state = "calm" }: { state?: BeaconState }) {
  const [triggering, setTriggering] = useState(false);
  const [triggered, setTriggered] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState("");
  const [error, setError] = useState("");
  const styles = STATE_STYLES[triggered ? "critical" : state];

  async function handleTrigger() {
    if (triggering) return;
    setTriggering(true);
    setError("");
    try {
      let location: { latitude: number; longitude: number } | undefined;
      if (navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 5000 });
          });
          location = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        } catch {
          location = undefined;
        }
      }
      const response = await api.post<{ metadata: Record<string, unknown> }>("/alerts", {
        source: "manual_sos",
        severity: "critical",
        message: "Manual SOS triggered from dashboard beacon",
        confidence: 1.0,
        location,
      });
      const sms = response.data.metadata.sms_notification as SmsNotification | undefined;
      if (!sms) {
        setNotificationMessage("In-app SOS alert sent.");
      } else if (sms.status === "accepted") {
        setNotificationMessage(`SMS accepted by Twilio for ${sms.sent}/${sms.total} trusted contacts.`);
      } else if (sms.status === "partial") {
        setNotificationMessage(`SMS accepted for ${sms.sent}/${sms.total} trusted contacts.`);
      } else if (sms.status === "not_configured") {
        setNotificationMessage("In-app alert sent; SMS is not configured on the server.");
      } else if (sms.status === "no_contacts") {
        setNotificationMessage("Alert sent in app; add a trusted contact to send SMS.");
      } else {
        setNotificationMessage("In-app alert sent, but SMS delivery failed.");
      }
      setTriggered(true);
      window.dispatchEvent(new Event("guardian-sos-started"));
    } catch {
      setError("SOS could not be sent. Check your connection and try again.");
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative flex h-52 w-52 items-center justify-center">
        <span className={clsx("absolute h-full w-full rounded-full border animate-pulse-ring", styles.ring)} />
        <span className={clsx("absolute h-full w-full rounded-full border animate-pulse-ring-delay", styles.ring)} />
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={handleTrigger}
          disabled={triggering}
          className={clsx(
            "relative flex h-36 w-36 flex-col items-center justify-center gap-1 rounded-full text-night-950 transition-colors",
            styles.core,
            styles.glow
          )}
        >
          <AlertTriangle className="h-8 w-8" strokeWidth={2.5} />
          <span className="font-display text-sm font-bold tracking-wide">
            {triggered ? "SENT" : "SOS"}
          </span>
        </motion.button>
      </div>
      <p className="font-mono text-xs uppercase tracking-widest text-ink-400">
        {triggered ? notificationMessage : styles.label}
      </p>
      {error && <p role="alert" className="text-center text-xs text-alarm-400">{error}</p>}
    </div>
  );
}
