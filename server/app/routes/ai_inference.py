"""
AI inference endpoints. Each accepts raw media (image frame or audio clip)
or structured features and returns the model's prediction. These are the
endpoints the frontend's AI Camera / AI Voice pages call in real time.
"""
import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.ai.gesture_detector import get_gesture_detector
from app.ai.object_detector import get_object_detector
from app.ai.risk_predictor import RiskFeatures, get_risk_predictor
from app.ai.scream_detector import get_scream_detector
from app.config import get_settings
from app.core.deps import get_current_user

router = APIRouter(prefix="/api/ai", tags=["ai"])
settings = get_settings()


async def _read_image(file: UploadFile) -> np.ndarray:
    contents = await file.read()
    arr = np.frombuffer(contents, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not decode image")
    return frame


@router.post("/gesture")
async def detect_gesture(file: UploadFile = File(...), _: dict = Depends(get_current_user)):
    frame_bgr = await _read_image(file)
    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    detector = get_gesture_detector()
    result = detector.analyze(frame_rgb)
    return {
        "sos_detected": result.sos_detected,
        "confidence": result.confidence,
        "hands_found": result.hands_found,
        "details": result.details,
        "threshold": settings.GESTURE_CONFIDENCE_THRESHOLD,
    }


@router.post("/object-detection")
async def detect_objects(file: UploadFile = File(...), _: dict = Depends(get_current_user)):
    frame_bgr = await _read_image(file)
    detector = get_object_detector()
    result = detector.analyze(frame_bgr)
    return {
        "threat_detected": result.threat_detected,
        "crowd_count": result.crowd_count,
        "vehicles_nearby": result.vehicles_nearby,
        "detections": [d.__dict__ for d in result.detections],
        "details": result.details,
    }


@router.post("/scream")
async def detect_scream(file: UploadFile = File(...), _: dict = Depends(get_current_user)):
    audio_bytes = await file.read()
    detector = get_scream_detector()
    try:
        probability = detector.predict_from_bytes(audio_bytes)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Could not process audio: {exc}")
    return {
        "scream_probability": round(probability, 3),
        "scream_detected": probability >= settings.SCREAM_PROBABILITY_THRESHOLD,
        "threshold": settings.SCREAM_PROBABILITY_THRESHOLD,
    }


@router.post("/risk-prediction")
async def predict_risk(features: RiskFeatures, _: dict = Depends(get_current_user)):
    predictor = get_risk_predictor()
    prediction = predictor.predict(features)
    return {
        "risk_level": prediction.risk_level,
        "risk_score": prediction.risk_score,
        "class_probabilities": prediction.class_probabilities,
    }
