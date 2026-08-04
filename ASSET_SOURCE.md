# Asset and reference sources

## Procedural orbital-station reference

- **Title:** *[TAA] Orbital Megastructure*
- **Creator:** morimea
- **Source:** https://www.shadertoy.com/view/X33BRn
- **License:** CC0 public-domain dedication for the ported orbital geometry;
  the temporal passes were studied as behavioral references and were not copied
- **Use in this project:** The active station object map and procedural material
  helpers were ported into `shaders/orbital_station.glsl`, with source symbols
  namespaced for this renderer. The source-radius-8 ring hull is uniformly
  scaled by the Schwarzschild photon-sphere radius divided by 8, curved along
  spherical latitude, duplicated at two latitudes per hemisphere, and mirrored
  above and below a clear equatorial gap. The four copies rotate together about
  their shared polar axis, with geometry and procedural materials evaluated in
  the same rotating object space. Its CityBlock greebles, panel shader, edge
  rails, material IDs, and noise are retained. Surface refinement,
  footprint-driven geometry detail, normals, ambient occlusion, and the
  deterministic soft-shadow marcher are specific to this adaptation. The
  source cross-lattice pipes, hub, four radial spokes, central trusses, mast,
  and dishes are omitted.

No image or texture from the Shadertoy project is bundled or sampled at runtime.
The original camera, Earth texture, temporal buffers, and post-processing code
are not used. Schwarzschild ray integration, station placement, controls,
lensed sky, motion-vector output, temporal resolve, and final tone mapping are
specific to this project.

## Antialiasing design references

- **Original behavioral reference:** morimea's
  *[TAA] Orbital Megastructure*, Shadertoy `X33BRn`
