# Schwarzschild Optical Field

A framework-free, real-time WebGL2 visualization of light propagation around a
nonrotating Schwarzschild black hole. The scene contains no accretion disk:
everything visible is the lensed sky, shaded spherical reference skins,
spherical coordinate grids, or four optional ray-marched orbital-station bands
curved around the photon sphere.

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
- W / S: forward and backward
- A / D: strafe
- Space / C (or E / Q): rise and fall
- Shift: flight-speed boost
- R: reset the camera
- H: hide or restore the interface
- Escape: release pointer lock
- Station rotation: continuously adjusts the four bands from stopped to the
  original `0.015`-radian-per-second speed
- Photon label: fades a translucent yellow Orbitron `PHOTON SPHERE` inscription
  in or out on the equator of the lensed photon-sphere surface; its reading
  direction automatically reverses when the camera crosses inside

The instrument panel controls RK2 integration quality, base ray step, flight
speed, station rotation, field of view, grid brightness, shell count, exposure,
saturation, and
the internal render resolution. Lensing, shaded spheres, spherical grids, the
sky sphere, and the orbital-station structure can each be disabled
independently. The station control is labeled `Station bands` in the interface.
Sphere skins start disabled so the enclosed station is visible on first load.

## What the radii mean

The mass is set to `M = 1` with `G = c = 1`. The event horizon is at the
Schwarzschild areal radius `r = 2M`; rays reaching a small numerical margin
outside its isotropic-coordinate radius `ρ = M/2` are captured and returned
black. The highlighted yellow grid and orbital-station bands share the
photon-sphere radius `r = 3M`, or `ρ = (2 + √3)M/2`. It is not the horizon.

The apparent black shape is the captured-ray region, commonly called the black
hole shadow. Its boundary is not a directly rendered solid event-horizon
surface: lensing and the photon sphere make the shadow appear larger than the
physical horizon. The flight camera is deliberately clamped just outside
`ρ = M/2`, so this visualization does not currently allow travel through the
horizon.

The other grid shells are placed at areal radii
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

Grid lines are evaluated only where an integrated ray crosses a shell.
Crossings are solved against each local RK2 ray segment, including both roots
when a near-tangent segment enters and exits the same sphere. A one-pixel
coverage fringe smooths exact silhouettes, so sphere and grid edges do not form
staircase gaps while all distortion still comes from the integrated optical
paths.

The grid pipes use a deliberately limited radial palette: magenta inside the
photon sphere, yellow at the photon sphere, and cyan outside it. Their rounded
cross-section is shaded in world space so the lines read as luminous 3D tubes
rather than flat screen-space strokes.

The optional sphere skins share those radii and colors. Procedural brushed
grain, shallow relief, key and fill lights, restrained highlights, and stronger
silhouette shading establish surface direction and depth. Both the inner and
outer faces are fully opaque. The `Spheres` and `Grids` switches are independent;
switching `Spheres` off restores the unfilled grid view.

Four opaque procedural station bands curve along the photon sphere at areal
radius `r = 3M`, corresponding to isotropic radius `ρ/M = 1.86602540`. Their
fragment-shader scene adapts the ring map from morimea's CC0
[*\[TAA\] Orbital Megastructure*](https://www.shadertoy.com/view/X33BRn).
The source radius `8` is scaled by `ρphoton / 8`. A folded spherical-latitude
mapping creates exact mirrored copies centered at `±0.1875` and `±0.5625`
radians (`±10.74°` and `±32.23°`), each spanning about `14.32°`. The clear
equatorial corridor and both gaps between adjacent bands are each about
`7.16°` wide. All four bands rotate together about their shared polar axis at
`0.015` radians per second, completing one revolution in about 7 minutes. The
distance-field geometry and all procedural panel, window, and surface-noise
coordinates use the same rotating object-space transform.

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
disables all four bands independently of spheres and grids. Because sphere
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

Keyboard movement eases gradually toward and away from its target velocity,
while mouse look uses a softer target-orientation response. Both use
frame-rate-independent exponential responses; reset, focus loss, and
pointer-lock transitions cancel residual motion safely.

## Quality and performance

`High` is the default and uses 416 RK2 steps at native device resolution up to
its 2.6-megapixel safety cap.
It targets smooth real-time interaction at 1080p on an RTX 4070-class GPU.
`Low` and `Medium` reduce both ray budget and pixel count. `Ultra` raises the
budget to 896 steps and a 115% internal render scale; it is intended for
screenshots or powerful GPUs. Critical rays that still exhaust the budget are
darkened gracefully, and the status display reports when sampled view rays hit
the cap.

## Approximations

- Camera movement is intentionally Euclidean and is not a massive-particle geodesic.
- The renderer illustrates Schwarzschild null optics qualitatively; it is not a
  precision relativity solver.
- Finite step size and finite escape radius cause small drift in extremely long
  near-critical orbits.
- Grid emission is an artistic visualization aid and does not model radiative transfer.
- The orbital station is an artistic visualization structure, not an accretion
  disk or a model of self-supporting matter.
- The sphere skins are visualization surfaces, not physical matter around the hole.
- Camera motion stops at a numerical guard outside the horizon; there is no
  modeled interior region.
- The star field is treated as infinitely distant once a ray exits the strong-field region.

See [ASSET_SOURCE.md](ASSET_SOURCE.md) for the locally stored sky-map attribution.
Measured numerical and GPU checks are recorded in [VALIDATION.md](VALIDATION.md).
