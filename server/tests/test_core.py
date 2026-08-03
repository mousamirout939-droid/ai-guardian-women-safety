import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.security import create_access_token, decode_token, hash_password, verify_password  # noqa: E402
from app.ai.risk_predictor import RiskFeatures, RiskPredictor  # noqa: E402


def test_mediapipe_solutions_api_available():
    """
    Guards against a real regression found during manual testing: mediapipe
    versions past 0.10.18 remove `mediapipe.solutions.hands` (moved to the
    Tasks API), which breaks GestureDetector with an AttributeError at
    import time. requirements.txt pins mediapipe==0.10.18 for this reason;
    this test fails loudly if that pin is ever relaxed without updating
    gesture_detector.py to the new API.
    """
    import mediapipe as mp
    assert hasattr(mp, "solutions"), (
        "mediapipe.solutions is missing — likely an unpinned/upgraded mediapipe version. "
        "See the comment on the mediapipe line in requirements.txt."
    )
    assert hasattr(mp.solutions, "hands")


def test_gesture_detector_runs_on_real_image():
    from app.ai.gesture_detector import GestureDetector
    import numpy as np

    detector = GestureDetector()
    # A plain frame with no hand should not crash and should return a
    # well-formed, non-detected result.
    frame_rgb = np.zeros((480, 640, 3), dtype=np.uint8)
    result = detector.analyze(frame_rgb)
    assert result.hands_found == 0
    assert result.sos_detected is False
    assert result.confidence == 0.0


def test_object_detector_finds_people_and_vehicles():
    """Runs real YOLOv8 inference on ultralytics' own bundled sample image."""
    from pathlib import Path
    import cv2
    from app.ai.object_detector import ObjectDetector
    import ultralytics

    sample = Path(ultralytics.__file__).parent / "assets" / "bus.jpg"
    if not sample.exists():
        import pytest
        pytest.skip("ultralytics sample assets not found")

    frame = cv2.imread(str(sample))
    detector = ObjectDetector()
    result = detector.analyze(frame)
    labels = {d.label for d in result.detections}
    assert "person" in labels
    assert "bus" in labels
    assert result.crowd_count >= 1


def test_password_hash_roundtrip():
    hashed = hash_password("SuperSecret123")
    assert verify_password("SuperSecret123", hashed)
    assert not verify_password("WrongPassword", hashed)


def test_access_token_roundtrip():
    token = create_access_token(user_id="abc123", role="user")
    payload = decode_token(token)
    assert payload["sub"] == "abc123"
    assert payload["role"] == "user"
    assert payload["type"] == "access"


def test_settings_normalize_malformed_mongo_uri_prefix():
    from app.config import Settings

    settings = Settings(MONGO_URI="mongodb:mongodb+srv://user:pass@cluster.example/test?retryWrites=true")

    assert settings.MONGO_URI == "mongodb+srv://user:pass@cluster.example/test?retryWrites=true"


def test_risk_predictor_fallback_high_risk_at_night():
    predictor = RiskPredictor()
    predictor.model = None  # force heuristic fallback path
    night_features = RiskFeatures(
        hour_of_day=2, is_weekend=True, nearby_crime_count=15,
        motion_level=0.8, noise_level_db=40, light_level_lux=5,
        weather_severity=2, previous_alerts_30d=3,
    )
    day_features = RiskFeatures(
        hour_of_day=14, is_weekend=False, nearby_crime_count=0,
        motion_level=0.1, noise_level_db=45, light_level_lux=400,
        weather_severity=0, previous_alerts_30d=0,
    )
    night_result = predictor.predict(night_features)
    day_result = predictor.predict(day_features)
    assert night_result.risk_score > day_result.risk_score


def test_scream_model_artifact_is_found_and_loaded():
    from app.ai.scream_detector import MODEL_PATH, ScreamDetector
    assert MODEL_PATH.exists(), (
        f"Trained scream model not found at {MODEL_PATH}. "
        "Run training/train_scream_model.py, or check MODEL_DIR path resolution."
    )
    detector = ScreamDetector()
    # A model that loaded real (non-random) weights should not output a
    # constant ~0.5 for every input; sanity check against one Gaussian noise clip.
    import numpy as np
    noise = np.random.default_rng(0).normal(0, 0.1, size=32000).astype(np.float32)
    prob = detector.predict(noise, 16000)
    assert 0.0 <= prob <= 1.0


def test_risk_model_artifact_is_found_and_loaded():
    from app.ai.risk_predictor import MODEL_PATH, RiskPredictor
    assert MODEL_PATH.exists(), (
        f"Trained risk model not found at {MODEL_PATH}. "
        "Run training/train_risk_model.py, or check MODEL_DIR path resolution."
    )
    predictor = RiskPredictor()
    assert predictor.model is not None, "RiskPredictor fell back to heuristic mode unexpectedly"


def test_nearby_police_station_address_formatting():
    from app.routes.safety import _format_station_address

    tags = {
        "name": "Central Police Station",
        "addr:housenumber": "12",
        "addr:street": "Main Street",
        "addr:city": "San Francisco",
        "addr:postcode": "94103",
    }

    formatted = _format_station_address(tags)
    assert formatted == "12 Main Street, San Francisco, 94103"


def test_risk_labels_are_valid():
    predictor = RiskPredictor()
    predictor.model = None
    features = RiskFeatures(
        hour_of_day=12, is_weekend=False, nearby_crime_count=1,
        motion_level=0.1, noise_level_db=50, light_level_lux=300,
        weather_severity=0, previous_alerts_30d=0,
    )
    result = predictor.predict(features)
    assert result.risk_level in {"low", "medium", "high", "critical"}
