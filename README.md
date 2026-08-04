# Schwarzschild Optical Field

A framework-free, real-time WebGL2 visualization of light propagation around a
nonrotating Schwarzschild black hole. The scene contains no accretion disk:
everything visible is the lensed sky, shaded spherical reference skins, or two
optional ray-marched Dyson hemispheres wrapped around the photon sphere. The
hemispheres leave one narrow equatorial corridor open for the reset camera's
straight radial infall.

## Run it

1. Open this folder in VS Code.
2. Install the **Live Server** extension if needed.
3. Right-click `index.html` and choose **Open with Live Server**.
4. Use a current Chrome, Edge, or Firefox build with hardware acceleration enabled.

The shader files and local sky texture are loaded with `fetch()`, so opening
`index.html` directly as a `file://` URL is intentionally unsupported.

## Controls

- Click the scene: capture the pointer for mouse look
- Mouse: yaw and pitch
- W / S: move radially toward or away from the black hole
- A / D: move azimuthally left or right around the black hole
- Space / C (or E / Q): move toward either pole
- Shift: flight-speed boost
- R: reset the camera
- H: hide or restore the interface
- Escape: release pointer lock
- Dyson rotation: continuously adjusts both hemispheres from stopped to the
  original `0.015`-radian-per-second speed
- Photon label: fades a translucent yellow Orbitron `PHOTON SPHERE` inscription
  in or out on the equator of the lensed photon-sphere surface; its reading
  direction automatically reverses when the camera crosses inside
- Quick MP4 / WebM: captures the visible WebGL canvas in real time as a
  convenience preview. It is explicitly **not production quality**: its size,
  cadence, codec and bitrate remain browser-dependent.

The instrument panel controls RK2 integration quality, base ray step, flight
speed, Dyson rotation, field of view, reference-sphere count, exposure,
saturation, and the internal render resolution. Lensing, shaded reference
spheres, the sky sphere, and the Dyson structure can each be disabled
independently. The structure control is labeled `Dyson hemispheres` in the interface.
Sphere skins start disabled so the enclosed station is visible on first load.

## What the radii mean

The mass is set to `M = 1` with `G = c = 1`. The event horizon is at the
Schwarzschild areal radius `r = 2M`; rays reaching a small numerical margin
outside its isotropic-coordinate radius `ρ = M/2` are captured and returned
black. The photon label and Dyson hemispheres share the
photon-sphere radius `r = 3M`, or `ρ = (2 + √3)M/2`. It is not the horizon.

The apparent black shape is the captured-ray region, commonly called the black
hole shadow. Its boundary is not a directly rendered solid event-horizon
surface: lensing and the photon sphere make the shadow appear larger than the
physical horizon. The flight camera is deliberately clamped just outside
`ρ = M/2`, so this visualization does not currently allow travel through the
horizon.

The optional reference-sphere skins are placed at areal radii
`r/M = 2.2, 2.5, 3.5, 4, 5, 6.5, 8`, with the photon sphere inserted at `3M`.

## Numerical method

The fragment shader treats the isotropic Schwarzschild optical geometry as a
radially varying refractive medium:

```text
n(ρ) = (1 + M/(2ρ))³ / (1 - M/(2ρ))
```

Each pixel launches a three-dimensional ray from the camera and integrates its
position and normalized tangent with a midpoint/RK2 step. The projected
gradient of `ln(n)` curves the ray. Step length shrinks near the horizon,
photon sphere, optional sphere crossings, and the Dyson hull, then grows in the far field. A hard quality
budget prevents near-critical rays from stalling the GPU.

The optional sphere skins share those radii and colors. Procedural brushed
grain, shallow relief, key and fill lights, restrained highlights, and stronger
silhouette shading establish surface direction and depth. Both the inner and
outer faces are fully opaque. The `Spheres` switch is independent of the Dyson
structure and starts disabled.

