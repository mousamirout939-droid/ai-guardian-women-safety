import { useEffect, useRef, useState } from "react";
import { getTokens } from "@/lib/api";
import { Alert } from "@/lib/types";

interface WsEvent {
  type: "new_alert" | "alert_updated" | "network_alert";
  alert: Alert;
  user_name?: string;
}

export function useAlertsSocket(onEvent?: (event: WsEvent) => void) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const { access } = getTokens();
    if (!access) return;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${window.location.host}/ws/alerts?token=${access}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (msg) => {
      try {
        const data: WsEvent = JSON.parse(msg.data);
        onEvent?.(data);
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { connected };
}