- **Archived public API response inspected:** pinned
  [`X33BRn.json`](https://github.com/GabeRundlett/shadertoy-api-shaders/blob/f6d538adf936215ccf2d11ba9b4a6c79ccb448c5/shaders/X33BRn.json),
  SHA-256
  `752c3a09addb84800f941d3ea6ae725e9051bc83951eaf11d70b758be0a0251b`
- **Temporal clipping reference:** Playdead's
  [MIT-licensed temporal repository](https://github.com/playdeadgames/temporal)
- **Sharpening reference:** AMD FidelityFX
  [FSR1 documentation](https://gpuopen.com/manuals/fidelityfx_sdk/techniques/super-resolution-spatial/)
  and [MIT-licensed SDK](https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK)

The archived Shadertoy pass graph was studied to recover the intended strategy:
a long Halton sequence, previous-camera reprojection, Catmull–Rom history
sampling, neighborhood variance clipping, and a restrained reconstruction
sharpen. The implementation in this repository was written for its WebGL2
multi-render-target pipeline and genuine object-space station rotation; it does
not copy the archived temporal pass. The FSR-style final limiter is a compact
WebGL implementation informed by AMD's permissively licensed documentation.

## Galaxy sky texture

### `assets/galaxy_4k.jpg`

- **Title:** *The Milky Way panorama* (image ID `eso0932a`)
- **Creator / required credit:** `ESO/S. Brunier`
- **Source page:** https://www.eso.org/public/images/eso0932a/
- **Official image file:** https://cdn.eso.org/images/large/eso0932a.jpg
- **License:** [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
- **ESO reuse policy:** https://www.eso.org/public/outreach/copyright/
- **Downloaded:** 2026-07-27
- **File:** JPEG, 6000 × 3000 pixels, 8,228,817 bytes
- **SHA-256:** `60400C92C54B7C1BD12299C69E83B16E5B6256E7DABACC478C021758ECD28179`
- **Local modifications:** None; this is the official ESO large JPEG.

ESO describes the image as a 360-degree panorama covering the entire southern and
northern celestial sphere. Its 2:1 dimensions make it suitable for use as an
equirectangular sky texture.

ESO's reuse policy states that, unless specifically noted otherwise, images on its
public website are licensed under CC BY 4.0. The image page does not state an
exception and supplies the credit line above. When the texture is used, keep the
full credit wording unaltered and present it clearly and visibly to users. Do not
imply endorsement by ESO or its personnel.

## Social previews

### `assets/social-preview-tracks.png`

Project-owned social preview generated with OpenAI's built-in image-generation
tool on 28 July 2026 for the earlier equatorial-track build. It is retained as
an unused legacy asset and is not sampled by the WebGL renderer.

### `assets/social-preview-spheres.png`

Project-owned social preview generated with OpenAI's built-in image-generation
tool on 28 July 2026 to reflect the shaded sphere-skin view. It is not sampled
by the WebGL renderer.

### `assets/social-preview-dyson-rings.png`

Project-owned social preview generated with OpenAI's built-in image-generation
tool on 28 July 2026 for the superseded color-coded ring design. It is retained
as an unused legacy asset and is not sampled by the WebGL renderer.

### `assets/social-preview-orbital-stations.png`

Project-owned 1200 × 630 social preview generated with OpenAI's built-in
image-generation tool on 28 July 2026 for the neutral orbital-station redesign.
The prompt requested exactly three concentric flat-faced station bands, exactly
four modest spokes, dense neutral-metal panels and greebles, a central
Schwarzschild shadow, stars, and no text, logo, watermark, planet, accretion
disk, neon, or radius-based color coding. It is retained as an unused legacy
asset and is not sampled by the WebGL renderer.

### `assets/social-preview-photon-station.png`

Project-owned 1200 × 630 social preview generated with OpenAI's built-in
image-generation tool on 28 July 2026 from an offscreen frame of the literal
single-station build. The prompt required exactly one flat, densely greebled
ring, four radial spokes, a centered black-hole shadow, neutral hull materials,
sparse service accents, deep space, and no text, logo, watermark, planet,
accretion disk, neon, extra bands, or radius-based color coding. It is retained
as an unused legacy asset and is not sampled by the WebGL renderer.

### `assets/social-preview-photon-bands.png`

Project-owned 1730 × 909 social preview generated with OpenAI's built-in
image-generation tool on 29 July 2026 by editing the preceding single-station
card. The prompt preserved the centered black-hole shadow, deep star field,
neutral greebled panels, gold edge rails, and wide composition while requiring
exactly two mirrored spherical station bands, one above and one below a fully
open equatorial corridor. It explicitly prohibited radial spokes, center-facing
pipes, hub attachments, masts, antennas, dishes, accretion disks, text, logos,
watermarks, planets, neon radius colors, and any third band. It is retained as
an unused legacy asset and is not sampled by the WebGL renderer.

### `assets/social-preview-four-bands.png`

Project-owned 1730 × 909 social preview generated with OpenAI's built-in
image-generation tool on 29 July 2026 by editing the preceding two-band card.
The prompt preserved the centered black-hole shadow, deep star field, neutral
greebled panels, gold edge rails, and wide composition while requiring exactly
four mirrored spherical station bands with two copies per hemisphere. It also
requested equal edge-to-edge gaps, an unobstructed equatorial view, and removal
of the large white cross-lattice pipes, radial spokes, hub, mast, antenna, and
dishes. A second precise edit moved the inner bands toward the equator while
preserving the four-band count and symmetry. The card contains no text, logo,
or watermark. It is retained as an unused legacy asset and is not sampled by
the WebGL renderer.

### `assets/social-preview-hemispheres.png`

Project-owned 1731 × 909 social preview generated with OpenAI's built-in
image-generation tool on 4 August 2026 by editing the preceding four-band card.
The first edit preserved the centered black-hole shadow, deep star field,
neutral panelled metal, gold edge rails, and wide composition while replacing
the four separated bands with exactly two continuous Dyson hemispheres and one
clear equatorial gap. It requested the highest greeble density beside the gap,
simpler polar panels, no spherical grids, no extra gaps or bands, and no spokes,
hub, mast, antennas, dishes, accretion disk, planet, logo, or watermark. A
single follow-up corrected the upper-left title to the exact text
`SCHWARZSCHILD FIELD` without changing the scene. This is the active Open Graph
and Twitter card and is not sampled by the WebGL renderer.
