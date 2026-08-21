# WebXR validation record

## 18 August 2026: implemented and verified

- Created the isolated `codex/webxr-pc-vr` branch from the existing project.
- Served the source over `http://127.0.0.1:4173/`. The HTML, WebXR module, VR
  fragment shader, and panorama requests returned HTTP 200.
- Opened the source in a real Chromium WebGL2 browser. The new fragment shader
  compiled and linked, the ESO panorama rendered, Schwarzschild lensing was
  visible, and the analytic photon double band appeared correctly.
- The browser console contained no warnings or errors after startup.
- The desktop renderer reported a stable live frame rate in the test window.
  That number is not a VR result and is not used as evidence of Quest performance.
- JavaScript syntax checks pass for `main.js`, `webgl.js`, `camera.js`, and
  `xr.js`.
- Seven Node tests pass. They cover the reduced page contract, per-eye WebXR
  renderer wiring, constant-radius orbital displacement, Quest Touch input
  mapping, radial/orbital rig motion, stereo eye offset, basis conversion, and
  projection-matrix inversion, and exact source/distribution synchronization.
- The desktop A/D implementation uses the previously verified exact
  black-hole-centered orbital displacement instead of a tangent-line drift.
- Source and distribution files are checked for byte equality before deployment.

## Initial local PC-VR readiness (18 August profile)

- Target GPU: NVIDIA GeForce RTX 4070 Ti SUPER.
- Meta/Oculus is selected as the Windows OpenXR runtime.
- Current Chrome and Edge installations expose the WebXR APIs used by the build.
- The VR render loop uses one `XRWebGLLayer`, a dedicated XR animation loop,
  per-view viewport/projection/pose data, and the Quest `xr-standard` gamepad map.
- The full 6000 x 3000 panorama is retained on capable desktop GPUs.
- VR starts at 224 RK2 steps and a 0.65 framebuffer scale rather than assuming
  that native Quest render resolution will sustain the headset refresh rate.

## 21 August 2026: physical Quest result and aggressive pass

The first physical Quest 3 session successfully entered immersive VR. The user
reported that the image was very laggy, slow, and jagged under head movement.
Stereo appeared to be present but could not be judged confidently at that frame
rate. This is useful acceptance evidence for session startup, but not evidence
of acceptable VR performance or correct stereo comfort.

This build therefore makes a deliberate playability tradeoff:

- WebXR framebuffer scale: 0.65 to 0.42.
- Ray cap: 224 midpoint/RK2 steps to 112 XR-fast steps.
- Base step: `0.10M` to `0.14M`; photon-sphere minimum: `0.018M` to `0.034M`.
- Optical-field evaluations: two per XR step to one; the desktop path remains RK2.
- Requested fixed foveation: 0.35 to 0.65 when supported.
- Sky source retained at 6000 x 3000, with linear brightness multiplied by 0.5.
- Runtime asks for the lowest supported refresh rate at or above 72 Hz.
- Once-per-second telemetry reports target Hz, app FPS, actual per-eye viewport,
  slow-frame percentage, and the XR step cap.

The scale and ray-cap changes alone reduce nominal pixel-step work to about 21%
of the first build. This estimate is architectural, not a measured Quest result.

Eight Node tests pass, including the new aggressive-profile and refresh-rate
selection contract. JavaScript syntax checks and `git diff --check` pass. A
fresh real Chromium/WebGL2 load compiled the complete shader, displayed the
lensed sky and double band, reported `6000×3000 sky loaded · optics stable`,
and produced no console warnings or errors. Its desktop frame rate is not used
as Quest performance evidence. The new immersive path still needs the physical
headset re-test below.

## Current headset re-test gates

1. Confirm head rotation responds without visible delayed stepping or prolonged
   reprojection.
2. After at least five seconds, exit VR and record the last telemetry sample:
   target Hz, app FPS, per-eye viewport, and slow-frame percentage.
3. Re-check stereo convergence and projection orientation once motion is smooth
   enough to judge them separately.
4. Confirm left-stick radial/orbital motion, right-stick polar motion, grip boost,
   and A/X reset on the physical Touch controllers.
5. Check comfort during orbiting and note whether Quest Link or Air Link is used.

Desktop browser and automated results cannot substitute for this headset pass.

## 21 August 2026: fixed-position stereo lookup build

The physical Quest re-test found the 112-step aggressive live renderer still
very laggy and hardly better than the original 224-step build. This diagnostic
therefore removes live ray integration from immersive rendering entirely.

- VR center fixed at Schwarzschild areal radius `r = 3.25M`.
- Controller locomotion disabled; head rotation, eye separation, and small
  tracked translations retained.
- Offline table dimensions: 4096 ray-angle samples by 35 isotropic-radius
  samples, spanning `rho = 1.96M` through `2.30M`.
- Each table entry stores the escaped sky direction or capture state plus the
  first photon-sphere crossing and tangent for the double band.
- The dedicated XR shader performs no integration loop and no optical-force
  evaluation. It reconstructs the result separately from each WebXR eye pose.
- Full 6000 x 3000 sky retained and linear sky brightness remains multiplied
  by 0.5.
- Framebuffer scale 0.42 and requested fixed foveation 0.65 retained so this
  test isolates the cost of ray integration as strongly as practical.

The generated binary validates its magic, dimensions, layer count, byte size,
finite payload, captured/escaped populations, radial invariants, and normalized
photon-sphere crossing. Automated tests also verify distinct left/right eye
positions and source/distribution byte equality. Physical Quest timing remains
the acceptance gate.

Automated result for this build:

- `npm run generate:xr-lut` reproduced SHA-256
  `20B3ECEB667800711FC2FF94222046F4DCAB3381F77B2DCB88889BCD8C4D5D38`.
- `npm test`: 8 passed, 0 failed.
- A local static-server check returned HTTP 200 for the entry page, three
  JavaScript modules, XR shader, full sky image, and 4,587,584-byte table.
- No automated check substitutes for compiling and timing the shader through
  the user's actual Quest 3 and PC-VR runtime.
