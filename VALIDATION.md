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

The simulation remains an educational real-time approximation. The thinnest
critical set can exhaust even the Ultra budget and is handled with a stable,
impact-parameter-aware fallback instead of being allowed to stall the GPU.
