"""
Gesture Recognition Module
---------------------------
Detects an emergency "SOS gesture": an open palm held up with all five
fingers extended and the wrist above the shoulder/eye line (raised hand),
held toward the camera. This mirrors the real-world "Signal for Help"
hand gesture used in personal-safety awareness campaigns.

Uses MediaPipe Hands (pretrained, no custom training required) to extract
21 hand landmarks, then applies simple, explainable geometric rules to
score the gesture. This is intentionally rule-based rather than a black
box CNN, because it needs zero training data and is fast/robust on-device.
"""
from dataclasses import dataclass, field

import mediapipe as mp
import numpy as np

try:
    mp_hands = mp.solutions.hands
except AttributeError:
    mp_hands = None


@dataclass
class GestureResult:
    sos_detected: bool
    confidence: float
    hands_found: int
    details: dict = field(default_factory=dict)


class GestureDetector:
    def __init__(self, min_detection_confidence: float = 0.6, min_tracking_confidence: float = 0.5):
        if mp_hands is None:
            self._hands = None
        else:
            self._hands = mp_hands.Hands(
                static_image_mode=True,
                max_num_hands=2,
                min_detection_confidence=min_detection_confidence,
                min_tracking_confidence=min_tracking_confidence,
            )

    @staticmethod
    def _finger_extended(landmarks, tip_idx: int, pip_idx: int, mcp_idx: int) -> bool:
        # A finger counts as "extended" if the tip is farther from the wrist
        # than the pip joint (works regardless of hand orientation).
        wrist = np.array([landmarks[0].x, landmarks[0].y])
        tip = np.array([landmarks[tip_idx].x, landmarks[tip_idx].y])
        pip = np.array([landmarks[pip_idx].x, landmarks[pip_idx].y])
        return np.linalg.norm(tip - wrist) > np.linalg.norm(pip - wrist)

    @staticmethod
    def _thumb_tucked(landmarks) -> bool:
        # The Signal for Help gesture tucks the thumb across the palm.
        thumb_tip = np.array([landmarks[4].x, landmarks[4].y])
        index_mcp = np.array([landmarks[5].x, landmarks[5].y])
        pinky_mcp = np.array([landmarks[17].x, landmarks[17].y])
        return np.linalg.norm(thumb_tip - index_mcp) < np.linalg.norm(pinky_mcp - index_mcp)

    def analyze(self, frame_rgb: np.ndarray) -> GestureResult:
        if self._hands is None:
            return GestureResult(
                sos_detected=False,
                confidence=0.0,
                hands_found=0,
                details={"gesture_detection": "unavailable on this MediaPipe build"},
            )

        result = self._hands.process(frame_rgb)
        if not result.multi_hand_landmarks:
            return GestureResult(sos_detected=False, confidence=0.0, hands_found=0)

        best_score = 0.0
        best_details: dict = {}
        for hand_landmarks in result.multi_hand_landmarks:
            lm = hand_landmarks.landmark
            fingers = {
                "index": self._finger_extended(lm, 8, 6, 5),
                "middle": self._finger_extended(lm, 12, 10, 9),
                "ring": self._finger_extended(lm, 16, 14, 13),
                "pinky": self._finger_extended(lm, 20, 18, 17),
            }
            extended_count = sum(fingers.values())
            thumb_tucked = self._thumb_tucked(lm)
            wrist_y = lm[0].y  # smaller y == higher in frame (raised hand)

            score = 0.0
            score += 0.15 * extended_count  # up to 0.6 for 4 fingers extended
            score += 0.25 if thumb_tucked else 0.0
            score += 0.15 if wrist_y < 0.6 else 0.0  # hand raised in upper part of frame
            score = min(score, 1.0)

            if score > best_score:
                best_score = score
                best_details = {
                    "fingers_extended": extended_count,
                    "thumb_tucked": thumb_tucked,
                    "hand_raised": wrist_y < 0.6,
                }

        return GestureResult(
            sos_detected=best_score >= 0.7,
            confidence=round(best_score, 3),
            hands_found=len(result.multi_hand_landmarks),
            details=best_details,
        )

    def close(self) -> None:
        if self._hands is not None:
            self._hands.close()


_detector: GestureDetector | None = None


def get_gesture_detector() -> GestureDetector:
    global _detector
    if _detector is None:
        _detector = GestureDetector()
    return _detector
