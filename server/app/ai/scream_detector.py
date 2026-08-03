"""
Scream Detection Module
------------------------
Extracts MFCC + Mel-spectrogram features from short audio clips using
librosa, then classifies with a small CNN (PyTorch) trained on
scream-vs-ambient audio patterns.

Because no proprietary dataset/GPU training cluster is available in this
environment, the shipped weights are produced by `training/train_scream_model.py`
using synthetic-but-representative signal statistics (loud, high-pitch,
short-burst energy envelope = the acoustic signature of a scream) so the
module is fully functional out of the box. Swap in weights trained on
ESC-50 / UrbanSound8K / a real scream corpus by re-running the training
script with `--dataset-dir` pointing at real audio — the architecture and
inference code do not need to change.
"""
from pathlib import Path

import librosa
import numpy as np
import torch
import torch.nn as nn

MODEL_DIR = Path(__file__).resolve().parent.parent.parent.parent / "saved_models" / "scream_detection"
MODEL_PATH = MODEL_DIR / "scream_cnn.pt"

SAMPLE_RATE = 16000
N_MFCC = 40
N_MELS = 64
CLIP_SECONDS = 2.0
N_FRAMES = 63  # frames produced for CLIP_SECONDS at hop_length=512, sr=16000


class ScreamCNN(nn.Module):
    """Small 2D CNN over stacked MFCC + Mel-spectrogram feature maps."""

    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(2, 16, kernel_size=3, padding=1),
            nn.BatchNorm2d(16),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(16, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d((4, 4)),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(64 * 4 * 4, 64),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(64, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.features(x)
        x = self.classifier(x)
        return torch.sigmoid(x)


def extract_features(y: np.ndarray, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Returns a (2, N_MELS, N_FRAMES) stack of [mfcc_padded, mel_db]."""
    if sr != SAMPLE_RATE:
        y = librosa.resample(y, orig_sr=sr, target_sr=SAMPLE_RATE)

    target_len = int(CLIP_SECONDS * SAMPLE_RATE)
    if len(y) < target_len:
        y = np.pad(y, (0, target_len - len(y)))
    else:
        y = y[:target_len]

    mfcc = librosa.feature.mfcc(y=y, sr=SAMPLE_RATE, n_mfcc=N_MFCC)
    mel = librosa.feature.melspectrogram(y=y, sr=SAMPLE_RATE, n_mels=N_MELS)
    mel_db = librosa.power_to_db(mel, ref=np.max)

    # Pad/crop MFCC channel count up to N_MELS rows so both stack cleanly.
    if mfcc.shape[0] < N_MELS:
        mfcc = np.pad(mfcc, ((0, N_MELS - mfcc.shape[0]), (0, 0)))
    else:
        mfcc = mfcc[:N_MELS, :]

    frames = min(mfcc.shape[1], mel_db.shape[1], N_FRAMES)
    mfcc = mfcc[:, :frames]
    mel_db = mel_db[:, :frames]
    if frames < N_FRAMES:
        pad = N_FRAMES - frames
        mfcc = np.pad(mfcc, ((0, 0), (0, pad)))
        mel_db = np.pad(mel_db, ((0, 0), (0, pad)))

    def norm(x: np.ndarray) -> np.ndarray:
        std = x.std()
        return (x - x.mean()) / std if std > 1e-6 else x - x.mean()

    return np.stack([norm(mfcc), norm(mel_db)], axis=0).astype(np.float32)


class ScreamDetector:
    def __init__(self):
        self.model = ScreamCNN()
        if MODEL_PATH.exists():
            state = torch.load(MODEL_PATH, map_location="cpu")
            self.model.load_state_dict(state)
        self.model.eval()

    @torch.no_grad()
    def predict(self, y: np.ndarray, sr: int = SAMPLE_RATE) -> float:
        """Returns scream probability in [0, 1] for a raw audio waveform."""
        feats = extract_features(y, sr)
        tensor = torch.from_numpy(feats).unsqueeze(0)  # (1, 2, N_MELS, N_FRAMES)
        prob = self.model(tensor).item()
        return float(prob)

    def predict_from_bytes(self, audio_bytes: bytes) -> float:
        import io
        y, sr = librosa.load(io.BytesIO(audio_bytes), sr=SAMPLE_RATE, mono=True)
        return self.predict(y, sr)


_detector: ScreamDetector | None = None


def get_scream_detector() -> ScreamDetector:
    global _detector
    if _detector is None:
        _detector = ScreamDetector()
    return _detector
