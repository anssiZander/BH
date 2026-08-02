#!/usr/bin/env python3
"""Encode a completed Schwarzschild production PNG sequence to H.264 MP4.

The PNG sequence remains the lossless master. This helper never deletes source
frames and refuses incomplete, non-2K, non-30-fps, or non-contiguous renders.
"""

from __future__ import annotations

import argparse
from fractions import Fraction
import json
import math
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
from typing import Any, Sequence


EXPECTED_WIDTH = 2560
EXPECTED_HEIGHT = 1440
EXPECTED_FPS = 30
DEFAULT_CRF = 12
DEFAULT_PRESET = "slow"
DEFAULT_OUTPUT_NAME = "schwarzschild-production-2k30.mp4"
MAX_MANIFEST_BYTES = 4 * 1024 * 1024
MAX_FRAME_COUNT = 1_000_000
FRAME_NAME_RE = re.compile(r"^frame_(\d{6})\.png$", re.IGNORECASE)
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class EncodingError(RuntimeError):
    """A user-facing validation or encoding failure."""


def _manifest_value(manifest: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in manifest:
            return manifest[key]
    joined = " or ".join(repr(key) for key in keys)
    raise EncodingError(f"The render manifest is missing {joined}.")


def _finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise EncodingError(f"Manifest {label} must be a finite number.")
    number = float(value)
    if not math.isfinite(number):
        raise EncodingError(f"Manifest {label} must be a finite number.")
    return number


def _positive_integer(value: Any, label: str) -> int:
    number = _finite_number(value, label)
    if number <= 0 or not number.is_integer():
        raise EncodingError(f"Manifest {label} must be a positive integer.")
    return int(number)


def load_and_validate_manifest(manifest_path: Path) -> dict[str, Any]:
    try:
        manifest_size = manifest_path.stat().st_size
        if manifest_size > MAX_MANIFEST_BYTES:
            raise EncodingError(
                "The render manifest is unexpectedly large "
                f"({manifest_size} bytes; maximum {MAX_MANIFEST_BYTES})."
            )
        raw_manifest = manifest_path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise EncodingError(f"Render manifest not found: {manifest_path}") from error
    except OSError as error:
        raise EncodingError(f"Could not read render manifest: {error}") from error

    try:
        manifest = json.loads(raw_manifest)
    except json.JSONDecodeError as error:
        raise EncodingError(
            f"Render manifest is not valid JSON at line {error.lineno}, "
            f"column {error.colno}: {error.msg}"
        ) from error
    if not isinstance(manifest, dict):
        raise EncodingError("The render manifest root must be a JSON object.")

    width = _positive_integer(_manifest_value(manifest, "width"), "width")
    height = _positive_integer(_manifest_value(manifest, "height"), "height")
    fps = _finite_number(
        _manifest_value(manifest, "fps", "frameRate", "frame_rate"),
        "fps",
    )
    frame_count = _positive_integer(
        _manifest_value(manifest, "frameCount", "frame_count"),
        "frameCount",
    )
    if frame_count > MAX_FRAME_COUNT:
        raise EncodingError(
            f"Manifest frameCount exceeds the six-digit filename limit of "
            f"{MAX_FRAME_COUNT} frames."
        )

    if (width, height) != (EXPECTED_WIDTH, EXPECTED_HEIGHT):
        raise EncodingError(
            "This helper accepts only the production profile "
            f"{EXPECTED_WIDTH}x{EXPECTED_HEIGHT}; the manifest declares "
            f"{width}x{height}."
        )
    if not math.isclose(fps, EXPECTED_FPS, rel_tol=0.0, abs_tol=1e-9):
        raise EncodingError(
            f"This helper accepts exactly {EXPECTED_FPS} fps; "
            f"the manifest declares {fps:g} fps."
        )

    status = manifest.get("status")
    if status is not None:
        if not isinstance(status, str) or status.strip().lower() not in {
            "complete",
            "completed",
        }:
            raise EncodingError(
                f"The render manifest status is {status!r}, not 'complete'. "
                "Resume or finish the PNG render before encoding."
            )

    normalized = dict(manifest)
    normalized["width"] = width
    normalized["height"] = height
    normalized["fps"] = EXPECTED_FPS
    normalized["frameCount"] = frame_count
    return normalized


def read_png_dimensions(frame_path: Path) -> tuple[int, int]:
    try:
        with frame_path.open("rb") as frame_file:
            header = frame_file.read(24)
    except OSError as error:
        raise EncodingError(f"Could not read {frame_path.name}: {error}") from error

    if len(header) < 24 or header[:8] != PNG_SIGNATURE or header[12:16] != b"IHDR":
        raise EncodingError(f"{frame_path.name} is not a valid PNG with an IHDR header.")
    ihdr_length = struct.unpack(">I", header[8:12])[0]
    if ihdr_length != 13:
        raise EncodingError(f"{frame_path.name} has an invalid PNG IHDR length.")
    return struct.unpack(">II", header[16:24])


def validate_frame_sequence(
    frames_directory: Path,
    frame_count: int,
) -> list[Path]:
    try:
        directory_entries = list(frames_directory.iterdir())
    except FileNotFoundError as error:
        raise EncodingError(f"Frames directory not found: {frames_directory}") from error
    except NotADirectoryError as error:
        raise EncodingError(f"Frames path is not a directory: {frames_directory}") from error
    except OSError as error:
        raise EncodingError(f"Could not inspect frames directory: {error}") from error

    frames_by_index: dict[int, Path] = {}
    malformed_names: list[str] = []
    for entry in directory_entries:
        if not entry.is_file():
            continue
        lower_name = entry.name.lower()
        if not (lower_name.startswith("frame_") and lower_name.endswith(".png")):
            continue
        match = FRAME_NAME_RE.fullmatch(entry.name)
        if not match:
            malformed_names.append(entry.name)
            continue
        frame_index = int(match.group(1))
        if frame_index in frames_by_index:
            raise EncodingError(
                "More than one PNG maps to frame index "
                f"{frame_index}: {frames_by_index[frame_index].name}, {entry.name}."
            )
        frames_by_index[frame_index] = entry

    if malformed_names:
        examples = ", ".join(sorted(malformed_names)[:5])
        raise EncodingError(
            "Malformed frame names were found. Expected frame_000000.png style "
            f"names; examples: {examples}"
        )

    expected_indices = set(range(frame_count))
    actual_indices = set(frames_by_index)
    missing = sorted(expected_indices - actual_indices)
    extras = sorted(actual_indices - expected_indices)
    if missing or extras:
        details: list[str] = []
        if missing:
            suffix = "..." if len(missing) > 10 else ""
            details.append(
                "missing " + ", ".join(f"{index:06d}" for index in missing[:10]) + suffix
            )
        if extras:
            suffix = "..." if len(extras) > 10 else ""
            details.append(
                "unexpected " + ", ".join(f"{index:06d}" for index in extras[:10]) + suffix
            )
        raise EncodingError(
            "The PNG sequence is not the exact contiguous manifest range "
            f"000000..{frame_count - 1:06d}: {'; '.join(details)}."
        )

    ordered_frames = [frames_by_index[index] for index in range(frame_count)]
    for frame_path in ordered_frames:
        width, height = read_png_dimensions(frame_path)
        if (width, height) != (EXPECTED_WIDTH, EXPECTED_HEIGHT):
            raise EncodingError(
                f"{frame_path.name} is {width}x{height}; every source PNG must be "
                f"exactly {EXPECTED_WIDTH}x{EXPECTED_HEIGHT}."
            )
    return ordered_frames


def resolve_executable(requested: str, label: str) -> str:
    requested_path = Path(requested).expanduser()
    contains_separator = any(separator in requested for separator in ("/", "\\"))
    if contains_separator:
        if not requested_path.is_file():
            raise EncodingError(f"{label} executable not found: {requested_path}")
        return str(requested_path.resolve())

    resolved = shutil.which(requested)
    if not resolved:
        raise EncodingError(
            f"{label} was not found on PATH. Install FFmpeg and ensure both "
            "ffmpeg and ffprobe are available."
        )
    return resolved


def check_tool(executable: str, label: str) -> str:
    try:
        result = subprocess.run(
            [executable, "-hide_banner", "-version"],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except OSError as error:
        raise EncodingError(f"Could not start {label}: {error}") from error
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise EncodingError(f"{label} did not start successfully: {detail}")
    first_line = (result.stdout or result.stderr).splitlines()
    return first_line[0].strip() if first_line else label


def require_libx264(ffmpeg_executable: str) -> None:
    try:
        result = subprocess.run(
            [ffmpeg_executable, "-hide_banner", "-encoders"],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except OSError as error:
        raise EncodingError(f"Could not query FFmpeg encoders: {error}") from error
    if result.returncode != 0 or not re.search(r"\blibx264\b", result.stdout):
        raise EncodingError(
            "This FFmpeg build does not provide the required libx264 encoder."
        )


def build_ffmpeg_command(
    ffmpeg_executable: str,
    frames_directory: Path,
    output_path: Path,
    frame_count: int,
    crf: int,
    preset: str,
    overwrite: bool,
) -> list[str]:
    frame_pattern = frames_directory / "frame_%06d.png"
    return [
        ffmpeg_executable,
        "-hide_banner",
        "-y" if overwrite else "-n",
        "-framerate",
        str(EXPECTED_FPS),
        "-start_number",
        "0",
        "-i",
        str(frame_pattern),
        "-frames:v",
        str(frame_count),
        "-an",
        "-vf",
        (
            "setparams=field_mode=prog:range=tv:"
            "color_primaries=bt709:color_trc=bt709:colorspace=bt709"
        ),
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        str(crf),
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(output_path),
    ]


def _parse_fraction(value: Any, label: str) -> Fraction:
    if not isinstance(value, str):
        raise EncodingError(f"FFprobe did not report {label} as a frame-rate ratio.")
    try:
        ratio = Fraction(value)
    except (ValueError, ZeroDivisionError) as error:
        raise EncodingError(f"FFprobe reported invalid {label}: {value!r}.") from error
    return ratio


def validate_probe_data(probe_data: dict[str, Any], frame_count: int) -> dict[str, Any]:
    streams = probe_data.get("streams")
    if not isinstance(streams, list) or len(streams) != 1 or not isinstance(streams[0], dict):
        raise EncodingError("FFprobe did not report exactly one video stream.")
    stream = streams[0]

    expected_values = {
        "codec_name": "h264",
        "profile": "High",
        "width": EXPECTED_WIDTH,
        "height": EXPECTED_HEIGHT,
        "pix_fmt": "yuv420p",
        "field_order": "progressive",
        "color_range": "tv",
        "color_space": "bt709",
        "color_transfer": "bt709",
        "color_primaries": "bt709",
    }
    mismatches = [
        f"{key}={stream.get(key)!r} (expected {expected!r})"
        for key, expected in expected_values.items()
        if stream.get(key) != expected
    ]

    for rate_key in ("r_frame_rate", "avg_frame_rate"):
        rate = _parse_fraction(stream.get(rate_key), rate_key)
        if rate != Fraction(EXPECTED_FPS, 1):
            mismatches.append(
                f"{rate_key}={stream.get(rate_key)!r} "
                f"(expected {EXPECTED_FPS}/1)"
            )

    try:
        probed_frames = int(stream.get("nb_read_frames"))
    except (TypeError, ValueError) as error:
        raise EncodingError(
            "FFprobe did not return a numeric nb_read_frames value."
        ) from error
    if probed_frames != frame_count:
        mismatches.append(
            f"nb_read_frames={probed_frames} (expected {frame_count})"
        )

    expected_duration = frame_count / EXPECTED_FPS
    try:
        duration = float(stream.get("duration"))
    except (TypeError, ValueError) as error:
        raise EncodingError("FFprobe did not return a numeric stream duration.") from error
    if not math.isfinite(duration) or abs(duration - expected_duration) > 1e-6:
        mismatches.append(
            f"duration={duration!r} (expected {expected_duration:.6f})"
        )

    if mismatches:
        raise EncodingError(
            "The encoded video failed FFprobe validation: " + "; ".join(mismatches)
        )
    return stream


def probe_and_validate(
    ffprobe_executable: str,
    output_path: Path,
    frame_count: int,
) -> dict[str, Any]:
    command = [
        ffprobe_executable,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-count_frames",
        "-show_entries",
        (
            "stream=codec_name,profile,width,height,pix_fmt,r_frame_rate,"
            "avg_frame_rate,nb_read_frames,duration,field_order,color_range,"
            "color_space,color_transfer,color_primaries"
        ),
        "-of",
        "json",
        str(output_path),
    ]
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except OSError as error:
        raise EncodingError(f"Could not start FFprobe: {error}") from error
    if result.returncode != 0:
        raise EncodingError(
            "FFprobe could not inspect the encoded video: "
            + (result.stderr.strip() or "unknown FFprobe error")
        )
    try:
        probe_data = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise EncodingError("FFprobe returned malformed JSON.") from error
    if not isinstance(probe_data, dict):
        raise EncodingError("FFprobe returned an unexpected JSON result.")
    return validate_probe_data(probe_data, frame_count)


def parse_arguments(arguments: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate and encode a completed 2560x1440, 30 fps Schwarzschild "
            "PNG production sequence using H.264 High Profile."
        )
    )
    parser.add_argument(
        "frames_directory",
        nargs="?",
        default=".",
        help="Directory containing render_manifest.json and frame_XXXXXX.png files.",
    )
    parser.add_argument(
        "--manifest",
        help="Manifest path (default: <frames_directory>/render_manifest.json).",
    )
    parser.add_argument(
        "--output",
        help=f"MP4 output path (default: <frames_directory>/{DEFAULT_OUTPUT_NAME}).",
    )
    parser.add_argument(
        "--crf",
        type=int,
        default=DEFAULT_CRF,
        help=f"libx264 CRF quality, 0-51 (default: {DEFAULT_CRF}).",
    )
    parser.add_argument(
        "--preset",
        choices=(
            "medium",
            "slow",
            "slower",
            "veryslow",
        ),
        default=DEFAULT_PRESET,
        help=f"libx264 speed preset (default: {DEFAULT_PRESET}).",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Explicitly allow replacing an existing output MP4.",
    )
    parser.add_argument(
        "--ffmpeg",
        default="ffmpeg",
        help="FFmpeg executable name or path (default: ffmpeg on PATH).",
    )
    parser.add_argument(
        "--ffprobe",
        default="ffprobe",
        help="FFprobe executable name or path (default: ffprobe on PATH).",
    )
    parsed = parser.parse_args(arguments)
    if not 0 <= parsed.crf <= 51:
        parser.error("--crf must be between 0 and 51")
    return parsed


def run(arguments: Sequence[str] | None = None) -> Path:
    options = parse_arguments(arguments)
    frames_directory = Path(options.frames_directory).expanduser().resolve()
    manifest_path = (
        Path(options.manifest).expanduser().resolve()
        if options.manifest
        else frames_directory / "render_manifest.json"
    )
    output_path = (
        Path(options.output).expanduser().resolve()
        if options.output
        else frames_directory / DEFAULT_OUTPUT_NAME
    )

    manifest = load_and_validate_manifest(manifest_path)
    frame_count = manifest["frameCount"]
    validate_frame_sequence(frames_directory, frame_count)

    if output_path.exists() and not options.overwrite:
        raise EncodingError(
            f"Output already exists: {output_path}. Use --overwrite only after "
            "confirming that it may be replaced."
        )
    output_path.parent.mkdir(parents=True, exist_ok=True)

    ffmpeg_executable = resolve_executable(options.ffmpeg, "FFmpeg")
    ffprobe_executable = resolve_executable(options.ffprobe, "FFprobe")
    ffmpeg_version = check_tool(ffmpeg_executable, "FFmpeg")
    ffprobe_version = check_tool(ffprobe_executable, "FFprobe")
    require_libx264(ffmpeg_executable)

    print(f"Frames:  {frame_count} contiguous PNGs at {EXPECTED_WIDTH}x{EXPECTED_HEIGHT}")
    print(f"Timing:  {EXPECTED_FPS} fps ({frame_count / EXPECTED_FPS:.3f} seconds)")
    print(f"FFmpeg: {ffmpeg_version}")
    print(f"FFprobe: {ffprobe_version}")
    print(f"Output:  {output_path}")
    print("Encoding with libx264 High Profile; source PNGs will not be deleted.")

    command = build_ffmpeg_command(
        ffmpeg_executable,
        frames_directory,
        output_path,
        frame_count,
        options.crf,
        options.preset,
        options.overwrite,
    )
    try:
        result = subprocess.run(command, check=False)
    except OSError as error:
        raise EncodingError(f"Could not start FFmpeg: {error}") from error
    if result.returncode != 0:
        raise EncodingError(
            f"FFmpeg exited with code {result.returncode}. Source PNGs were retained."
        )

    stream = probe_and_validate(ffprobe_executable, output_path, frame_count)
    print(
        "Verified: "
        f"{stream['codec_name']} {stream['profile']}, "
        f"{stream['width']}x{stream['height']}, "
        f"{stream['avg_frame_rate']} fps, {stream['pix_fmt']}, "
        f"{stream['field_order']}, {stream['nb_read_frames']} frames."
    )
    print("Encoding complete. Keep the PNG master until this MP4 is checked and backed up.")
    return output_path


def main() -> int:
    try:
        run()
    except EncodingError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nEncoding cancelled. Source PNGs were retained.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
