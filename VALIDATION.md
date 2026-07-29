# Validation record

The baseline measurements below were recorded on 28 July 2026. The
numerical-optics section remains the baseline for the unchanged ray equation.
The final section records the 29 July 2026 source, geometry, envelope, compile,
distribution, HTTP, and share-image checks for the twin station-band revision.

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

## Twin station-band validation

The checks in this section were recorded on 29 July 2026 for the curved,
mirrored station-band revision.

- The active station scene retains the CityBlock hull relief, procedural panels,
  side windows, edge rails, and cross-lattice, then ends. Static inspection
  confirms that the active scene no longer calls the source radial cylinders,
  hub plates, ladder rails, central trusses, mast, or dishes.
- The folded spherical mapping centers exact geometry and material copies at
  latitudes `±0.25` radians (`±14.3239°`) on the photon sphere. Each nominal
  band spans `14.3239°`, with inner edges at `±7.1620°` and outer edges at
  `±21.4859°`. The resulting nominal equatorial corridor is `14.3239°` wide,
  or approximately `0.46529M` between inner edges at the photon radius.
- Both shader and CPU stepping code use the same sine-based angular-cone
  envelope with a conservative `0.19`-radian half-angle. A deterministic
  100,000-point scan produced zero upper/lower mirror error, no nonfinite
  values, and a maximum central finite-difference gradient norm of
  `1.0000000105`, within numerical tolerance of the envelope's unit-Lipschitz
  bound. The equatorial envelope distance at the photon radius is
  `0.11189436M`, safely outside the exact-station evaluation threshold.
- The exact runtime marker replacement produced a 67,838-byte fragment shader
  with SHA-256
  `97a17441963c75deb956f2b33a941b36ccc2d370a53515618a2e305f2670db54`.
  Chrome 150's ANGLE OpenGL ES 3.0 implementation compiled the vertex and
  assembled fragment shaders and linked the program successfully with empty
  compiler and linker logs. A headless WebGL2 startup smoke test also reached
  `6000×3000 sky loaded · optics stable`.
- All three source JavaScript modules and the distribution Worker parse without
  syntax errors. Static shader assembly found balanced delimiters, one injection
  marker, all 49 referenced station functions defined, and no off-ring geometry
  tokens in the active station scene.
- All 16 source/distribution runtime file pairs are byte-identical. Local HTTP
  returned `200` for the source and distribution HTML, modules, shaders, sky
  texture, and new station-band social card.
- The 1730 × 909 share image was inspected for exactly two curved neutral-metal
  bands, a centered black-hole shadow, a fully clear equatorial corridor, no
  radial spokes or center mast, and no text, logo, or watermark.
- No interactive pointer-lock, resize, or rendered-frame screenshot pass was
  performed for this revision; none is represented here as a success.

The simulation remains an educational real-time approximation. The thinnest
critical set can exhaust even the Ultra budget and is handled with a stable,
impact-parameter-aware fallback instead of being allowed to stall the GPU.
