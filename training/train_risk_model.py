"""
Trains the Risk Prediction RandomForestClassifier.

Default mode (no --csv): generates a realistic synthetic dataset encoding
domain knowledge about situational risk (night hours, low light, nearby
crime density, severe weather, and repeat-alert history all push risk up)
so the shipped model behaves sensibly out of the box.

Real-world usage: export rows from the `incidents` / `crime_reports` /
`alerts` collections into a CSV with these columns and pass --csv:

hour_of_day,is_weekend,nearby_crime_count,motion_level,noise_level_db,
light_level_lux,weather_severity,previous_alerts_30d,risk_level

risk_level must be one of: low, medium, high, critical
"""
import argparse
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
from app.ai.risk_predictor import FEATURE_NAMES, RISK_LABELS  # noqa: E402

MODEL_DIR = Path(__file__).resolve().parent.parent / "saved_models" / "risk_prediction"
MODEL_DIR.mkdir(parents=True, exist_ok=True)


def synthesize_dataset(n_rows: int, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    hour = rng.integers(0, 24, n_rows)
    is_weekend = rng.integers(0, 2, n_rows)
    nearby_crime = rng.poisson(4, n_rows)
    motion = rng.uniform(0, 1, n_rows)
    noise_db = rng.normal(55, 15, n_rows).clip(20, 100)
    light_lux = rng.exponential(80, n_rows).clip(0, 500)
    weather = rng.integers(0, 4, n_rows)
    prev_alerts = rng.poisson(0.5, n_rows)

    risk_score = (
        0.35 * ((hour >= 22) | (hour <= 4)).astype(float)
        + 0.30 * np.clip(nearby_crime / 15, 0, 1)
        + 0.20 * (1 - np.clip(light_lux / 100, 0, 1))
        + 0.10 * (weather / 3)
        + 0.15 * np.clip(prev_alerts / 4, 0, 1)
        + rng.normal(0, 0.05, n_rows)
    )
    risk_score = np.clip(risk_score, 0, 1.2)

    bins = [-np.inf, 0.28, 0.55, 0.8, np.inf]
    labels = pd.cut(risk_score, bins=bins, labels=RISK_LABELS)

    return pd.DataFrame({
        "hour_of_day": hour,
        "is_weekend": is_weekend,
        "nearby_crime_count": nearby_crime,
        "motion_level": motion,
        "noise_level_db": noise_db,
        "light_level_lux": light_lux,
        "weather_severity": weather,
        "previous_alerts_30d": prev_alerts,
        "risk_level": labels.astype(str),
    })


def main():
    parser = argparse.ArgumentParser(description="Train the risk prediction model")
    parser.add_argument("--csv", type=str, default=None, help="Path to real labeled CSV. Omit for synthetic data.")
    parser.add_argument("--n-rows", type=int, default=6000, help="Rows to synthesize if --csv is omitted")
    parser.add_argument("--n-estimators", type=int, default=300)
    parser.add_argument("--max-depth", type=int, default=12)
    args = parser.parse_args()

    if args.csv:
        df = pd.read_csv(args.csv)
        print(f"Loaded {len(df)} labeled rows from {args.csv}")
    else:
        df = synthesize_dataset(args.n_rows)
        print(f"Using {len(df)} synthetic rows (no --csv given)")

    X = df[FEATURE_NAMES]
    y = df["risk_level"]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    clf = RandomForestClassifier(
        n_estimators=args.n_estimators,
        max_depth=args.max_depth,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    clf.fit(X_train, y_train)

    preds = clf.predict(X_test)
    print(classification_report(y_test, preds))

    out_path = MODEL_DIR / "risk_model.joblib"
    joblib.dump(clf, out_path)
    print(f"Saved model to {out_path}")


if __name__ == "__main__":
    main()
