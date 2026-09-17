from __future__ import annotations

import argparse
import asyncio
import subprocess
from pathlib import Path

import cv2
import edge_tts
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont


WIDTH = 1080
HEIGHT = 1920
FPS = 30
DURATION = 15.0

NAVY = (4, 24, 62, 255)
SKY = (78, 184, 240, 255)
WHITE = (255, 255, 255, 255)
GOLD = (246, 184, 50, 255)
GREEN = (37, 211, 102, 255)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--card", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--voice", default="es-AR-TomasNeural")
    parser.add_argument("--variant", choices=("payment", "group"), default="payment")
    return parser.parse_args()


def load_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        Path(r"C:\Windows\Fonts\arialbd.ttf"),
        Path(r"C:\Windows\Fonts\bahnschrift.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


FONT_SMALL = load_font(44)
FONT_MEDIUM = load_font(54)
FONT_LARGE = load_font(92)


class FrameReader:
    def __init__(self, cap: cv2.VideoCapture) -> None:
        self.cap = cap
        self.fps = cap.get(cv2.CAP_PROP_FPS) or FPS
        self.last_index = -1
        self.last_frame: np.ndarray | None = None

    def read(self, seconds: float) -> np.ndarray:
        target = max(0, int(seconds * self.fps))
        if target == self.last_index and self.last_frame is not None:
            return self.last_frame.copy()
        if self.last_index < 0 or target < self.last_index or target - self.last_index > 12:
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, target)
            self.last_index = target - 1
        frame = None
        while self.last_index < target:
            ok, frame = self.cap.read()
            if not ok:
                raise RuntimeError(f"Could not read video frame at {seconds:.2f}s")
            self.last_index += 1
        if frame is None:
            frame = self.last_frame
        if frame is None:
            raise RuntimeError(f"No video frame available at {seconds:.2f}s")
        self.last_frame = cv2.resize(frame, (WIDTH, HEIGHT), interpolation=cv2.INTER_LANCZOS4)
        return self.last_frame.copy()


