# Validation record

The baseline measurements below were recorded on 28 July 2026. The
numerical-optics section remains the baseline for the unchanged ray equation.
The final section records the 29 July 2026 source, geometry, envelope,
distribution, HTTP, and share-image checks for the four-band revision.

## Recorded baseline: runtime and rendering

- Served the project over local HTTP and confirmed `200` responses for the HTML,
  stylesheet, all three JavaScript modules, all three fetched shader files, and the
  local sky texture.
- Parsed every JavaScript module as an ES module without syntax errors.
- Compiled and linked the same vertex and fragment shader logic in a standalone
  OpenGL 3.3 context after changing only the GLSL version line and removing the
  WebGL precision declarations.
- Rendered and inspected exterior, elevated equatorial-plane, spheres-only,
  sphere-disabled, sky-disabled, and tracks-only frames from the retired track
  implementation on an NVIDIA GeForce RTX 4070 Laptop GPU.
- The High profile's 960 × 600 offscreen shader frame with the sky, grids, and
  retired tracks enabled took approximately 5.0 ms. Enabling the textured sphere
  skins raised the same view to approximately 15.3 ms. These values are
  indicative GPU timings, exclude browser composition, and are not performance
  measurements for the current orbital-station SDF.
- The 6000 × 3000 local JPEG was decoded, uploaded, mipmapped, and sampled with
  horizontal wrapping during those render checks.
- The attached browser pool was unavailable, so an actual browser-console and
  pointer-lock interaction pass could not be completed in this session. The
  event wiring and error paths were inspected statically; this limitation is
  not represented as a successful browser test.

## Recorded baseline: numerical optics

The CPU validation reproduces the shader's projected-gradient RK2 equations and
adaptive step policy.

- A radial outward ray from `ρ = 14M` escaped in 42 High-profile steps with
  exactly unchanged direction.
- The corresponding radial inward ray was captured in 151 steps.
- At `ρ = (2 + √3)M/2`, a tangential High-profile ray travelled
  `3.566698` radians while drifting only `0.000571922M` in isotropic radius.
- `nρ` at the photon sphere equals `5.196152422706633 = 3√3M`.
- Rays immediately below and above the critical impact parameter classified as
  capture and scattering respectively; winding increased to roughly 2.3–2.5
  turns in a long-budget critical-direction sweep.
- Twenty-four rotated initial conditions preserved their classifications and
  trajectories, with maximum back-rotated position error below `4 × 10⁻¹³`.
- Weak deflection tests at `b/M = 20, 30, 50` agreed with the corresponding
  Schwarzschild integral to better than `1.5 × 10⁻⁶` relative after the
  finite-distance tail correction.
- The horizon conversion gives `r(ρ = 0.5M) = 2M`; the highlighted shell gives
  `r(ρ = (2 + √3)M/2) = 3M`.
- All eight shell constants convert back to their requested areal radii within
  `5 × 10⁻⁹M`.
- A 1,296-ray reset-view scan produced no NaNs or infinities at any quality.
  At High, 1,130 rays escaped, 154 captured, and 12 remained in the intentionally
  bounded critical set. Ultra reduced that unresolved set to 4 rays.
- A separate randomized stress run over the full exposed base-step range also
  produced no persistent nonfinite state.

## Recorded baseline: visual checks

- The exterior frame shows eight nested spherical latitude/longitude grids,
  a black captured-ray region, repeated near-critical grid images, and a lensed
  Milky Way background.
- Every spherical grid uses one of three radial colors: magenta inside,
  yellow at, and cyan outside the photon sphere. Rounded crown and key-light
  shading make the grid lines read as 3D pipes.
- The matching sphere skins show directional brushed grain, shallow procedural
  relief, key/fill lighting, and specular glints. Their inner and outer faces
  are fully opaque. The nearest sphere occludes deeper spheres and grids; its
  own matching grid remains visible on the surface. The separate Spheres control
  removes the material without changing the independent grid or sky settings.
- Close grazing views use exact line-segment/sphere roots, retain double
  crossings within one integration step, and apply a one-pixel tangent coverage
  fringe. The inspected close-up frames show continuous sphere/grid seams
  without the former staircase gaps.
- Disabling the sky produces a black background while preserving the grids.
- The near-photon-sphere tangent frame shows the expected stretching,
  straightening, and repeated shell images without an accretion disk.