Two opaque procedural Dyson hemispheres curve along the photon sphere at areal
radius `r = 3M`, corresponding to isotropic radius `ρ/M = 1.86602540`. Their
fragment-shader scene adapts the ring map from morimea's CC0
[*\[TAA\] Orbital Megastructure*](https://www.shadertoy.com/view/X33BRn).
The source radius `8` is scaled by `ρphoton / 8`. A folded spherical-latitude
mapping leaves only the interval `±0.125` radians around the equator uncovered,
for a total opening of about `14.32°`. This includes the reset camera's radial
trajectory at `5.71°` with a narrow geometric clearance from the detailed rim.
Both hemispheres rotate together about their shared polar axis at
`0.015` radians per second, completing one revolution in about 7 minutes. The
distance-field geometry and all procedural panel, window, and surface-noise
coordinates use the same rotating object-space transform.

The adaptation retains the source CityBlock hull relief, dense procedural panel
material, equatorial rim rails, material IDs, noise, finite-difference normals,
ambient occlusion, and directional shadowing. Surface hits are refined before
shading, normal and shadow tolerances follow the projected pixel footprint, and
sub-pixel CityBlock pipes and roof details fade into the macro hull instead of
alternating between hit and miss from frame to frame. The protruding
cross-lattice pipes, center-facing spokes, central hub, ladder struts,
communications mast, and repeated dishes are omitted. Camera, Earth,
temporal-antialiasing, and post-processing code from the Shadertoy are not
copied; the Schwarzschild camera, lensed sky, and tone mapper remain in control.
The original project's rendering strategy informed the independently
implemented anti-aliasing pipeline described below. Fine CityBlock geometry is
restricted to the low-latitude region closest to the supported infall, while a
continuous filtered panel hull covers each hemisphere through its pole. The
`Dyson hemispheres` switch disables both halves independently of sphere skins.
Because sphere skins are opaque, an enabled skin naturally occludes station geometry behind
it; disable `Spheres` to inspect the complete structure.

The live areal-radius tracker uses a logarithmic `2M`–`22M` scale. Its horizon
notch is the left endpoint at `2M`, while the photon-sphere notch and live
camera marker are both positioned by the same scale function, so they coincide
at `3M`.

In flat-ray mode, each scene sample uses a 360-phase Halton jitter sequence.
The scene writes the previous-frame UV of every visible rotating station point
into an RGBA8 motion attachment, accounting for both camera motion and the
station's object-space rotation. A Catmull–Rom history reconstruction is clipped
to current-frame YCoCg neighborhood mean and variance before accumulation, so
the history can suppress edge crawl without leaving long trails at
disocclusions. A restrained RCAS-style final pass restores local definition
after the temporal resolve. Lensed images do not have a unique pinhole inverse
motion map, so their jitter is disabled rather than accumulated at an incorrect
screen position. History is cleared after long frame stalls as well as on
resize, quality or display-setting changes, camera reset, and tab visibility
changes.

Keyboard movement uses a black-hole-centered radial, azimuthal, and polar
basis that is independent of the viewing direction. It eases gradually toward
and away from its target velocity, while mouse look uses a still softer target-
orientation response. Both use frame-rate-independent exponential responses;
reset, focus loss, and pointer-lock transitions cancel residual motion safely.

## Production camera tracks and 2K PNG export

Open the compact **Production render** section for the recommended two-stage
workflow. Production output is fixed to exactly **2560 × 1440 at 30 fps** and
does not use the visible canvas, `requestAnimationFrame()`, `captureStream()` or
`MediaRecorder` for its frames.

1. Select **Record camera path**, fly and look around normally, then select
   **Stop path**. The recorder stores timestamped camera position, quaternion
   orientation, FOV, scene time and a visual-settings snapshot—not images.
2. Optionally set trim start/end and mild smoothing, then select **Preview
   track**. A smoothing value of zero is the exact piecewise raw path. Preview
   and export share the same time-based Hermite/SLERP/SQUAD evaluator. Manual
   input is disabled during preview and the original live camera is restored
   afterward.
3. Use **Save JSON** to keep the small track file, or **Load JSON** to validate
   and reuse one later. Invalid versions, non-finite values, invalid settings,
   bad quaternion data and samples inside the camera guard are rejected.
4. Choose 1, 4, 8 or 16 same-time spatial samples per frame (8 is the default).
   **Test first 30** makes a short sequence. **Render PNG sequence** processes
   the full trimmed track.
5. Choose an empty or previous output directory when Chrome/Edge asks. Frames
   are written immediately as `frame_000000.png`, `frame_000001.png`, and so
   on, alongside `render_manifest.json` and a fingerprint-named recovery copy
   of the validated camera track. Nothing collects the sequence in RAM.

Leaving **Start frame** empty scans a compatible directory and resumes at its
first missing frame without overwriting completed frames. Entering a frame
number deliberately restarts there; existing target files require confirmation.
**Cancel after current frame** closes the current PNG and updates the manifest
before stopping, so a partial sequence remains resumable.

Resume compatibility is based on a SHA-256 fingerprint of the complete track,
smoothing, trim, production settings, sample count and render-pipeline version.
Existing PNGs are fully decoded and dimension-checked before they are accepted.
Incompatible numbered frames are deleted only after an explicit confirmation.

Each output frame evaluates the track at `trimStart + frameIndex / 30`.
Rendering may run much slower than 30 frames per second, or be throttled while
the tab is hidden, without changing the saved timeline. Monitor resolution,
browser size, DPR, zoom, live quality and the live megapixel cap do not change
the 2560 × 1440 framebuffer. Production uses at least the existing 896-step
Ultra geodesic budget.

For antialiasing, the renderer holds camera and scene time fixed while applying
a deterministic, zero-centred Hammersley subpixel pattern. Samples are averaged
incrementally in ping-pong RGBA16F targets. A separate resolve performs
saturation, exposure/tone mapping, sRGB conversion, restrained sharpening and
fixed spatial dithering once. It deliberately bypasses live cross-frame TAA, so
lensed images cannot ghost through an inaccurate motion reprojection.

The directory picker requires the File System Access API, so production export
currently requires a Chromium browser such as Chrome or Edge on localhost or
HTTPS. A raw 2560 × 1440 RGBA frame is about 14.1 MiB; lossless PNG size depends
heavily on the view. For conservative planning, allow up to roughly **26 GiB per
minute** of 30 fps footage, although most PNG sequences compress smaller.

### Encode the PNG master

Keep the lossless PNG sequence until the encoded master has been watched,
checked and backed up. With FFmpeg and FFprobe on `PATH`, run from the project:

```powershell
py tools\encode_png_sequence.py "C:\path\to\completed-frames"
```

The helper validates the complete manifest, every sequential filename and each
PNG's 2560 × 1440 IHDR before encoding. It produces
`schwarzschild-production-2k30.mp4` using `libx264`, preset `slow`, CRF 12,
H.264 High Profile, progressive `yuv420p`, BT.709 metadata and fast-start MP4,
then verifies the result with FFprobe. It never rescales or deletes the PNGs.
Use `--output` for another filename and `--overwrite` only when replacement is
intentional.

Known production limitations: this profile is SDR 8-bit PNG after high-precision
accumulation; it has no audio, motion blur or 4K option; exact raw-pixel identity
is expected on the same browser/GPU stack but is not promised across different
graphics drivers. The camera still cannot cross the numerical horizon guard.

## Quality and performance

`Medium` is the default live profile and uses 288 RK2 steps at a 64% internal
scale with a 0.9-megapixel safety cap. `Low` provides a 192-step, 0.45-scale
recovery profile; `High` uses 384 steps up to 1.8 megapixels; and live `Ultra`
uses 640 steps up to 2.6 megapixels. The live hemisphere shader uses filtered
panel shading, analytic ambient fill, and direct lighting; full CityBlock SDF
detail activates only close to the equatorial trajectory.

Production rendering remains separate: it always uses the 896-step ray budget,
full low-latitude CityBlock geometry, multi-sample ambient occlusion, ray-marched
self-shadows, layered panels, and the selected 1/4/8/16 spatial samples. Browser
size and the live quality setting do not reduce production fidelity. Critical
rays that still exhaust a budget are darkened gracefully, and the status display
reports when sampled view rays hit the cap.

## Approximations

- Camera movement is intentionally Euclidean and is not a massive-particle geodesic.
- The renderer illustrates Schwarzschild null optics qualitatively; it is not a
  precision relativity solver.
- Finite step size and finite escape radius cause small drift in extremely long
  near-critical orbits.
- The Dyson structure is an artistic visualization, not an accretion
  disk or a model of self-supporting matter.
- The sphere skins are visualization surfaces, not physical matter around the hole.
- Camera motion stops at a numerical guard outside the horizon; there is no
  modeled interior region.
- The star field is treated as infinitely distant once a ray exits the strong-field region.

See [ASSET_SOURCE.md](ASSET_SOURCE.md) for the locally stored sky-map attribution.
Measured numerical and GPU checks are recorded in [VALIDATION.md](VALIDATION.md).
