# Schwarzschild Optical Field

A framework-free, real-time WebGL2 visualization of light propagation around a
nonrotating Schwarzschild black hole. The scene contains no accretion disk:
everything visible is the lensed sky, shaded spherical reference skins,
spherical coordinate grids, or optional circular tracks on the equatorial plane.

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

The instrument panel controls RK2 integration quality, base ray step, flight
speed, field of view, grid brightness, shell count, exposure, saturation, and
the internal render resolution. Lensing, shaded spheres, spherical grids, the
sky sphere, and the equatorial tracks can each be disabled independently.

## What the radii mean

The mass is set to `M = 1` with `G = c = 1`. The event horizon is at the
Schwarzschild areal radius `r = 2M`; rays reaching a small numerical margin
outside its isotropic-coordinate radius `ρ = M/2` are captured and returned
black. The highlighted yellow grid and track mark the photon sphere at `r = 3M`, or
`ρ = (2 + √3)M/2`. It is not the horizon.

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
coverage fringe smooths exact silhouettes, so sphere, grid, and track edges do
not form staircase gaps while all distortion still comes from the integrated
optical paths.

The grid pipes use a deliberately limited radial palette: magenta inside the
photon sphere, yellow at the photon sphere, and cyan outside it. Their rounded
cross-section is shaded in world space so the lines read as luminous 3D tubes
rather than flat screen-space strokes.

The optional sphere skins share those radii and colors. Procedural brushed
grain, shallow relief, key and fill lights, restrained highlights, and stronger
silhouette shading establish surface direction and depth. Both the inner and
outer faces are fully opaque. The `Spheres` and `Grids` switches are independent;
switching `Spheres` off restores the unfilled grid view.

The equatorial reference plane is sampled at ray crossings and contains opaque
circular tracks in that same three-color palette. The yellow `r = 3M` track is
the circular null-geodesic threshold: viewed through the optical geometry, it
marks where the apparent turning behavior changes. The tracks are coordinate
guides, not orbiting matter.

## Quality and performance

`High` is the default and uses 416 RK2 steps with a 68% internal render scale.
It targets smooth real-time interaction at 1080p on an RTX 4070-class GPU.
`Low` and `Medium` reduce both ray budget and pixel count. `Ultra` raises the
budget to 896 steps and a 90% internal render scale; it is intended for screenshots
or powerful GPUs. Critical rays that still exhaust the budget are darkened
gracefully, and the status display reports when sampled view rays hit the cap.

## Approximations

- Camera movement is intentionally Euclidean and is not a massive-particle geodesic.
- The renderer illustrates Schwarzschild null optics qualitatively; it is not a
  precision relativity solver.
- Finite step size and finite escape radius cause small drift in extremely long
  near-critical orbits.
- Grid emission is an artistic visualization aid and does not model radiative transfer.
- The equatorial tracks are idealized opaque reference marks, not an accretion disk.
- The sphere skins are visualization surfaces, not physical matter around the hole.
- Camera motion stops at a numerical guard outside the horizon; there is no
  modeled interior region.
- The star field is treated as infinitely distant once a ray exits the strong-field region.

See [ASSET_SOURCE.md](ASSET_SOURCE.md) for the locally stored sky-map attribution.
Measured numerical and GPU checks are recorded in [VALIDATION.md](VALIDATION.md).
