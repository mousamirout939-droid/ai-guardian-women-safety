"""
Bootstraps working weights for the Scream Detection module.

Real-world usage: point --dataset-dir at a folder with two subfolders,
`scream/` and `ambient/`, each containing .wav clips (e.g. curated from
ESC-50 + UrbanSound8K + a scream corpus) and this script will train on
real audio using the same feature pipeline as inference
(app.ai.scream_detector.extract_features).

Default mode (no --dataset-dir): synthesizes labeled training examples
from signal statistics that define a scream acoustically -- high
fundamental frequency (300-1200 Hz), sharp attack, high RMS energy,
short burst duration -- versus ambient/office/traffic noise beds. This
lets the shipped model produce sane, non-random probabilities immediately.
Re-run with real data any time to improve accuracy; the architecture and
inference code require no changes.
"""
import argparse
from pathlib import Path

import librosa
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset, random_split

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
from app.ai.scream_detector import ScreamCNN, extract_features, SAMPLE_RATE, CLIP_SECONDS  # noqa: E402

MODEL_DIR = Path(__file__).resolve().parent.parent / "saved_models" / "scream_detection"
MODEL_DIR.mkdir(parents=True, exist_ok=True)


def synth_scream(duration: float, sr: int, rng: np.random.Generator) -> np.ndarray:
    t = np.linspace(0, duration, int(duration * sr), endpoint=False)
    f0 = rng.uniform(300, 1100)
    vibrato = 20 * np.sin(2 * np.pi * 6 * t)
    signal = np.sin(2 * np.pi * (f0 + vibrato) * t)
    signal += 0.5 * np.sin(2 * np.pi * (f0 * 2) * t)
    envelope = np.clip(np.sin(np.pi * t / duration), 0.05, 1.0) ** 0.5
    signal = signal * envelope
    signal += rng.normal(0, 0.05, size=signal.shape)
    signal = signal / (np.max(np.abs(signal)) + 1e-6) * rng.uniform(0.7, 0.95)
    return signal.astype(np.float32)


def synth_ambient(duration: float, sr: int, rng: np.random.Generator) -> np.ndarray:
    t = np.linspace(0, duration, int(duration * sr), endpoint=False)
    kind = rng.choice(["hum", "traffic", "chatter"])
    if kind == "hum":
        signal = 0.2 * np.sin(2 * np.pi * rng.uniform(50, 120) * t)
    elif kind == "traffic":
        signal = rng.normal(0, 0.15, size=t.shape)
        signal = np.convolve(signal, np.ones(50) / 50, mode="same")
    else:
        signal = np.zeros_like(t)
        for _ in range(rng.integers(2, 5)):
            f0 = rng.uniform(100, 300)
            signal += 0.1 * np.sin(2 * np.pi * f0 * t + rng.uniform(0, 6))
    signal += rng.normal(0, 0.03, size=signal.shape)
    peak = np.max(np.abs(signal))
    if peak > 1e-6:
        signal = signal / peak * rng.uniform(0.2, 0.5)
    return signal.astype(np.float32)


class SyntheticScreamDataset(Dataset):
    def __init__(self, n_samples: int = 800, seed: int = 42):
        rng = np.random.default_rng(seed)
        self.items: list[tuple[np.ndarray, float]] = []
        for _ in range(n_samples // 2):
            self.items.append((synth_scream(CLIP_SECONDS, SAMPLE_RATE, rng), 1.0))
            self.items.append((synth_ambient(CLIP_SECONDS, SAMPLE_RATE, rng), 0.0))

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, idx: int):
        y, label = self.items[idx]
        feats = extract_features(y, SAMPLE_RATE)
        return torch.from_numpy(feats), torch.tensor([label], dtype=torch.float32)


class WavFolderDataset(Dataset):
    """Loads real audio from --dataset-dir/{scream,ambient}/*.wav"""

    def __init__(self, dataset_dir: Path):
        self.samples: list[tuple[Path, float]] = []
        for label_name, label in (("scream", 1.0), ("ambient", 0.0)):
            folder = dataset_dir / label_name
            if not folder.exists():
                continue
            for wav_path in folder.glob("*.wav"):
                self.samples.append((wav_path, label))

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int):
        path, label = self.samples[idx]
        y, sr = librosa.load(str(path), sr=SAMPLE_RATE, mono=True)
        feats = extract_features(y, sr)
        return torch.from_numpy(feats), torch.tensor([label], dtype=torch.float32)


def train(dataset: Dataset, epochs: int, batch_size: int, lr: float) -> ScreamCNN:
    n_val = max(1, int(0.15 * len(dataset)))
    n_train = len(dataset) - n_val
    train_ds, val_ds = random_split(dataset, [n_train, n_val])
    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=batch_size)

    model = ScreamCNN()
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    criterion = nn.BCELoss()

    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0
        for xb, yb in train_loader:
            optimizer.zero_grad()
            preds = model(xb)
            loss = criterion(preds, yb)
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * xb.size(0)

        model.eval()
        correct, total = 0, 0
        with torch.no_grad():
            for xb, yb in val_loader:
                preds = model(xb)
                correct += ((preds > 0.5).float() == yb).sum().item()
                total += yb.size(0)
        val_acc = correct / total if total else 0.0
        print(f"Epoch {epoch}/{epochs} - train_loss={total_loss / n_train:.4f} - val_acc={val_acc:.3f}")

    return model


def main():
    parser = argparse.ArgumentParser(description="Train the scream detection CNN")
    parser.add_argument("--dataset-dir", type=str, default=None,
                         help="Folder with scream/ and ambient/ .wav subfolders. Omit to use synthetic data.")
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--n-samples", type=int, default=800, help="Only used for synthetic data")
    args = parser.parse_args()

    if args.dataset_dir:
        dataset = WavFolderDataset(Path(args.dataset_dir))
        if len(dataset) == 0:
            raise SystemExit(f"No .wav files found under {args.dataset_dir}/scream or /ambient")
        print(f"Loaded {len(dataset)} real audio samples from {args.dataset_dir}")
    else:
        dataset = SyntheticScreamDataset(n_samples=args.n_samples)
        print(f"Using {len(dataset)} synthetic samples (no --dataset-dir given)")

    model = train(dataset, args.epochs, args.batch_size, args.lr)

    out_path = MODEL_DIR / "scream_cnn.pt"
    torch.save(model.state_dict(), out_path)
    print(f"Saved weights to {out_path}")


if __name__ == "__main__":
    main()
