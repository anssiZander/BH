# Asset and reference sources

## Procedural orbital-station reference

- **Title:** *[TAA] Orbital Megastructure*
- **Creator:** morimea
- **Source:** https://www.shadertoy.com/view/X33BRn
- **License:** CC0 public-domain dedication in the shader source
- **Use in this project:** The active station object map and procedural material
  helpers were ported into `shaders/orbital_station.glsl`, with source symbols
  namespaced for this renderer. The source-radius-8 ring hull is uniformly
  scaled by the Schwarzschild photon-sphere radius divided by 8, curved along
  spherical latitude, duplicated at two latitudes per hemisphere, and mirrored
  above and below a clear equatorial gap. The four copies rotate together about
  their shared polar axis, with geometry and procedural materials evaluated in
  the same rotating object space. Its CityBlock greebles, panel shader, edge
  rails, material IDs, noise, normals, ambient occlusion, and
  directional-shadow method are retained. The source cross-lattice pipes, hub,
  four radial spokes, central trusses, mast, and dishes are omitted.

No image or texture from the Shadertoy project is bundled or sampled at runtime.
The original camera, Earth texture, temporal buffers, FSR, and post-processing
passes are not used. Schwarzschild ray integration, station placement, controls,
lensed sky, and final tone mapping are specific to this project.

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
or watermark. It is used only for Open Graph and Twitter cards and is not
sampled by the WebGL renderer.
