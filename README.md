# Schwarzschild Field VR

A framework-free WebGL2 and WebXR black-hole simulation aimed at PC VR with a
Meta Quest 3 over Quest Link or Air Link. It retains the live Schwarzschild
optical ray integration and ESO Milky Way panorama, but replaces the former
Dyson-ring scene with one inexpensive double band at the photon sphere.

This branch deliberately contains no cinematic timeline or recording system.
It is a focused interactive prototype: stereoscopic black-hole optics and head
tracking. The current VR experiment deliberately uses one fixed position just
outside the photon sphere.

## Requirements

- A Windows PC with a discrete GPU. The current target machine uses an NVIDIA
  RTX 4070 Ti SUPER.
- Meta Quest 3 connected through Quest Link or Air Link.
- Meta Quest Link selected as the active OpenXR runtime.
- A current hardware-accelerated Chrome or Edge build with WebXR enabled.
- HTTPS for a hosted build, or `localhost` for local development.

This is not tuned as a standalone Quest browser build. The per-eye ray
integration is intentionally performed on the PC GPU and streamed to the
headset through Quest Link.

## Run locally

From the project directory:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/` in Chrome or Edge. Do not open `index.html` as a
`file://` URL; the shaders and panorama are fetched as separate assets.

For VR:

1. Start Meta Quest Link or Air Link and enter the PC environment in the headset.
2. Open the simulation in the desktop browser.
3. Wait for `Quest Link detected`, then select **Enter Quest 3 VR**.
4. If the page initially says `Check Quest Link`, connect the headset and use
   that button once to refresh support detection, then enter VR on the next click.

## Controls

Quest Touch:

- The controllers are intentionally inactive in this fixed-position test.
- Head rotation remains fully tracked.
- The two eye positions and small room-scale head translations remain distinct.
- The fixed viewpoint is at Schwarzschild areal radius `r = 3.25M`, just
  outside the photon sphere at `r = 3M`.

Desktop fallback:

- W / S: radial in / out.
- A / D: orbit left / right.
- Space / C: polar up / down.
- Shift: boost.
- Mouse: look after clicking the field.
- R: reset; H: hide or restore the interface; Escape: release pointer lock.

Desktop locomotion is unchanged. It is not used by the current VR path.

## What is rendered

The mass is `M = 1` with `G = c = 1`. The event horizon is at Schwarzschild
areal radius `r = 2M`. The photon sphere is at `r = 3M`, corresponding to
isotropic radius `rho = (2 + sqrt(3))M/2`.

The double band is an analytic crossing on that one photon-radius sphere. Its
two members are centered at spherical latitudes `+/-0.1875` radians and share
an open equatorial gap. There is no distance-field city, hub, spokes, mast, or
nested-ring geometry. Gravitational lensing can show several apparent arcs of
the same physical pair; those are repeated optical images, not extra bands.

The sky is the complete locally stored 6000 x 3000 ESO/S. Brunier panorama.
On a capable desktop GPU it is uploaded at full resolution with mipmapping.
Its linear brightness is reduced to 50% in this branch; the source texture is
not downsampled.

## Rendering path and performance

Each desktop pixel still launches a three-dimensional ray through the isotropic
Schwarzschild optical geometry and advances it with midpoint/RK2 integration.
The desktop renderer therefore remains a useful live reference.

The immersive renderer no longer integrates rays per pixel. An offline build
step traces the rays into a 4096 by 35 floating-point transfer table spanning
the small range of isotropic radii reachable by eye separation and normal head
lean around the fixed `r = 3.25M` center. For each WebXR eye, the shader uses
that eye's real pose and asymmetric projection to obtain an initial world ray.
Spherical symmetry reduces the lookup to camera radius and radial ray angle;
the shader then reconstructs the outgoing star direction and photon-sphere
crossing in that eye's own black-hole-centered plane. This preserves genuine
stereo disparity rather than displaying a flat baked panorama.

The XR fragment shader contains no ray loop and no optical-force evaluation.
Its main work is two nearest-neighbor float-table reads, one sky lookup, and
optional double-band shading. The conservative 0.42 framebuffer scale and 0.65
requested foveation are retained for this first diagnostic. The app requests
the lowest supported refresh rate at or above 72 Hz and reports app FPS,
slow-frame percentage, and actual per-eye viewport once per second. The last
sample remains visible after exiting VR.

## Scope and limitations

- Light propagation is an educational approximation, not a precision
  general-relativity solver. The fixed VR table is finite and nearest-sampled,
  so the thinnest near-critical images can alias.
- VR controller locomotion is disabled. The lookup clamps head motion outside
  its precomputed radial interval rather than supporting free flight.
- The camera is clamped outside the horizon and there is no modeled interior.
- The double band is an illustrative surface treatment, not a structural model.
- The sky is treated as infinitely distant once a ray escapes the strong field.
- Both live-integration headset profiles entered VR but remained very laggy.
  The lookup-table build still requires a physical Quest 3 re-test; if it is
  also slow, the dominant problem is probably outside the ray integrator.

See [ASSET_SOURCE.md](ASSET_SOURCE.md) for attribution and
[VALIDATION.md](VALIDATION.md) for the exact checks and remaining headset gate.