- Lensing-off mode uses analytic straight ray/sphere intersections. The inspected
  frame shows ordinary concentric spheres, an undistorted equirectangular sky,
  and the much smaller geometric horizon silhouette.
- Grid crossings use local segment/sphere roots with tangent coverage; step
  refinement remains active throughout a widened band around every visible shell.

## Four station-band validation

The checks in this section were recorded on 29 July 2026 for the curved,
four-band station revision.

- The active station scene retains the CityBlock hull relief, procedural panels,
  side windows, and band-edge rails, then ends. Static inspection confirms that
  the rendered map contains no source cross-lattice pipes, radial cylinders, hub
  plates, ladder rails, central trusses, mast, or dishes.
- The folded spherical mapping centers exact geometry and material copies at
  latitudes `±0.1875` and `±0.5625` radians (`±10.7430°` and `±32.2289°`) on
  the photon sphere. Each nominal band spans `14.3239°`. The four edge ranges
  are `−39.3908°..−25.0669°`, `−17.9049°..−3.5810°`,
  `3.5810°..17.9049°`, and `25.0669°..39.3908°`.
- The nominal equatorial corridor and the two gaps between adjacent bands are
  all `7.1620°` wide. The equatorial separation is exactly half the preceding
  two-band revision's `14.3239°` gap.
- A frame-time uniform now drives one shared `0.015`-radian-per-second rotation
  about the bands' common polar axis. Static data-flow inspection confirms that
  all four copies pass through the same time-dependent transform. The resulting
  rotation period is `418.879020` seconds.
- The distance map and surface-material path both call the same rotating
  source-point helper. The dense gray panel grid, side-window grid, floor
  windows, material noise, and emissive noise therefore remain locked to their
  corresponding rotating geometry instead of being sampled in stationary world
  coordinates.
- Both shader and CPU stepping code use the same pair of sine-based angular-cone
  envelopes with a conservative `0.15`-radian half-angle. A deterministic
  100,000-point scan produced zero upper/lower mirror error, no nonfinite
  values, and a maximum central finite-difference gradient norm of
  `1.0000000127`, within numerical tolerance of the envelope's unit-Lipschitz
  bound. The equatorial and adjacent-gap midpoint envelope distance at the
  photon radius is `0.0699596M`, outside the exact-station evaluation threshold.
- The exact runtime marker replacement produced a 70,155-byte fragment shader
  with SHA-256
  `6a7a1553efdb67628569be3066b274c77c00f8e247c4c83ad099c0cf80b50ce5`.
  Static shader assembly found balanced delimiters, one injection marker, all
  referenced station functions defined, and no cross-lattice geometry in the
  active station scene.
- The supplied 1130 × 822, 30 FPS recording was sampled at six frames per
  second. Its large hull and domes remained comparatively stable while dense
  one-to-three-pixel greebles, panel boundaries, rails, and silhouettes crawled,
  identifying spatial and temporal undersampling rather than video compression
  as the dominant artifact.
- The station panel borders, layered panel density, periodic window grids, and
  four noise octaves now use screen-space derivative footprints to attenuate
  detail beyond the pixel Nyquist limit. High quality's render scale increased
  from `0.68` to `0.86`; Ultra increased from `0.90` to `1.00`.
- A 6,013-byte FXAA and temporal-resolve shader with SHA-256
  `0bece8d36f82b622d780e7d3b7484e52cf58676021c4dd6aca7d2f304ef81796`
  applies contrast-adaptive edge filtering, eight-phase sub-pixel jitter,
  neighborhood-clamped history, luminance and RGB-relative rejection, and
  frame-rate-normalized camera-motion rejection. Moving-station history is
  capped at `0.20`, and gaps above `0.12` seconds invalidate it. Three complete
  RGBA8 framebuffers passed mocked allocation, ping-pong, resolve, blit,
  moving-scene cap, long-gap rejection, and settings-invalidation sequencing at
  the recording's `1130 × 822` display size (`972 × 707` High render target).
- ANGLE's OpenGL ES 3.0 compiler accepted the exact runtime vertex shader,
  70,155-byte assembled scene fragment, and 6,013-byte FXAA fragment with empty
  compile logs. Both runtime programs linked successfully; the FXAA program's
  link log was empty.
- Deterministic camera simulations at 30, 60, and 144 Hz produced a maximum
  one-second movement-position spread of `1.9111 × 10⁻⁶M` and zero look-angle
  spread. After a 0.25-second input and 0.5-second release, residual speed was
  `4.0694 × 10⁻⁷M/s`; reset and pointer unlock removed all velocity, held-key,
  and target-orientation state. Horizon-contact testing remained outside
  `ρ = 0.535M` and removed inward residual velocity.
