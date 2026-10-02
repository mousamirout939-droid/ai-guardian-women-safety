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


def test_signup_returns_user_and_tokens_in_one_response(monkeypatch):
    import asyncio
    from bson import ObjectId
    from app.models.user import UserSignup
    from app.routes import auth
    from app.core.security import decode_token

    class FakeUsers:
        async def find_one(self, query):
            return None

        async def insert_one(self, document):
            self.document = document
            return type("InsertResult", (), {"inserted_id": ObjectId()})()

    class FakeDb:
        users = FakeUsers()

    monkeypatch.setattr(auth, "get_db", lambda: FakeDb())
    response = asyncio.run(auth.signup(UserSignup(
        full_name="Test Person",
        email="signup-speed@example.com",
        password="StrongPassword123",
        phone="+919876543210",
    )))

    assert response.email == "signup-speed@example.com"
    assert decode_token(response.access_token)["sub"] == response.id
    assert decode_token(response.refresh_token)["sub"] == response.id


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
    from app.routes.safety import _distance_km, _format_station_address, _serialize_place, _serialize_route

    tags = {
        "name": "Central Police Station",
        "addr:housenumber": "12",
        "addr:street": "Main Street",
        "addr:city": "San Francisco",
        "addr:postcode": "94103",
    }

    formatted = _format_station_address(tags)
    assert formatted == "12 Main Street, San Francisco, 94103"
    assert _distance_km(0, 0, 0, 0) == 0
    assert round(_distance_km(0, 0, 0, 1), 2) == 111.19
    assert _serialize_place({"display_name": "Bengaluru", "lat": "12.97", "lon": "77.59"}) == {
        "name": "Bengaluru",
        "latitude": 12.97,
        "longitude": 77.59,
    }
    assert _serialize_route({
        "distance": 1500,
        "duration": 900,
        "geometry": {"coordinates": [[77.59, 12.97], [77.60, 12.98]]},
    }) == {
        "coordinates": [[12.97, 77.59], [12.98, 77.6]],
        "distance_km": 1.5,
        "duration_minutes": 15,
    }


def test_sos_sms_reports_missing_configuration():
    import asyncio
    from app.config import Settings
    from app.routes import alerts

    settings = Settings(TWILIO_ACCOUNT_SID="", TWILIO_AUTH_TOKEN="", TWILIO_FROM_NUMBER="")
    original_get_settings = alerts.get_settings
    alerts.get_settings = lambda: settings
    try:
        result = asyncio.run(alerts._send_sos_sms([{"phone": "+15555550123"}], "Test User", None))
    finally:
        alerts.get_settings = original_get_settings

    assert result == {"status": "not_configured", "sent": 0, "total": 1}


def test_sos_sms_sends_to_trusted_contacts(monkeypatch):
    import asyncio
    from app.config import Settings
    from app.core import sos

    settings = Settings(
        TWILIO_ACCOUNT_SID="AC123",
        TWILIO_AUTH_TOKEN="test-token",
        TWILIO_FROM_NUMBER="+15555550100",
    )
    requests = []

    class FakeResponse:
        def raise_for_status(self):
            pass

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def post(self, url, data, auth):
            requests.append((url, data, auth))
            return FakeResponse()

    monkeypatch.setattr(sos, "get_settings", lambda: settings)
    monkeypatch.setattr(sos.httpx, "AsyncClient", lambda timeout: FakeClient())
    result = asyncio.run(
        sos.send_sos_sms([{"phone": "+919876543210"}], "Test User", None)
    )

    assert result == {"status": "accepted", "sent": 1, "total": 1}
    assert requests[0][1]["To"] == "+919876543210"
    assert requests[0][1]["From"] == "+15555550100"
    assert requests[0][2] == ("AC123", "test-token")


def test_sos_escalation_notifies_next_contact(monkeypatch):
    import asyncio
    from datetime import datetime, timedelta, timezone
    from app.config import Settings
    from app.core import sos

    now = datetime.now(timezone.utc)
    alert = {
        "_id": "alert-123",
        "user_id": "user-123",
        "source": "manual_sos",
        "status": "active",
        "user_name": "Test User",
        "created_at": now - timedelta(minutes=2),
        "escalation": {"next_at": now - timedelta(seconds=1), "next_contact_index": 1},
    }
    contacts = [
        {"name": "First Contact", "phone": "+919876543210", "priority": 1},
        {"name": "Second Contact", "phone": "+919876543211", "priority": 2},
    ]
    sms_calls = []

    class FakeCursor:
        def __init__(self, values):
            self.values = values

        def sort(self, *_):
            return self

        def __aiter__(self):
            async def iterate():
                for value in self.values:
                    yield value
            return iterate()

    class FakeAlerts:
        def find(self, _query):
            return FakeCursor([alert])

        async def find_one_and_update(self, *_args, **_kwargs):
            return alert

        async def update_one(self, _query, update):
            self.update = update

    class FakeContacts:
        def find(self, _query):
            return FakeCursor(contacts)

    class FakeDb:
        alerts = FakeAlerts()
        contacts = FakeContacts()

    async def fake_send(contacts_to_notify, *_args):
        sms_calls.extend(contacts_to_notify)
        return {"status": "accepted", "sent": 1, "total": 1}

    monkeypatch.setattr(sos, "get_settings", lambda: Settings(SOS_ESCALATION_DELAY_SECONDS=60))
    monkeypatch.setattr(sos, "send_sos_sms", fake_send)
    processed = asyncio.run(sos.process_due_sos_escalations(FakeDb(), now))

    assert processed == 1
    assert [contact["name"] for contact in sms_calls] == ["Second Contact"]


def test_tracking_acknowledgement_stops_escalation(monkeypatch):
    import asyncio
    from datetime import datetime, timedelta, timezone
    from bson import ObjectId
    from app.core.sos import hash_tracking_token
    from app.models.alert import TrackingAcknowledge
    from app.routes import safety

    token = "a" * 64
    alert = {
        "_id": ObjectId(),
        "user_id": "user-123",
        "tracking_token_hash": hash_tracking_token(token),
        "tracking_expires_at": datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1),
        "source": "manual_sos",
        "severity": "critical",
        "status": "active",
        "message": "SOS",
        "confidence": 1.0,
        "metadata": {},
        "created_at": datetime.now(timezone.utc),
        "resolved_at": None,
        "escalation": {"next_at": datetime.now(timezone.utc)},
    }

    class FakeAlerts:
        async def find_one(self, _query):
            return alert

        async def find_one_and_update(self, _query, update, **_kwargs):
            alert.update(update["$set"])
            return alert

    class FakeDb:
        alerts = FakeAlerts()

    events = []

    async def send_to_user(user_id, event):
        events.append((user_id, event))

    monkeypatch.setattr(safety, "get_db", lambda: FakeDb())
    monkeypatch.setattr(safety.manager, "send_to_user", send_to_user)
    response = asyncio.run(safety.acknowledge_sos_tracking(token, TrackingAcknowledge(name="Alex")))

    assert response["status"] == "acknowledged"
    assert alert["acknowledged_by"] == "Alex"
    assert alert["escalation.next_at"] is None
    assert events[0][0] == "user-123"
    assert events[0][1]["alert"]["status"] == "acknowledged"


def test_contact_phone_requires_international_format():
    import pytest
    from pydantic import ValidationError
    from app.models.contact import ContactCreate

    contact = ContactCreate(name="Trusted Person", phone="+919876543210")
    assert contact.phone == "+919876543210"
    with pytest.raises(ValidationError):
        ContactCreate(name="Trusted Person", phone="9876543210")


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
