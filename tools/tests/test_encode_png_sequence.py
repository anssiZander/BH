from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib


PROJECT_ROOT = Path(__file__).resolve().parents[2]
HELPER_PATH = PROJECT_ROOT / "tools" / "encode_png_sequence.py"
MODULE_SPEC = importlib.util.spec_from_file_location("encode_png_sequence", HELPER_PATH)
assert MODULE_SPEC and MODULE_SPEC.loader
ENCODER = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(ENCODER)


def write_header_only_png(path: Path, width: int = 2560, height: int = 1440) -> None:
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    ihdr = (
        struct.pack(">I", len(ihdr_data))
        + b"IHDR"
        + ihdr_data
        + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr_data) & 0xFFFFFFFF)
    )
    iend = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", zlib.crc32(b"IEND"))
    path.write_bytes(ENCODER.PNG_SIGNATURE + ihdr + iend)


def write_manifest(directory: Path, frame_count: int, **updates: object) -> Path:
    manifest: dict[str, object] = {
        "width": 2560,
        "height": 1440,
        "fps": 30,
        "frameCount": frame_count,
        "status": "complete",
    }
    manifest.update(updates)
    manifest_path = directory / "render_manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return manifest_path


class ManifestAndSequenceTests(unittest.TestCase):
    def test_manifest_and_contiguous_frames_validate(self) -> None:
        with tempfile.TemporaryDirectory(prefix="schwarzschild-encoder-test-") as temporary:
            directory = Path(temporary)
            manifest_path = write_manifest(directory, 3)
            for index in range(3):
                write_header_only_png(directory / f"frame_{index:06d}.png")

            manifest = ENCODER.load_and_validate_manifest(manifest_path)
            frames = ENCODER.validate_frame_sequence(directory, manifest["frameCount"])

            self.assertEqual(manifest["frameCount"], 3)
            self.assertEqual([frame.name for frame in frames], [
                "frame_000000.png",
                "frame_000001.png",
                "frame_000002.png",
            ])

    def test_incomplete_manifest_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="schwarzschild-encoder-test-") as temporary:
            manifest_path = write_manifest(Path(temporary), 1, status="cancelled")
            with self.assertRaisesRegex(ENCODER.EncodingError, "not 'complete'"):
                ENCODER.load_and_validate_manifest(manifest_path)

    def test_wrong_production_profile_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="schwarzschild-encoder-test-") as temporary:
            manifest_path = write_manifest(Path(temporary), 1, width=1920)
            with self.assertRaisesRegex(ENCODER.EncodingError, "2560x1440"):
                ENCODER.load_and_validate_manifest(manifest_path)

    def test_missing_frame_is_reported(self) -> None:
        with tempfile.TemporaryDirectory(prefix="schwarzschild-encoder-test-") as temporary:
            directory = Path(temporary)
            write_header_only_png(directory / "frame_000000.png")
            write_header_only_png(directory / "frame_000002.png")
            with self.assertRaisesRegex(ENCODER.EncodingError, "missing 000001"):
                ENCODER.validate_frame_sequence(directory, 3)

    def test_png_dimensions_are_checked(self) -> None:
        with tempfile.TemporaryDirectory(prefix="schwarzschild-encoder-test-") as temporary:
            directory = Path(temporary)
            write_header_only_png(directory / "frame_000000.png", width=1920, height=1080)
            with self.assertRaisesRegex(ENCODER.EncodingError, "1920x1080"):
                ENCODER.validate_frame_sequence(directory, 1)

    def test_ffprobe_contract_is_strict(self) -> None:
        probe_data = {
            "streams": [{
                "codec_name": "h264",
                "profile": "High",
                "width": 2560,
                "height": 1440,
                "pix_fmt": "yuv420p",
                "field_order": "progressive",
                "color_range": "tv",
                "color_space": "bt709",
                "color_transfer": "bt709",
                "color_primaries": "bt709",
                "r_frame_rate": "30/1",
                "avg_frame_rate": "30/1",
                "duration": "0.100000",
                "nb_read_frames": "3",
            }],
        }
        stream = ENCODER.validate_probe_data(probe_data, 3)
        self.assertEqual(stream["profile"], "High")

        probe_data["streams"][0]["pix_fmt"] = "yuv444p"
        with self.assertRaisesRegex(ENCODER.EncodingError, "pix_fmt"):
            ENCODER.validate_probe_data(probe_data, 3)


@unittest.skipUnless(
    shutil.which("ffmpeg") and shutil.which("ffprobe"),
    "FFmpeg and FFprobe are required for the end-to-end smoke test.",
)
class RealFfmpegSmokeTest(unittest.TestCase):
    def test_three_frame_2k30_encode_and_probe(self) -> None:
        with tempfile.TemporaryDirectory(prefix="schwarzschild-encoder-smoke-") as temporary:
            directory = Path(temporary)
            frame_pattern = directory / "frame_%06d.png"
            generation = subprocess.run(
                [
                    shutil.which("ffmpeg") or "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=size=2560x1440:rate=30",
                    "-frames:v",
                    "3",
                    "-start_number",
                    "0",
                    str(frame_pattern),
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=60,
            )
            self.assertEqual(generation.returncode, 0, generation.stderr)
            write_manifest(directory, 3)
            output_path = directory / "smoke-master.mp4"

            encoding = subprocess.run(
                [
                    sys.executable,
                    str(HELPER_PATH),
                    str(directory),
                    "--output",
                    str(output_path),
                    "--preset",
                    "slow",
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=120,
            )
            self.assertEqual(
                encoding.returncode,
                0,
                f"stdout:\n{encoding.stdout}\nstderr:\n{encoding.stderr}",
            )
            self.assertTrue(output_path.is_file())
            self.assertIn("Verified: h264 High", encoding.stdout)
            self.assertEqual(
                sorted(path.name for path in directory.glob("frame_*.png")),
                ["frame_000000.png", "frame_000001.png", "frame_000002.png"],
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