- The telemetry tracker uses one logarithmic areal-radius mapping over
  `2M`–`22M` for both landmarks and the live marker. The horizon evaluates to
  the exact left endpoint (`0%`), while the photon sphere and a live `3M`
  position both evaluate to `16.909208367%`.
- All three source JavaScript modules and the distribution Worker parse without
  syntax errors. All 18 source/distribution runtime file pairs are
  byte-identical.
  Local HTTP returned `200` for the source and distribution HTML, modules,
  shaders, sky texture, and four-band social card.
- The 1730 × 909 share image was inspected for exactly four curved
  neutral-metal bands, a centered black-hole shadow, a clear equatorial view,
  no protruding cross-lattice pipes, no radial spokes or center mast, and no
  text, logo, or watermark.
- No interactive browser pointer-lock, resize, or rendered-frame screenshot
  pass was performed for this revision; none is represented here as a success.

## 30 July temporal-reconstruction revision

This section supersedes the antialiasing, station-hit, and station-shadow
implementation measurements in the preceding historical record.

## Rotation control and softer camera response (30 July 2026)

- The station rotation control spans `0.0000` to `0.0150` radians per second,
  starts at the former fixed speed, and invalidates temporal history whenever
  it changes. Current and previous-frame station transforms use the same
  selected speed.
- Frame-rate-independent mouse-look response was reduced from `24` to `14`.
  Movement acceleration response was reduced from `12` to `7`, and
  deceleration response from `30` to `14`, producing longer, smoother starts,
  stops, and camera turns.

## Photon-sphere indicator and band phases (1 August 2026)

- A self-hosted Orbitron face is rasterized once into a mipmapped GPU label
  atlas. The translucent yellow `PHOTON SPHERE` inscription is sampled using
  longitude and latitude at the `3M` photon-shell crossing, so it bends around
  the sphere and follows both flat and lensed ray paths. Its control uses a
  frame-rate-independent exponential fade.
- The four station copies use widely stratified, deterministic pseudo-random
  longitudinal offsets: `1.731`, `14.487`, `27.926`, and `38.204` across the
  source ring's `52`-unit circumference. Geometry and material evaluation use
  the same transformed coordinates, preventing their panels, rails, and
  greebles from lining up between bands.
- Chrome 150's ANGLE OpenGL ES 3 compiler accepted and linked the exact
  `88,961`-byte assembled scene shader. The four wrapped phase gaps measure
  `12.756`, `13.439`, `10.278`, and `15.527` source units.
- Exterior longitude sampling is mirrored for left-to-right reading, while
  cameras inside `3M` use the opposite mapping. Opacity falls smoothly to zero
  from `0.95M` to `0.22M` away from the photon shell, hiding both unreadable
  close-range magnification and the orientation switch at the crossing. The
  atlas font size was reduced from `96` to `78` pixels, shrinking the measured
  label span from `1,052.2` to `853.4` of `2,048` atlas pixels. ANGLE accepted
  and linked the revised `89,430`-byte assembled scene shader.

- The supplied `1452 x 852`, 30 FPS recording contains 80 frames over
  `2.709313` seconds. Lensing is visibly disabled throughout. Registered
  close-up samples show roughly `6-14` pixels of station motion per frame.
  Edge neighborhoods occupy about `9.6%` of the analyzed patch but account for
  `38.9%` of luminance changes above 8/255; their mean absolute change is
  `19.2/255`, versus `2.19/255` in flat interiors. This localizes the dominant
  flicker to SDF silhouettes, seams, greebles, and shadow boundaries rather
  than video compression or the lensing integrator.
- Ten of 79 recorded frame transitions are near-identical holds followed by
  larger motion jumps. Antialiasing cannot synthesize missing presentation
  frames, so the revision also reduces ray-march instability and shadow cost
  instead of treating the issue as temporal filtering alone.
- The exact archived public API response for Shadertoy `X33BRn` is 110,800
  bytes with SHA-256
  `752c3a09addb84800f941d3ea6ae725e9051bc83951eaf11d70b758be0a0251b`.
  Its pass graph and behavior confirmed a 360-phase Halton sequence,
  previous-camera reprojection, Catmull-Rom history reconstruction,
  center-plus-cardinal variance clipping, 90% history, EASU, and a final RCAS
  pass. The WebGL implementation here was independently written and adds
  explicit motion for the genuinely rotating station.
