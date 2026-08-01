# Schwarzschild Optical Field

A framework-free, real-time WebGL2 visualization of light propagation around a
nonrotating Schwarzschild black hole. The scene contains no accretion disk:
everything visible is the lensed sky, optional shaded spherical reference
skins, the photon-sphere label, or three ray-marched Dyson doublets curved
around nested spherical radii.

## Run it

1. Open this folder in VS Code.
2. Install the **Live Server** extension if needed.
3. Right-click `index.html` and choose **Open with Live Server**.
4. Use a current Chrome, Edge, or Firefox build with hardware acceleration enabled.

The shader files and local sky texture are loaded with `fetch()`, so opening
`index.html` directly as a `file://` URL is intentionally unsupported.
If the console reports `ERR_CONNECTION_REFUSED` for every shader as well as
`styles.css`, the local Live Server process or its port has stopped; restart
Live Server and use the newly reported local URL. That message occurs before
GLSL compilation and is not a shader error. The renderer retries transient
shader and sky requests for several seconds and provides a `Retry startup`
button if the server remains unavailable. WebGL2 context creation also retries
once with compatibility-oriented power settings before reporting a driver
failure.

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
- Station rotation: continuously adjusts all three doublets from stopped to
  the original `0.015`-radian-per-second speed
- Photon label: fades a translucent yellow Orbitron `PHOTON SPHERE` inscription
  in or out on the equator of the lensed photon-sphere surface; its reading
  direction automatically reverses when the camera crosses inside
- Record MP4: captures the WebGL field at 60 fps and downloads one continuous
  editor-friendly recording; browsers without MP4 encoding fall back to WebM

The instrument panel controls RK2 integration quality, base ray step, flight
speed, station rotation, field of view, shell count, exposure, saturation, and
the internal render resolution. Lensing, shaded spheres, the sky sphere, and
the orbital-station structure can each be disabled
independently. The station control is labeled `Station bands` in the interface.
Sphere skins start disabled so the enclosed station is visible on first load.

## What the radii mean

The mass is set to `M = 1` with `G = c = 1`. The event horizon is at the
Schwarzschild areal radius `r = 2M`; rays reaching a small numerical margin
outside its isotropic-coordinate radius `ρ = M/2` are captured and returned
black. The photon-sphere label and middle Dyson doublet share the radius
`r = 3M`, or `ρ = (2 + √3)M/2`; the other two doublets sit immediately outside
and inside it. The photon sphere is not the horizon.

The apparent black shape is the captured-ray region, commonly called the black
hole shadow. Its boundary is not a directly rendered solid event-horizon
surface: lensing and the photon sphere make the shadow appear larger than the
physical horizon. The flight camera is deliberately clamped just outside
`ρ = M/2`, so this visualization does not currently allow travel through the
horizon.

The optional reference-sphere shells are placed at areal radii
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
photon sphere, and shell crossings, then grows in the far field. A hard quality
budget prevents near-critical rays from stalling the GPU.

Optional sphere crossings are solved against each local RK2 ray segment,
including both roots when a near-tangent segment enters and exits the same
sphere. A one-pixel coverage fringe smooths exact silhouettes while all
distortion still comes from the integrated optical paths.

The optional sphere skins use magenta inside the photon sphere, yellow at the
photon sphere, and cyan outside it. Procedural brushed
grain, shallow relief, key and fill lights, restrained highlights, and stronger
silhouette shading establish surface direction and depth. Both the inner and
outer faces are fully opaque. The `Spheres` switch removes these reference
materials independently of the Dyson construction.

Three opaque procedural Dyson doublets—six bands total—curve around nested
spherical radii. The middle doublet sits at the photon sphere,
`ρ/M = 1.86602540` (`r = 3M`). The outer and inner doublets sit at
`ρphoton ± 0.30M`, corresponding to areal radii about `3.2814M` and `2.7257M`.
Their fragment-shader scene adapts the ring map from morimea's CC0
[*\[TAA\] Orbital Megastructure*](https://www.shadertoy.com/view/X33BRn).
The source radius `8` is scaled by `ρphoton / 8`. A folded spherical-latitude
mapping gives every assembly two bands centered at latitudes `±0.1875`
radians (`±10.74°`) with a clear shared equator. All three nested doublets use
the same 0° plane and rotate about their common polar axis at up to `0.015`
radians per second, completing one revolution in about 7 minutes. Their
procedural phases remain independently staggered, so the panels, windows, and
greebles do not line up across radii.

The adaptation retains the source CityBlock hull relief, dense procedural panel
material, band-edge rails, material IDs, noise, finite-difference normals,
ambient occlusion, and directional shadowing. Surface hits are refined before
shading, normal and shadow tolerances follow the projected pixel footprint, and
sub-pixel CityBlock pipes and roof details fade into the macro hull instead of
alternating between hit and miss from frame to frame. The protruding
cross-lattice pipes, four center-facing spokes, central hub, ladder struts,
communications mast, and repeated dishes are omitted. Camera, Earth,
temporal-antialiasing, and post-processing code from the Shadertoy are not
copied; the Schwarzschild camera, lensed sky, and tone mapper remain in control.
The original project's rendering strategy informed the independently
implemented anti-aliasing pipeline described below. The `Station bands` switch
disables all six bands independently of spheres. Because sphere
skins are opaque, an enabled skin naturally occludes station geometry behind
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

## Quality and performance

`Medium` is the safe default and uses 320 RK2 steps at a `0.78` render scale up
to a 1.5-megapixel cap. `High` uses 416 steps up to 2 megapixels, while `Ultra`
raises the budget to 896 steps and a 115% internal scale capped at 3
megapixels; both remain opt-in for stronger GPUs. The decoded sky panorama is
resampled to at most `3072 × 1536` before its mipmapped GPU upload, cutting the
largest startup allocation by about 68 MiB while preserving filtered sky
detail. If the browser resets the WebGL context, rendering stops cleanly,
rebuilds every GPU resource at Low quality, and resumes after restoration.
Critical rays that still exhaust the integration budget are darkened
gracefully, and the status display reports when sampled view rays hit the cap.

## Approximations

- Camera movement is intentionally Euclidean and is not a massive-particle geodesic.
- The renderer illustrates Schwarzschild null optics qualitatively; it is not a
  precision relativity solver.
- Finite step size and finite escape radius cause small drift in extremely long
  near-critical orbits.
- The orbital station is an artistic visualization structure, not an accretion
  disk or a model of self-supporting matter.
- The sphere skins are visualization surfaces, not physical matter around the hole.
- Camera motion stops at a numerical guard outside the horizon; there is no
  modeled interior region.
- The star field is treated as infinitely distant once a ray exits the strong-field region.

See [ASSET_SOURCE.md](ASSET_SOURCE.md) for the locally stored sky-map attribution.
Measured numerical and GPU checks are recorded in [VALIDATION.md](VALIDATION.md).
