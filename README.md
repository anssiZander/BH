# Schwarzschild Field VR

A framework-free WebGL2 and WebXR black-hole simulation aimed at PC VR with a
Meta Quest 3 over Quest Link or Air Link. It retains the live Schwarzschild
optical ray integration and ESO Milky Way panorama, but replaces the former
Dyson-ring scene with one inexpensive double band at the photon sphere.

This branch deliberately contains no cinematic timeline or recording system.
It is a focused interactive prototype: stereoscopic black-hole optics, head
tracking, and controller locomotion.

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

- Left stick vertical: move radially toward or away from the black hole.
- Left stick horizontal: orbit azimuthally at constant black-hole-centered radius.
- Right stick vertical: move toward either pole.
- Either grip: boost movement speed.
- A or X: reset position.
- Head movement and rotation: natural stereo view and limited room-scale offset.

Desktop fallback:

- W / S: radial in / out.
- A / D: orbit left / right.
- Space / C: polar up / down.
- Shift: boost.
- Mouse: look after clicking the field.
- R: reset; H: hide or restore the interface; Escape: release pointer lock.

Locomotion follows the same black-hole-centered basis in VR and on desktop. It
is intentionally independent of the direction the user is looking.

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

Each desktop pixel launches a three-dimensional ray through the isotropic
Schwarzschild optical geometry and advances it with midpoint/RK2 integration.
Step length shrinks near the horizon and photon sphere. Segment/sphere roots
detect band crossings without running the former station distance field.

VR now uses an intentionally aggressive playability profile: at most 112 fast
steps, a `0.14M` base step, a 0.42 WebXR framebuffer scale, a larger minimum
step near the photon sphere, and 0.65 fixed foveation when the runtime exposes
it. Its integrator evaluates the optical field once per step instead of twice.
Each eye still receives its own asymmetric WebXR projection and pose, and VR
still bypasses the desktop temporal and reconstruction passes.

Relative to the first Quest build, the scale and step cap reduce nominal
pixel-step work to about 21% before accounting for the cheaper integrator and
stronger foveation. The app asks for the lowest supported refresh rate at or
above 72 Hz and reports measured app-frame rate, slow-frame percentage, and
the actual runtime viewport size once per second. WebXR runtimes may clamp or
ignore the scale, foveation, or refresh request, so those numbers are evidence
of what was negotiated rather than promises of smooth playback.

## Scope and limitations

- Light propagation is an educational real-time approximation, not a precision
  general-relativity solver. The VR-only fast integrator deliberately trades
  additional accuracy for latency.
- User locomotion is Euclidean; it is not a massive-particle geodesic.
- The camera is clamped outside the horizon and there is no modeled interior.
- The double band is an illustrative surface treatment, not a structural model.
- The sky is treated as infinitely distant once a ray escapes the strong field.
- The first headset session entered VR, but it was laggy and jagged under head
  motion. This aggressive profile still requires a physical Quest 3 re-test.

See [ASSET_SOURCE.md](ASSET_SOURCE.md) for attribution and
[VALIDATION.md](VALIDATION.md) for the exact checks and remaining headset gate.
