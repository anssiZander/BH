# Validation record

The measurements below were recorded on 28 July 2026. The numerical-optics
section remains the baseline for the unchanged ray equation. The final section
records the fresh compile, render, seam, opacity, toggle, source/distribution,
HTTP, and performance pass for the replacement orbital-station geometry.

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

## Orbital-station validation

- `shaders/orbital_station.glsl` contains the complete active CC0 station map
  from Shadertoy `X33BRn`, with namespaced symbols and a world wrapper. The
  CityBlock branches, panels, rails, cross-lattice, four spokes, hub, ladder
  struts, communications truss, repeated dishes, packed material IDs, noise,
  six-sample ambient occlusion, and 40-step source shadow method are active.
- The source ring radius `8` is uniformly scaled by
  `PHOTON_RHO / 8 = 0.233253175`, without translation or axis rotation. The
  black hole therefore remains at the original station hub and the sole
  cylindrical ring is centered at isotropic photon radius
  `ρ = 1.8660254038M`.
- A 512-sample SDF scan away from the spoke axes at `y = 0.08M` found occupied
  ring material only over `ρ = 1.8406738M` through `1.8939941M`, with the
  deepest sample at `1.8673340M`. Distances at the superseded inner and outer
  band radii were positive (`0.39590M` at `1.30901699M` and `0.48830M` at
  `2.39564392M`), confirming that no extra concentric station bands remain.
- The assembled source shader compiled and linked in a standalone OpenGL 3.3
  context after only the version/precision compatibility conversion. A
  separate station-material probe was finite across all sampled pixels and
  returned the expected active material families.
- Lensed, flat, elevated, edge-on, outer-face, inner-face, grazing, and close
  frames were inspected. They show one broad, flat cylindrical station with
  the source's dense physical surface relief and sparse service colors, rather
  than the retired pipe-like or radius-colored approximations.
- A close frame centered on the `atan` longitude seam shows continuous hull,
  panels, rail, and shading. Axis and radial diagnostic evaluations were
  finite; explicit zero-length normalization guards cover the two singular
  procedural-normal cases.
- Station hits are fully opaque and retain first-hit depth ordering. Close
  grid/station and opaque-sphere/station frames show nearer surfaces retained
  and farther ones rejected without the former translucent overlap fringe.
- With black sky and grids/spheres disabled, the warmed 960 × 600 lensed
  station frame contained 17,898 nonblack pixels. Turning `uRingsVisible` off
  produced zero nonblack pixels and changed exactly those 17,898 pixels. Static
  inspection confirms the independent
  `ringsVisibleInput` -> setting -> `uRingsVisible` chain.
- On the NVIDIA GeForce RTX 4070 Laptop GPU, warmed standalone medians at
  960 × 600 were approximately `10.81 ms` for the lensed station alone and
  `18.94 ms` for the default lensed grids, sky, and station. These timings
  exclude browser composition.
- The new 1200 × 630 photon-station social card was inspected for one ring,
  four spokes, neutral materials, centered black-hole shadow, absence of text,
  and absence of extra bands.
- Source and distribution HTML, CSS, three JavaScript modules, three shader
  files, the sky texture, and the photon-station social card are byte-identical.
  All source/distribution modules plus the Worker entry parsed successfully as
  ES modules. Local HTTP returned `200` for every one of those runtime assets
  from both the source and distribution roots.
- The attached browser pool was empty after one documented connection retry, so
  a real browser-console, pointer-lock, resize, and control-interaction pass
  remains an explicitly recorded environment limitation rather than a claimed
  success. The production URL and asset responses are checked after publish.

The simulation remains an educational real-time approximation. The thinnest
critical set can exhaust even the Ultra budget and is handled with a stable,
impact-parameter-aware fallback instead of being allowed to stall the GPU.