- The station scene now refines accepted SDF intersections for six iterations,
  uses an `0.08`-pixel hit tolerance clamped to
  `0.00012M-0.0012M`, projects shading back toward the exact surface, and
  derives its normal epsilon from the ray footprint. CityBlock rounded details,
  roof ripple, and three micro-pipe families fade as a procedural cell drops
  through approximately 12 to 4 pixels. All material filtering uses the
  explicit ray footprint; no `fwidth` remains in the ray-march shaders.
- The former multiplicative, voxel-phase shadow trace is replaced by a
  deterministic 28-step soft SDF trace using a conservative `min(8d/t)`
  visibility bound. Ambient occlusion now accumulates four weighted geometric
  deficits rather than multiplying six discontinuous terms.
- In flat-ray mode, the scene uses 360 centered Halton samples and writes an
  RGBA8 previous-UV attachment. A station hit is transformed from its current
  rotating object space to its previous world position, then projected with
  the previous camera basis and FOV. The two UV coordinates use 16 bits each;
  100,001 deterministic samples produced a maximum normalized packing error of
  `1.5259022 x 10^-5`, or about `0.0222` pixel at the recording width. The
  reserved `(255,255,255,255)` invalid code does not collide with the `(1,1)`
  endpoint. A 10,000-point current/previous rotation check had maximum
  object-space round-trip error `6.66 x 10^-16`.
- The temporal pass reconstructs reprojected history with nine bilinear
  Catmull-Rom taps, clips it to current YCoCg mean/variance and min/max bounds,
  rejects luminance, chroma, depth, and large-motion mismatches, and uses up to
  90% history. Invalid or lensed motion falls back to contrast-adaptive spatial
  edge filtering. Lensed primary rays receive zero temporal jitter because a
  single pinhole inverse motion coordinate is not valid for multiple
  Schwarzschild images. A restrained RCAS-style pass presents the resolved
  image.
- High now renders at native device resolution; Ultra renders at `1.15x`.
  Medium rises to `0.78x`. Long gaps above `0.12` seconds, resizing, quality or
  scene-setting changes, reset, and visibility changes invalidate history.
- Chrome 150's WebGL-compatible ANGLE OpenGL ES 3.0 compiler accepted the exact
  280-byte vertex shader, 83,832-byte assembled scene fragment, 13,602-byte
  temporal fragment, and 2,528-byte RCAS fragment with empty compiler logs.
  All three programs linked with empty logs. The assembled scene SHA-256 is
  `218d7509c75dd5e3d0a97eb331a966dd2b55e0e1deaa313f2c2a8653e528205c`;
  temporal is
  `6cfb00511fb4dc17dd047b772e5b86d6e248918bf864fd02253a979d5642cfb8`;
  RCAS is
  `1e37cb63dcba5ed50db87870cedf78248719adab2e94446fed2487277fecc164`.
  All 36 active uniforms match their JavaScript setters and sampler units, and
  the scene's output locations match the two MRT attachments.
- A 160 x 90 three-frame ANGLE runtime smoke completed the full
  scene-MRT -> temporal-history -> RCAS chain. The scene MRT, both history
  targets, and default framebuffer were complete; every pass and readback
  returned zero GL errors. The warm-up frame used zero jitter and invalid
  motion, followed by Halton `(0,-1/6)` and `(-0.25,1/6)` with all 14,400
  pixels carrying valid motion in the static-camera test. Station depth was
  already present on the warm-up frame. Decoded static motion stayed within
  `0.006218` pixel per axis, with `0.000816`-pixel frame-two RMS error.
- All three source and distribution JavaScript modules and the distribution
  Worker parse successfully. All 19 source/distribution runtime file pairs are
  byte-identical, including the new RCAS shader. Local source and distribution
  servers each returned HTTP `200` for the HTML, stylesheet, three modules,
  five shader resources, and the 4K sky texture.

The simulation remains an educational real-time approximation. The thinnest
critical set can exhaust even the Ultra budget and is handled with a stable,
impact-parameter-aware fallback instead of being allowed to stall the GPU.

## Canvas recording (1 August 2026)

- The WebGL canvas is captured directly at `60 fps` through `captureStream()`
  and encoded at a requested `16 Mbps`. H.264 MP4 profiles are preferred,
  followed by generic MP4, VP9 WebM, VP8 WebM, and generic WebM.
