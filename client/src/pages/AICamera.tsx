import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import api from "@/lib/api";
import { Camera, CameraOff, Hand, ScanEye, AlertTriangle, Mic, MicOff } from "lucide-react";
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

interface ScreamResult {
  scream_detected: boolean;
  scream_probability: number;
}

const DETECTION_INTERVAL_MS = 2500;

export default function AICamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const lastActiveSignalsAtRef = useRef(0);
  const alertSentForEpisodeRef = useRef(false);
  const [streaming, setStreaming] = useState(false);
  const [audioMonitoring, setAudioMonitoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gesture, setGesture] = useState<GestureResult | null>(null);
  const [objects, setObjects] = useState<ObjectResult | null>(null);
  const [scream, setScream] = useState<ScreamResult | null>(null);
  const [riskScore, setRiskScore] = useState<number | null>(null);
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
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
    setAudioMonitoring(false);
    setGesture(null);
    setObjects(null);
    setScream(null);
    setRiskScore(null);
    lastActiveSignalsAtRef.current = 0;
    alertSentForEpisodeRef.current = false;
  }, []);

  const toggleAudioMonitoring = useCallback(async () => {
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
      setAudioMonitoring(false);
      setScream(null);
      return;
    }
    try {
      audioStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      setAudioMonitoring(true);
      setError(null);
    } catch {
      setError("Couldn't access the microphone. Check your browser permissions and try again.");
    }
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

        let audioClip: Blob | null = null;
        const audioStream = audioStreamRef.current;
        if (audioStream) {
          try {
            audioClip = await recordAudioClip(audioStream);
            if (audioStreamRef.current !== audioStream) audioClip = null;
          } catch {
            setError("Audio capture failed; visual monitoring is continuing.");
          }
        }

        let screamResult: ScreamResult | null = null;
        if (audioClip) {
          try {
            const audioForm = new FormData();
            audioForm.append("file", audioClip, "audio-clip.webm");
            const screamRes = await api.post<ScreamResult>("/ai/scream", audioForm, {
              headers: { "Content-Type": "multipart/form-data" },
            });
            screamResult = screamRes.data;
          } catch {
            setError("Scream analysis is unavailable; visual monitoring is continuing.");
          }
        }

        setScream(screamResult);
        const gestureSignal = gestureRes.data.sos_detected ? gestureRes.data.confidence : 0;
        const screamSignal = screamResult?.scream_detected ? screamResult.scream_probability : 0;
        const weaponSignal = objectRes.data.threat_detected
          ? Math.max(...objectRes.data.detections.filter((item) => item.label === "knife").map((item) => item.confidence), 0.75)
          : 0;
        let fusedScore = 0.4 * gestureSignal + 0.35 * screamSignal + 0.25 * weaponSignal;
        const corroboratedGestureAndScream = gestureSignal >= 0.7 && screamSignal >= 0.65;
        if (corroboratedGestureAndScream) fusedScore = Math.max(fusedScore, 0.9);
        if (gestureSignal >= 0.7) fusedScore = Math.max(fusedScore, 0.7);
        if (weaponSignal > 0) fusedScore = Math.max(fusedScore, 0.75);
        fusedScore = Math.min(1, fusedScore);
        setRiskScore(fusedScore);

        const hasSignal = gestureSignal > 0 || screamSignal > 0 || weaponSignal > 0;
        const now = Date.now();
        if (hasSignal && now - lastActiveSignalsAtRef.current > 10_000) {
          alertSentForEpisodeRef.current = false;
        }
        if (hasSignal) lastActiveSignalsAtRef.current = now;

        if (fusedScore >= 0.7 && !alertSentForEpisodeRef.current) {
          await api.post("/alerts", {
            source: gestureSignal > 0 ? "gesture_detection" : screamSignal > 0 ? "scream_detection" : "object_detection",
            severity: corroboratedGestureAndScream ? "critical" : "high",
            message: corroboratedGestureAndScream
              ? "SOS confirmed by gesture and scream detection"
              : "Safety signal detected by AI Camera",
            confidence: fusedScore,
            metadata: {
              risk_score: fusedScore,
              gesture_confidence: gestureSignal,
              scream_probability: screamResult?.scream_probability ?? 0,
              weapon_detected: weaponSignal > 0,
            },
          });
          alertSentForEpisodeRef.current = true;
        }
        if (!hasSignal && now - lastActiveSignalsAtRef.current > 10_000) {
          alertSentForEpisodeRef.current = false;
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
            Gesture and object detection run on live frames every {DETECTION_INTERVAL_MS / 1000}s. With microphone access enabled, short audio clips are sent for server-side inference. Neither frames nor clips are stored by this workflow.
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
            <div className="flex items-center justify-between border-t border-white/[0.06] p-4">
              <p className="text-sm text-ink-400">
                {audioMonitoring
                  ? streaming ? "Microphone active — clips analyzed, not stored" : "Microphone enabled — analysis starts with the camera"
                  : "Scream detection is off"}
              </p>
              <button onClick={toggleAudioMonitoring} className="btn-ghost flex items-center gap-2">
                {audioMonitoring ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {audioMonitoring ? "Disable microphone" : "Enable microphone"}
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
                <AlertTriangle className="h-4 w-4 text-signal-400" />
                <h2 className="font-display text-base font-medium">Fused risk</h2>
              </div>
              <div className="space-y-2 text-sm">
                <Row label="Combined score" value={riskScore === null ? "Waiting" : `${Math.round(riskScore * 100)}%`} />
                <Row label="Scream detection" value={scream ? (scream.scream_detected ? "Detected" : "Not detected") : "Microphone off"} alert={scream?.scream_detected} />
                <p className="pt-1 text-xs text-ink-500">Gesture + scream corroboration raises the score to critical.</p>
              </div>
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

function recordAudioClip(stream: MediaStream): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    if (typeof MediaRecorder === "undefined") {
      resolve(null);
      return;
    }
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : undefined;
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start();
    const stopTimer = window.setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, 1800);
    recorder.onerror = () => {
      window.clearTimeout(stopTimer);
      reject(new Error("Audio recording failed"));
    };
    recorder.onstop = () => {
      window.clearTimeout(stopTimer);
      resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType }) : null);
    };
  });
}

function Row({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-400">{label}</span>
      <span className={clsx("font-mono", alert ? "text-alarm-400" : "text-ink-100")}>{value}</span>
    </div>
  );
}
