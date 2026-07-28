# Validation record

Validation was performed on 28 July 2026 against the finished source.

## Runtime and rendering

- Served the project over local HTTP and confirmed `200` responses for the HTML,
  stylesheet, all three JavaScript modules, both fetched shader files, and the
  local sky texture.
- Parsed every JavaScript module as an ES module without syntax errors.
- Compiled and linked the same vertex and fragment shader logic in a standalone
  OpenGL 3.3 context after changing only the GLSL version line and removing the
  WebGL precision declarations.
- Rendered and inspected exterior, elevated equatorial-plane, spheres-only,
  sphere-disabled, sky-disabled, and tracks-only frames on an NVIDIA GeForce
  RTX 4070 Laptop GPU.
- The High profile's 960 × 600 offscreen shader frame with the sky, grids, and
  tracks enabled took approximately 5.0 ms. Enabling the textured sphere skins
  raised the same view to approximately 15.3 ms.
  These are indicative GPU timings and exclude browser composition.
- The 6000 × 3000 local JPEG was decoded, uploaded, mipmapped, and sampled with
  horizontal wrapping during those render checks.
- The attached browser pool was unavailable, so an actual browser-console and
  pointer-lock interaction pass could not be completed in this session. The
  event wiring and error paths were inspected statically; this limitation is
  not represented as a successful browser test.

## Numerical optics

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

## Visual checks

- The exterior frame shows eight nested spherical latitude/longitude grids,
  a black captured-ray region, repeated near-critical grid images, and a lensed
  Milky Way background.
- Every spherical grid uses one of three radial colors: magenta inside,
  yellow at, and cyan outside the photon sphere. Rounded crown and key-light
  shading make the grid lines read as 3D pipes.
- The matching sphere skins show directional brushed grain, shallow procedural
  relief, key/fill lighting, and specular glints. Their inner and outer faces
  are fully opaque. The nearest sphere occludes all deeper spheres, grids, and
  tracks; its own matching grid remains visible on the surface. The separate
  Spheres control removes the material without changing the independent grid,
  track, or sky settings.
- Close grazing views use exact line-segment/sphere roots, retain double
  crossings within one integration step, depth-order equatorial track events,
  and apply a one-pixel tangent coverage fringe. The inspected close-up frames
  show continuous sphere/grid seams without the former staircase gaps.
- The elevated plane frame shows opaque circular equatorial tracks in the same
  three-color classification. The yellow photon-sphere track separates the
  inward and outward sets, and all repeated or straightened images arise from
  the integrated ray paths.
- Disabling the sky produces a black background while preserving the grids and
  tracks; disabling tracks removes the equatorial plane independently.
- The near-photon-sphere tangent frame shows the expected stretching,
  straightening, and repeated shell images without an accretion disk.
- Lensing-off mode uses analytic straight ray/sphere intersections. The inspected
  frame shows ordinary concentric spheres, an undistorted equirectangular sky,
  and the much smaller geometric horizon silhouette.
- Grid crossings use local segment/sphere roots with tangent coverage; step
  refinement remains active throughout a widened band around every visible shell.

The simulation remains an educational real-time approximation. The thinnest
critical set can exhaust even the Ultra budget and is handled with a stable,
impact-parameter-aware fallback instead of being allowed to stall the GPU.
