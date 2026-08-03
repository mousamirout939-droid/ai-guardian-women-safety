export interface User {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: "user" | "police" | "admin";
  created_at: string;
}

export interface Contact {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  email?: string | null;
  relationship: string;
  priority: number;
}

export type AlertSource =
  | "manual_sos"
  | "gesture_detection"
  | "scream_detection"
  | "object_detection"
  | "fall_detection"
  | "voice_command";

export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertStatus = "active" | "acknowledged" | "resolved" | "false_alarm";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface Alert {
  id: string;
  user_id: string;
  source: AlertSource;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  location: GeoPoint | null;
  confidence: number;
  metadata: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
}

export interface RiskPrediction {
  risk_level: "low" | "medium" | "high" | "critical";
  risk_score: number;
  class_probabilities: Record<string, number>;
}