def ken_burns(card: np.ndarray, progress: float, zoom_max: float = 1.035) -> np.ndarray:
    progress = max(0.0, min(1.0, progress))
    scale = 1.0 + (zoom_max - 1.0) * progress
    scaled = cv2.resize(card, None, fx=scale, fy=scale, interpolation=cv2.INTER_LANCZOS4)
    y = max(0, (scaled.shape[0] - HEIGHT) // 2)
    x = max(0, (scaled.shape[1] - WIDTH) // 2)
    return scaled[y : y + HEIGHT, x : x + WIDTH]


def centered_text(draw: ImageDraw.ImageDraw, y: int, text: str, font, fill) -> None:
    box = draw.textbbox((0, 0), text, font=font, stroke_width=1)
    width = box[2] - box[0]
    draw.text(
        ((WIDTH - width) // 2, y),
        text,
        font=font,
        fill=fill,
        stroke_width=1,
        stroke_fill=(0, 0, 0, 90),
    )


def overlay_copy(frame: np.ndarray, line1: str, line2: str = "", accent=SKY) -> np.ndarray:
    rgba = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).convert("RGBA")
    layer = Image.new("RGBA", rgba.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    # An opaque, edge-to-edge band fully hides the malformed captions burned
    # into the source clip, including letters that reach the side edges.
    draw.rectangle((0, 1150, WIDTH, 1710), fill=NAVY)
    draw.rounded_rectangle((54, 1150, 1026, 1170), radius=8, fill=accent)
    centered_text(draw, 1230, "EC10 TALENTOS", FONT_SMALL, SKY)
    if line2:
        centered_text(draw, 1320, line1, FONT_MEDIUM, WHITE)
        centered_text(draw, 1425, line2, FONT_LARGE, accent)
    else:
        centered_text(draw, 1345, line1, FONT_LARGE, WHITE)
    rgba = Image.alpha_composite(rgba, layer).convert("RGB")
    return cv2.cvtColor(np.asarray(rgba), cv2.COLOR_RGB2BGR)


async def synthesize_voice(path: Path, voice: str, variant: str) -> None:
    if variant == "group":
        text = (
            "Buenos Aires, preparate. EC10 Talentos llega el diecisiete y dieciocho de julio. "
            "Completá tus datos y sumate al grupo oficial de WhatsApp. Recibí horarios, "
            "ubicación y todas las novedades de la convocatoria. Entrá ahora."
        )
    else:
        text = (
            "Buenos Aires, preparate. EC10 Talentos llega el diecisiete y dieciocho de julio. "
            "Mostrá tu talento y reservá tu lugar. La inscripción cuesta cincuenta dólares, "
            "en un pago único. Inscribite ahora."
        )
    communicate = edge_tts.Communicate(text, voice, rate="+18%", volume="+0%", pitch="+0Hz")
    await communicate.save(str(path))


def render_video(source: Path, card_path: Path, silent_path: Path, variant: str) -> None:
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise RuntimeError(f"Could not open {source}")
    reader = FrameReader(cap)
    card = cv2.imread(str(card_path))
    if card is None:
        raise RuntimeError(f"Could not open {card_path}")
    card = cv2.resize(card, (WIDTH, HEIGHT), interpolation=cv2.INTER_LANCZOS4)
    writer = cv2.VideoWriter(
        str(silent_path), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (WIDTH, HEIGHT)
    )
    if not writer.isOpened():
        cap.release()
        raise RuntimeError("Could not initialize MP4 writer")

    try:
        total = int(DURATION * FPS)
        for index in range(total):
            t = index / FPS
            if variant == "group" and t < 3.5:
                source_t = 12.0 + t * (2.5 / 3.5)
                frame = overlay_copy(
                    reader.read(source_t), "CONVOCATORIA INTERNACIONAL", "BUENOS AIRES"
                )
            elif variant == "group" and t < 7.0:
                source_t = 15.0 + (t - 3.5) * (3.0 / 3.5)
                frame = overlay_copy(reader.read(source_t), "17 Y 18 DE JULIO")
            elif variant == "group" and t < 11.0:
                source_t = 35.2 + (t - 7.0) * (2.4 / 4.0)
                frame = overlay_copy(
                    reader.read(source_t), "RECIBÍ TODA LA INFO", "EN WHATSAPP", accent=GREEN
                )
            elif variant == "group":
                source_t = 12.0 + (t - 11.0) * (3.0 / 4.0)
                frame = overlay_copy(
                    reader.read(source_t), "SUMATE AL GRUPO", "OFICIAL", accent=GREEN
                )
            elif t < 2.5:
                frame = ken_burns(card, t / 2.5)
            elif t < 6.0:
                source_t = 12.0 + (t - 2.5) * (2.5 / 3.5)
                frame = overlay_copy(
                    reader.read(source_t), "CONVOCATORIA INTERNACIONAL", "BUENOS AIRES"
                )
            elif t < 9.0:
                source_t = 15.0 + (t - 6.0)
                frame = overlay_copy(reader.read(source_t), "17 Y 18 DE JULIO")
            elif t < 11.5:
                source_t = 35.2 + (t - 9.0) * (2.4 / 2.5)
                frame = overlay_copy(
                    reader.read(source_t), "INSCRIPCIÓN: USD 50", "PAGO ÚNICO", accent=GOLD
                )
            else:
                frame = ken_burns(card, (t - 11.5) / 3.5, zoom_max=1.025)
            writer.write(frame)
    finally:
        writer.release()
        cap.release()


def mux_final(silent_path: Path, voice_path: Path, output: Path) -> None:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    command = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(silent_path),
        "-i",
        str(voice_path),
        "-filter_complex",
        "[1:a]apad=pad_dur=15,atrim=duration=15,afade=t=in:st=0:d=0.15,afade=t=out:st=14.3:d=0.7[a]",
        "-map",
        "0:v:0",
        "-map",
        "[a]",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        "-t",
        "15",
        str(output),
    ]
    subprocess.run(command, check=True)


def validate_output(path: Path) -> dict:
    cap = cv2.VideoCapture(str(path))
    try:
        if not cap.isOpened():
            raise RuntimeError("Final video could not be opened")
        fps = cap.get(cv2.CAP_PROP_FPS)
        frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        return {
            "path": str(path),
            "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            "fps": fps,
            "duration": round(frames / fps, 2) if fps else 0,
            "bytes": path.stat().st_size,
        }
    finally:
        cap.release()


def main() -> None:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    silent_path = args.output.with_name(args.output.stem + "-silent.mp4")
    voice_path = args.output.with_name(args.output.stem + "-voice.mp3")
    render_video(args.source, args.card, silent_path, args.variant)
    asyncio.run(synthesize_voice(voice_path, args.voice, args.variant))
    mux_final(silent_path, voice_path, args.output)
    print(validate_output(args.output))


if __name__ == "__main__":
    main()
