"""
Risk Prediction Module
------------------------
Predicts a situational risk score (low / medium / high / critical) from
contextual features: time of day, location density of past incidents,
motion level, ambient noise level, weather, ambient light level, and the
user's own recent alert history.

Uses a scikit-learn RandomForestClassifier. Ships with weights trained by
`training/train_risk_model.py` on a realistic synthetic distribution
(risk rises at night, in poorly-lit areas, near historical incident
hotspots, and during low-visibility weather) so the endpoint is fully
functional immediately. Retrain on real incident-report data (from the
`incidents` and `crime_reports` collections) by pointing the training
script at an exported CSV -- the feature schema below is the contract
both sides share.
"""
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

MODEL_DIR = Path(__file__).resolve().parent.parent.parent.parent / "saved_models" / "risk_prediction"
MODEL_PATH = MODEL_DIR / "risk_model.joblib"

FEATURE_NAMES = [
    "hour_of_day",       # 0-23
    "is_weekend",        # 0/1
    "nearby_crime_count", # count of reported incidents within radius, last 90 days
    "motion_level",       # 0-1 normalized accelerometer/video motion energy
    "noise_level_db",     # ambient dB
    "light_level_lux",    # ambient light in lux
    "weather_severity",   # 0 (clear) - 3 (severe: storm/fog)
    "previous_alerts_30d",# user's own alert count in the last 30 days
]

RISK_LABELS = ["low", "medium", "high", "critical"]


@dataclass
class RiskFeatures:
    hour_of_day: int
    is_weekend: bool
    nearby_crime_count: int
    motion_level: float
    noise_level_db: float
    light_level_lux: float
    weather_severity: int
    previous_alerts_30d: int

    def to_vector(self) -> np.ndarray:
        return np.array([[
            self.hour_of_day,
            int(self.is_weekend),
            self.nearby_crime_count,
            self.motion_level,
            self.noise_level_db,
            self.light_level_lux,
            self.weather_severity,
            self.previous_alerts_30d,
        ]], dtype=np.float32)

    def to_dataframe(self) -> "pd.DataFrame":
        return pd.DataFrame([{
            "hour_of_day": self.hour_of_day,
            "is_weekend": int(self.is_weekend),
            "nearby_crime_count": self.nearby_crime_count,
            "motion_level": self.motion_level,
            "noise_level_db": self.noise_level_db,
            "light_level_lux": self.light_level_lux,
            "weather_severity": self.weather_severity,
            "previous_alerts_30d": self.previous_alerts_30d,
        }])


@dataclass
class RiskPrediction:
    risk_level: str
    risk_score: float  # 0-1 probability-weighted score
    class_probabilities: dict[str, float]


class RiskPredictor:
    def __init__(self):
        if MODEL_PATH.exists():
            self.model = joblib.load(MODEL_PATH)
        else:
            self.model = None

    def predict(self, features: RiskFeatures) -> RiskPrediction:
        if self.model is None:
            return self._heuristic_fallback(features)

        x = features.to_dataframe()
        proba = self.model.predict_proba(x)[0]
        class_order = list(self.model.classes_)
        probs = {label: float(proba[class_order.index(label)]) if label in class_order else 0.0
                 for label in RISK_LABELS}
        top_label = max(probs, key=probs.get)
        weighted_score = sum(probs[label] * (i / (len(RISK_LABELS) - 1)) for i, label in enumerate(RISK_LABELS))
        return RiskPrediction(risk_level=top_label, risk_score=round(weighted_score, 3),
                               class_probabilities={k: round(v, 3) for k, v in probs.items()})

    @staticmethod
    def _heuristic_fallback(features: RiskFeatures) -> RiskPrediction:
        """Used only if no trained model file is present yet."""
        score = 0.0
        if features.hour_of_day >= 22 or features.hour_of_day <= 4:
            score += 0.3
        score += min(features.nearby_crime_count / 20, 0.3)
        score += (1 - min(features.light_level_lux / 100, 1)) * 0.2
        score += features.weather_severity / 3 * 0.1
        score += min(features.previous_alerts_30d / 5, 0.1)
        score = min(score, 1.0)
        if score < 0.25:
            level = "low"
        elif score < 0.5:
            level = "medium"
        elif score < 0.75:
            level = "high"
        else:
            level = "critical"
        return RiskPrediction(risk_level=level, risk_score=round(score, 3),
                               class_probabilities={level: round(score, 3)})


_predictor: RiskPredictor | None = None


def get_risk_predictor() -> RiskPredictor:
    global _predictor
    if _predictor is None:
        _predictor = RiskPredictor()
    return _predictor
