import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import api from "@/lib/api";
import { Camera, CameraOff, Hand, ScanEye, AlertTriangle } from "lucide-react";
import clsx from "clsx";

interface GestureResult {
  sos_detected: boolean;
  confidence: number;
  hands_found: number;
}

interface ObjectResult {
  threat_detected: boolean;
  crowd_count: number;
  vehicles_nearby: number;
  detections: { label: string; confidence: number; box: number[] }[];
}

const DETECTION_INTERVAL_MS = 2500;

export default function AICamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gesture, setGesture] = useState<GestureResult | null>(null);
  const [objects, setObjects] = useState<ObjectResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreaming(true);
    } catch {
      setError("Couldn't access the camera. Check your browser permissions and try again.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    const stream = videoRef.current?.srcObject as MediaStream | undefined;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreaming(false);
    setGesture(null);
    setObjects(null);
  }, []);

  const captureFrame = useCallback((): Blob | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return null;
  }, []);

  const runDetection = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || analyzing) return;

    captureFrame();
    setAnalyzing(true);

    canvas.toBlob(async (blob) => {
      if (!blob) {
        setAnalyzing(false);
        return;
      }
      const formData = new FormData();
      formData.append("file", blob, "frame.jpg");

      try {
        const [gestureRes, objectRes] = await Promise.all([
          api.post<GestureResult>("/ai/gesture", formData, {
            headers: { "Content-Type": "multipart/form-data" },
          }),
          api.post<ObjectResult>("/ai/object-detection", formData, {
            headers: { "Content-Type": "multipart/form-data" },
          }),
        ]);
        setGesture(gestureRes.data);
        setObjects(objectRes.data);

        if (gestureRes.data.sos_detected) {
          await api.post("/alerts", {
            source: "gesture_detection",
            severity: "critical",
            message: "SOS hand gesture detected by AI Camera",
            confidence: gestureRes.data.confidence,
          });
        }
        if (objectRes.data.threat_detected) {
          await api.post("/alerts", {
            source: "object_detection",
            severity: "high",
            message: "Potential weapon detected in camera frame",
            confidence: 0.8,
          });
        }
      } catch {
        // Network hiccups shouldn't spam the user; next tick retries.
      } finally {
        setAnalyzing(false);
      }
    }, "image/jpeg", 0.85);
  }, [analyzing, captureFrame]);

  useEffect(() => {
    if (!streaming) return;
    const interval = setInterval(runDetection, DETECTION_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [streaming, runDetection]);

  useEffect(() => {
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-semibold tracking-tight">AI Camera</h1>
          <p className="mt-1 text-ink-400">
            Gesture and object detection run on live frames every {DETECTION_INTERVAL_MS / 1000}s. Nothing is recorded — frames are analyzed and discarded.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="glass-panel overflow-hidden rounded-2xl lg:col-span-2">
            <div className="relative aspect-video bg-night-950">
              <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
              <canvas ref={canvasRef} className="hidden" />
              {!streaming && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ink-500">
                  <Camera className="h-10 w-10" />
                  <p className="text-sm">Camera is off</p>
                </div>
              )}
              {analyzing && (
                <div className="absolute right-3 top-3 flex items-center gap-2 rounded-full bg-night-950/80 px-3 py-1.5 font-mono text-xs text-signal-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal-400" />
                  Analyzing
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-white/[0.06] p-4">
              <p className="text-sm text-ink-400">
                {streaming ? "Live — camera active" : "Start the camera to begin monitoring"}
              </p>
              <button
                onClick={streaming ? stopCamera : startCamera}
                className={streaming ? "btn-ghost flex items-center gap-2" : "btn-beacon flex items-center gap-2"}
              >
                {streaming ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                {streaming ? "Stop camera" : "Start camera"}
              </button>
            </div>
          </div>

          <div className="space-y-6">
            <div className="glass-panel rounded-2xl p-6">
              <div className="mb-3 flex items-center gap-2">
                <Hand className="h-4 w-4 text-signal-400" />
                <h2 className="font-display text-base font-medium">Gesture detection</h2>
              </div>
              {gesture ? (
                <div className="space-y-2 text-sm">
                  <Row label="Hands found" value={String(gesture.hands_found)} />
                  <Row label="Confidence" value={`${Math.round(gesture.confidence * 100)}%`} />
                  <Row
                    label="SOS gesture"
                    value={gesture.sos_detected ? "Detected" : "Not detected"}
                    alert={gesture.sos_detected}
                  />
                </div>
              ) : (
                <p className="text-sm text-ink-500">Waiting for first frame…</p>
              )}
            </div>

            <div className="glass-panel rounded-2xl p-6">
              <div className="mb-3 flex items-center gap-2">
                <ScanEye className="h-4 w-4 text-signal-400" />
                <h2 className="font-display text-base font-medium">Object detection</h2>
              </div>
              {objects ? (
                <div className="space-y-2 text-sm">
                  <Row label="People in frame" value={String(objects.crowd_count)} />
                  <Row label="Vehicles nearby" value={String(objects.vehicles_nearby)} />
                  <Row
                    label="Threat objects"
                    value={objects.threat_detected ? "Detected" : "None"}
                    alert={objects.threat_detected}
                  />
                </div>
              ) : (
                <p className="text-sm text-ink-500">Waiting for first frame…</p>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-alarm-500/20 bg-alarm-500/10 p-4 text-sm text-alarm-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-400">{label}</span>
      <span className={clsx("font-mono", alert ? "text-alarm-400" : "text-ink-100")}>{value}</span>
    </div>
  );
}