- Recording uses one continuous `MediaRecorder` segment for reliable MP4
  finalization. Stopping releases the capture track, downloads a timestamped
  file, reports its final size, and leaves the renderer running throughout.

## Black-hole-relative locomotion (1 August 2026)

- Locomotion now uses an orthonormal basis derived only from camera position:
  inward radial motion for W/S, azimuthal motion for A/D, and polar tangent
  motion for Space/C. Mouse yaw and pitch do not enter the travel basis.
- Mouse-look response was reduced from `14` to `8.5`. Movement acceleration
  response was reduced from `7` to `4.5`, and deceleration response from `14`
  to `7`, lengthening all three frame-rate-independent easing curves.
- Identical W input at two unrelated yaw angles produced zero target-velocity
  difference. W's normalized inward alignment measured `1.000000025`, while
  D's radial dot product was exactly zero in the deterministic camera check.

## Production-render implementation checks (2 August 2026)

This section records only checks actually performed for the camera-track and
offline PNG implementation. Historical browser/GPU results above do not count
as validation of the new production framebuffer path.

### Automated camera-track and source checks

Command:

```powershell
node --test tests/*.test.mjs
```

Observed result: **14/14 tests passed**. The test set covered:

- camera-basis/quaternion round trips and the `+179°` to `-179°` shortest arc;
- real fake-clock recorder timing and JSON save/parse/validation endpoints;
- time-aware smoothed interpolation under deliberately uneven sample spacing;
- exact first/last states, 1,001 samples of an antipodal near-guard path, and
  fallback from an unsafe smoothed station position toward its raw segment;
- strict settings/non-finite rejection;
- the half-open 30 fps frame policy (`1.0 s` produces frames `0..29`);
- deterministic, zero-centred 1/4/8/16-sample Hammersley patterns;
- one station-shader injection marker, balanced assembled shader delimiters,
  expected linear accumulation/resolve operations, bindings for every declared
  scene/production uniform, fixed-profile UI text, and
  absence of `MediaRecorder`, `captureStream` and `requestAnimationFrame` from
  the dedicated production-renderer module.

All changed JavaScript modules also passed `node --check`. A regex-based DOM
contract scan found 67 unique IDs, no duplicate ID, and no missing ID among the
47 `querySelector("#…")` references in `main.js`. `git diff --check` reported no
whitespace errors (only the repository's existing LF-to-CRLF checkout notices).

### Local HTTP resource check

VS Code Live Server was already listening at `127.0.0.1:5501`. `HEAD` requests
returned HTTP `200` for the source HTML/CSS, all five JavaScript modules, the
scene/station/FXAA/RCAS/fullscreen shaders, both new production shaders, and the
8,228,817-byte sky JPEG. The added SVG favicon also removes the previous
automatic `/favicon.ico` 404 when the current HTML is used.

### FFmpeg helper

Command:

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
python -B -m unittest discover -s tools\tests -v
```

Observed result: **7/7 tests passed**. This included a real three-frame
2560 × 1440 PNG sequence, a real `libx264` encode, and FFprobe validation. The
observed stream was H.264 High Profile, 2560 × 1440, 30/1 fps, progressive
`yuv420p`, limited-range BT.709, exactly 3 frames and 0.1 seconds. The source
PNGs remained present. Negative tests rejected partial manifests, wrong output
dimensions, missing frames, wrong PNG IHDR dimensions and incompatible probe
metadata.

### Browser/GPU validation status

The browser-control runtime reported no connected browser (`[]`) on 2 August
2026. Per the browser-control safety rules, no unrelated automation backend was
substituted. Consequently, the following required checks have **not yet been
represented as successful** in this record:

- browser WebGL2 compilation/linking of the revised scene and two production
  shaders;
- an actual RGBA16F 2560 × 1440 framebuffer allocation and zero-error readback;
- recording, saving, loading and visually previewing a real interactive track;
- an actual browser-produced 2560 × 1440 PNG or 30-frame production sequence;
- same-frame raw-pixel hash equality after viewport/zoom changes;
- full-resolution orientation/colour inspection and 1-sample versus 8-sample
  edge comparison;
- cancellation/resume and repeated-session GPU-memory checks in Chromium.

The implementation must not be described as browser-validated or production-
export validated until those checks are completed on the target Chromium/RTX
system. The **Test first 30** UI action is the intended first acceptance run.
