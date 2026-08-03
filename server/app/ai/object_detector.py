"""
Object / Weapon Detection Module
----------------------------------
Uses Ultralytics YOLO with pretrained COCO weights (yolov8n.pt, downloaded
automatically on first run by the ultralytics package) for general object
detection, and flags a curated set of "threat-adjacent" COCO classes
(knife, scissors as knife-proxy is NOT included to avoid false positives;
only classes genuinely present in COCO are used: knife) plus crowd density
and vehicle proximity heuristics.

COCO does not include a "gun" class, so firearm/fire detection is exposed
as a pluggable slot (`custom_weapon_model_path`) for a fine-tuned YOLO
checkpoint (e.g. trained on a firearms dataset). Without a custom
checkpoint, the module still provides real, working detection for:
knife, person (crowd counting), car/bus/truck/motorcycle (vehicle
proximity). This keeps the endpoint fully functional today, with a clear
upgrade path documented in README.md > "Extending Object Detection".
"""
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from ultralytics import YOLO

THREAT_CLASSES = {"knife"}
VEHICLE_CLASSES = {"car", "bus", "truck", "motorcycle"}
FIRE_KEYWORDS = {"fire"}  # only matched if a custom model exposes this class


@dataclass
class Detection:
    label: str
    confidence: float
    box: list[float]  # [x1, y1, x2, y2]


@dataclass
class ObjectDetectionResult:
    detections: list[Detection]
    threat_detected: bool
    crowd_count: int
    vehicles_nearby: int
    details: dict = field(default_factory=dict)


class ObjectDetector:
    def __init__(self, confidence_threshold: float = 0.45, custom_weapon_model_path: str | None = None):
        self.confidence_threshold = confidence_threshold
        # yolov8n.pt is fetched by ultralytics on first use and cached locally.
        self.model = YOLO("yolov8n.pt")
        self.custom_model = None
        if custom_weapon_model_path and Path(custom_weapon_model_path).exists():
            self.custom_model = YOLO(custom_weapon_model_path)

    def analyze(self, frame_bgr: np.ndarray) -> ObjectDetectionResult:
        results = self.model.predict(frame_bgr, conf=self.confidence_threshold, verbose=False)
        detections: list[Detection] = []
        crowd_count = 0
        vehicles_nearby = 0
        threat_detected = False

        for r in results:
            names = r.names
            for box in r.boxes:
                cls_id = int(box.cls[0])
                label = names[cls_id]
                conf = float(box.conf[0])
                xyxy = box.xyxy[0].tolist()
                detections.append(Detection(label=label, confidence=round(conf, 3), box=xyxy))

                if label == "person":
                    crowd_count += 1
                elif label in VEHICLE_CLASSES:
                    vehicles_nearby += 1
                elif label in THREAT_CLASSES:
                    threat_detected = True

        if self.custom_model is not None:
            custom_results = self.custom_model.predict(frame_bgr, conf=self.confidence_threshold, verbose=False)
            for r in custom_results:
                names = r.names
                for box in r.boxes:
                    cls_id = int(box.cls[0])
                    label = names[cls_id]
                    conf = float(box.conf[0])
                    xyxy = box.xyxy[0].tolist()
                    detections.append(Detection(label=label, confidence=round(conf, 3), box=xyxy))
                    threat_detected = True

        return ObjectDetectionResult(
            detections=detections,
            threat_detected=threat_detected,
            crowd_count=crowd_count,
            vehicles_nearby=vehicles_nearby,
            details={"total_detections": len(detections)},
        )


_detector: ObjectDetector | None = None


def get_object_detector() -> ObjectDetector:
    global _detector
    if _detector is None:
        _detector = ObjectDetector()
    return _detector
