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

## Local PC-VR readiness

- Target GPU: NVIDIA GeForce RTX 4070 Ti SUPER.
- Meta/Oculus is selected as the Windows OpenXR runtime.
- Current Chrome and Edge installations expose the WebXR APIs used by the build.
- The VR render loop uses one `XRWebGLLayer`, a dedicated XR animation loop,
  per-view viewport/projection/pose data, and the Quest `xr-standard` gamepad map.
- The full 6000 x 3000 panorama is retained on capable desktop GPUs.
- VR starts at 224 RK2 steps and a 0.65 framebuffer scale rather than assuming
  that native Quest render resolution will sustain the headset refresh rate.

## Not yet verified

The Quest 3 was not connected through Quest Link during this validation pass,
so `navigator.xr.isSessionSupported("immersive-vr")` correctly returned false.
The following remain real acceptance gates rather than claimed successes:

1. Enter an immersive session in the Quest 3 without an OpenXR or permission error.
2. Confirm both eye images have correct stereo convergence and no projection flip.
3. Confirm left-stick radial/orbital motion, right-stick polar motion, grip boost,
   and A/X reset on the physical Touch controllers.
4. Measure sustained headset frame timing at the negotiated refresh rate.
5. Check comfort during orbiting and adjust acceleration or turn conventions if needed.
6. Reduce framebuffer scale or ray steps if application frames are reprojected.

The browser and automated results establish that the WebGL shader and control
math work, but they do not substitute for this headset pass.
