"""Procedural weak-field GEM visualization for Blender 5.x.

Paste this whole file into Blender's Scripting workspace and choose Run Script.
It clears the current scene, builds the visualization, and leaves frame 1 ready
for preview or rendering.  No add-ons or external assets are required.
"""

import math
import random

import bpy
from mathutils import Matrix, Vector


# =============================================================================
# USER CONFIGURATION
# =============================================================================

SHOW_GRAVITOELECTRIC = True
SHOW_GRAVITOMAGNETIC = True

BODY_RADIUS = 1.60

# COMPACT STAR. The equatorial radius intentionally matches BODY_RADIUS by
# default so the already-established field-line endpoints remain unchanged.
STAR_ROTATION_ENABLED = True
STAR_ROTATIONS_PER_ANIMATION = 3.0
STAR_EQUATORIAL_RADIUS = 1.60
STAR_POLAR_RADIUS = 1.34
STAR_EMISSION_STRENGTH = 2.35
STAR_COOL_COLOR = (0.002, 0.001, 0.012, 1.0)
STAR_MID_COLOR = (0.012, 0.030, 0.145, 1.0)
STAR_HOT_COLOR = (0.34, 0.010, 0.19, 1.0)
STAR_HIGHLIGHT_COLOR = (0.72, 0.86, 1.00, 1.0)

# GYROSCOPE.
SHOW_GYROSCOPE = True
GYRO_ORBIT_RADIUS = 4.45
GYRO_ORBIT_INCLINATION_DEG = 72.0
GYRO_ORBITS_PER_ANIMATION = 1.0
GYRO_SCALE = 0.82
GYRO_ROTOR_SPINS_PER_ANIMATION = 24.0

# FRAME-DRAGGING PRECESSION. Time is normalized across the existing animation;
# this visual multiplier deliberately makes the tiny real effect readable.
ENABLE_LT_PRECESSION = True
PRECESSION_VISUAL_SCALE = 180.0
GYRO_INITIAL_SPIN = (0.74, 0.22, 0.64)

# OPTIONAL DEBUGGING.
SHOW_LOCAL_PRECESSION_VECTOR = False

# Radial inward gravitoelectric field.
GE_LINE_COUNT = 30
GE_OUTER_RADIUS = 6.10

# Numerically integrated dipole-like gravitomagnetic field.
GM_SEED_COUNT = 18
GM_SHELL_COUNT = 3
GM_SEED_RADIUS_MIN = 2.65
GM_SEED_RADIUS_MAX = 5.15
GM_BOUND_RADIUS = 6.35
GM_STEP_SIZE = 0.055
GM_MAX_STEPS = 900

# Shared field styling.
GE_COLOR = (0.015, 0.42, 1.00, 1.0)
GM_COLOR = (1.00, 0.018, 0.30, 1.0)
ROTATION_COLOR = (1.00, 0.20, 0.025, 1.0)
FIELD_LINE_RADIUS = 0.018
ARROW_SCALE = 0.27
FIELD_SURFACE_GAP = 0.085

# Animation.
ANIMATION_SECONDS = 10.0
FPS = 30
ANIMATE_CAMERA = False
ANIMATE_FIELD_PULSES = True

# Render and output. OUTPUT_FORMAT may be "PNG" or "FFMPEG".
RENDER_RESOLUTION_X = 2560
RENDER_RESOLUTION_Y = 1440
RENDER_SAMPLES = 96
OUTPUT_FORMAT = "PNG"
OUTPUT_PATH = "//renders/GEM_fields/frame_"

# Optional atmosphere and composition details.
ADD_HALO = True
ADD_DUST = True
DUST_COUNT = 125
CAMERA_LENS_MM = 55.0
USE_DEPTH_OF_FIELD = False
RANDOM_SEED = 20260819


# =============================================================================
# INTERNAL CONSTANTS
# =============================================================================

FRAME_START = 1
FRAME_COUNT = max(2, int(round(ANIMATION_SECONDS * FPS)))
FRAME_END = FRAME_START + FRAME_COUNT - 1
TAU = 2.0 * math.pi

COLLECTION_NAMES = (
    "Central Mass",
    "Gravitoelectric Field",
    "Gravitomagnetic Field",
    "Gyroscope",
    "Arrows",
    "Environment",
    "Camera and Lights",
)


# =============================================================================
# GENERAL HELPERS
# =============================================================================

def clear_scene():
    """Remove the current scene contents so rerunning the script is deterministic."""
    scene = bpy.context.scene

    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)

    scene.world = None
    if hasattr(scene, "compositing_node_group"):
        scene.compositing_node_group = None

    # Remove only now-unused datablocks. This also prevents .001 name suffixes
    # when the script is run repeatedly in the same Blender file.
    datablock_groups = (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.worlds,
        bpy.data.actions,
        bpy.data.node_groups,
    )
    for group in datablock_groups:
        for block in list(group):
            if block.users == 0:
                group.remove(block)


def create_collections():
    scene_root = bpy.context.scene.collection
    result = {}
    for name in COLLECTION_NAMES:
        collection = bpy.data.collections.new(name)
        scene_root.children.link(collection)
        result[name] = collection
    return result


def move_to_collection(obj, collection):
    for old_collection in list(obj.users_collection):
        old_collection.objects.unlink(obj)
    collection.objects.link(obj)


def set_input(node, names, value):
    """Set a node input by any supported Blender 5.x socket name."""
    if isinstance(names, str):
        names = (names,)
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return socket
    return None


def set_enum_property(owner, property_name, preferred_values):
    """Set the first enum value present in this Blender build."""
    if not hasattr(owner, property_name):
        return None
    if isinstance(preferred_values, str):
        preferred_values = (preferred_values,)
    try:
        prop = owner.bl_rna.properties[property_name]
        valid = {item.identifier for item in prop.enum_items}
    except (AttributeError, KeyError, TypeError):
        valid = None
    for value in preferred_values:
        if valid is None or value in valid:
            try:
                setattr(owner, property_name, value)
                return value
            except (AttributeError, TypeError, ValueError):
                pass
    return None


def set_linear_driver(owner, data_path, index, expression):
    fcurve = owner.driver_add(data_path, index)
    fcurve.driver.type = "SCRIPTED"
    fcurve.driver.expression = expression
    return fcurve


def look_at(obj, target=(0.0, 0.0, 0.0)):
    target = Vector(target)
    direction = target - obj.location
    if direction.length_squared > 1.0e-12:
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def link_nodes(links, output_node, output_name, input_node, input_name):
    output_socket = output_node.outputs.get(output_name)
    input_socket = input_node.inputs.get(input_name)
    if output_socket is None or input_socket is None:
        raise RuntimeError(
            f"Missing node socket: {output_node.name}.{output_name} -> "
            f"{input_node.name}.{input_name}"
        )
    links.new(output_socket, input_socket)


def scaled_color(color, factor):
    return (
        min(max(color[0] * factor, 0.0), 1.0),
        min(max(color[1] * factor, 0.0), 1.0),
        min(max(color[2] * factor, 0.0), 1.0),
        color[3],
    )


# =============================================================================
# MATERIALS
# =============================================================================

def make_emission_material(name, color, strength):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color

    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (260, 0)
    emission = nodes.new("ShaderNodeEmission")
    emission.location = (0, 0)
    emission.name = f"{name} Emission"
    set_input(emission, "Color", color)
    set_input(emission, "Strength", strength)
    link_nodes(links, emission, "Emission", output, "Surface")
    return material


def make_mass_material():
    """Procedural, latitude-aware surface for an exotic oblate compact star."""
    material = bpy.data.materials.new("Procedural Rapidly Rotating Compact Star")

    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (1260, 30)

    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.location = (880, 125)
    principled.name = "Dense Compact Star Surface"
    set_input(principled, "Metallic", 0.06)
    set_input(principled, ("Specular IOR Level", "Specular"), 0.48)
    set_input(principled, ("Coat Weight", "Clearcoat"), 0.16)
    set_input(principled, ("Coat Roughness", "Clearcoat Roughness"), 0.28)

    emission = nodes.new("ShaderNodeEmission")
    emission.location = (875, -165)
    emission.name = "Localized Thermal Emission"
    set_input(emission, "Strength", STAR_EMISSION_STRENGTH)

    mix_shader = nodes.new("ShaderNodeMixShader")
    mix_shader.location = (1080, 30)

    texcoord = nodes.new("ShaderNodeTexCoord")
    texcoord.location = (-1260, 20)

    large_noise = nodes.new("ShaderNodeTexNoise")
    large_noise.location = (-1030, 260)
    large_noise.name = "Large Exotic Atmospheric Cells"
    set_input(large_noise, "Scale", 2.75)
    set_input(large_noise, "Detail", 7.0)
    set_input(large_noise, "Roughness", 0.72)
    set_input(large_noise, "Distortion", 0.38)

    streak_vector = nodes.new("ShaderNodeVectorMath")
    streak_vector.operation = "MULTIPLY"
    streak_vector.location = (-1030, 45)
    streak_vector.inputs[1].default_value = (1.45, 1.45, 2.80)

    rotation_bands = nodes.new("ShaderNodeTexWave")
    rotation_bands.location = (-790, 45)
    rotation_bands.name = "Distorted Rotation Aligned Streaks"
    rotation_bands.wave_type = "BANDS"
    rotation_bands.bands_direction = "Z"
    set_input(rotation_bands, "Scale", 2.25)
    set_input(rotation_bands, "Distortion", 7.0)
    set_input(rotation_bands, "Detail", 4.0)
    set_input(rotation_bands, "Detail Scale", 2.1)
    set_input(rotation_bands, "Detail Roughness", 0.64)

    fine_noise = nodes.new("ShaderNodeTexNoise")
    fine_noise.location = (-1030, -195)
    fine_noise.name = "Fine Turbulent Filaments"
    set_input(fine_noise, "Scale", 18.0)
    set_input(fine_noise, "Detail", 6.0)
    set_input(fine_noise, "Roughness", 0.67)
    set_input(fine_noise, "Distortion", 0.28)

    micro_noise = nodes.new("ShaderNodeTexNoise")
    micro_noise.location = (-1030, -420)
    micro_noise.name = "Micro Surface Structure"
    set_input(micro_noise, "Scale", 52.0)
    set_input(micro_noise, "Detail", 3.5)
    set_input(micro_noise, "Roughness", 0.61)

    hot_regions = nodes.new("ShaderNodeTexVoronoi")
    hot_regions.location = (-1030, -650)
    hot_regions.name = "Sparse Thermal Regions"
    hot_regions.feature = "F1"
    hot_regions.distance = "EUCLIDEAN"
    set_input(hot_regions, "Scale", 7.5)
    set_input(hot_regions, "Randomness", 0.78)

    hot_region_ramp = nodes.new("ShaderNodeValToRGB")
    hot_region_ramp.location = (-785, -650)
    hot_region_ramp.name = "Thermal Region Mask"
    hot_region_ramp.color_ramp.interpolation = "EASE"
    hot_region_ramp.color_ramp.elements[0].position = 0.03
    hot_region_ramp.color_ramp.elements[0].color = (0.65, 0.65, 0.65, 1.0)
    hot_region_ramp.color_ramp.elements[1].position = 0.31
    hot_region_ramp.color_ramp.elements[1].color = (0.0, 0.0, 0.0, 1.0)
    hot_mid = hot_region_ramp.color_ramp.elements.new(0.16)
    hot_mid.color = (0.10, 0.10, 0.10, 1.0)

    separate_xyz = nodes.new("ShaderNodeSeparateXYZ")
    separate_xyz.location = (-1030, -855)
    latitude_center = nodes.new("ShaderNodeMath")
    latitude_center.operation = "SUBTRACT"
    latitude_center.location = (-805, -855)
    latitude_center.inputs[1].default_value = 0.5
    latitude_abs = nodes.new("ShaderNodeMath")
    latitude_abs.operation = "ABSOLUTE"
    latitude_abs.location = (-615, -855)
    latitude_scale = nodes.new("ShaderNodeMath")
    latitude_scale.operation = "MULTIPLY"
    latitude_scale.location = (-425, -855)
    latitude_scale.inputs[1].default_value = 2.0
    latitude_power = nodes.new("ShaderNodeMath")
    latitude_power.operation = "POWER"
    latitude_power.location = (-235, -855)
    latitude_power.inputs[1].default_value = 1.35
    latitude_weight = nodes.new("ShaderNodeMath")
    latitude_weight.operation = "MULTIPLY"
    latitude_weight.location = (-40, -855)
    latitude_weight.inputs[1].default_value = 0.14

    large_weight = nodes.new("ShaderNodeMath")
    large_weight.operation = "MULTIPLY"
    large_weight.location = (-520, 270)
    large_weight.inputs[1].default_value = 0.65
    band_weight = nodes.new("ShaderNodeMath")
    band_weight.operation = "MULTIPLY"
    band_weight.location = (-520, 80)
    band_weight.inputs[1].default_value = 0.11
    fine_weight = nodes.new("ShaderNodeMath")
    fine_weight.operation = "MULTIPLY"
    fine_weight.location = (-520, -120)
    fine_weight.inputs[1].default_value = 0.24
    hotspot_weight = nodes.new("ShaderNodeMath")
    hotspot_weight.operation = "MULTIPLY"
    hotspot_weight.location = (-520, -590)
    hotspot_weight.inputs[1].default_value = 0.13

    structure_ab = nodes.new("ShaderNodeMath")
    structure_ab.operation = "ADD"
    structure_ab.location = (-285, 195)
    structure_abc = nodes.new("ShaderNodeMath")
    structure_abc.operation = "ADD"
    structure_abc.location = (-90, 140)
    structure_latitude = nodes.new("ShaderNodeMath")
    structure_latitude.operation = "ADD"
    structure_latitude.location = (105, 75)
    final_heat = nodes.new("ShaderNodeMath")
    final_heat.operation = "ADD"
    final_heat.location = (300, 35)

    palette = nodes.new("ShaderNodeValToRGB")
    palette.location = (500, 190)
    palette.name = "Compact Star Thermal Palette"
    palette.color_ramp.interpolation = "EASE"
    palette.color_ramp.elements[0].position = 0.12
    palette.color_ramp.elements[0].color = STAR_COOL_COLOR
    palette.color_ramp.elements[1].position = 0.92
    palette.color_ramp.elements[1].color = STAR_HIGHLIGHT_COLOR
    palette_mid = palette.color_ramp.elements.new(0.43)
    palette_mid.color = STAR_MID_COLOR
    palette_hot = palette.color_ramp.elements.new(0.70)
    palette_hot.color = STAR_HOT_COLOR
    palette_pale = palette.color_ramp.elements.new(0.84)
    palette_pale.color = (
        0.42 * STAR_HIGHLIGHT_COLOR[0],
        0.42 * STAR_HIGHLIGHT_COLOR[1],
        0.55 * STAR_HIGHLIGHT_COLOR[2],
        1.0,
    )

    roughness_ramp = nodes.new("ShaderNodeValToRGB")
    roughness_ramp.location = (510, -20)
    roughness_ramp.name = "Turbulent Roughness"
    roughness_ramp.color_ramp.elements[0].position = 0.18
    roughness_ramp.color_ramp.elements[0].color = (0.27, 0.27, 0.27, 1.0)
    roughness_ramp.color_ramp.elements[1].position = 0.84
    roughness_ramp.color_ramp.elements[1].color = (0.52, 0.52, 0.52, 1.0)

    bump = nodes.new("ShaderNodeBump")
    bump.location = (675, -115)
    bump.name = "Subtle Dense Surface Relief"
    set_input(bump, "Strength", 0.13)
    set_input(bump, "Distance", 0.045)

    emission_mask = nodes.new("ShaderNodeValToRGB")
    emission_mask.location = (500, -335)
    emission_mask.name = "Localized Emission Mask"
    emission_mask.color_ramp.interpolation = "EASE"
    emission_mask.color_ramp.elements[0].position = 0.56
    emission_mask.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
    emission_mask.color_ramp.elements[1].position = 0.95
    emission_mask.color_ramp.elements[1].color = (0.22, 0.22, 0.22, 1.0)
    emission_mid = emission_mask.color_ramp.elements.new(0.76)
    emission_mid.color = (0.045, 0.045, 0.045, 1.0)
    emission_hot = emission_mask.color_ramp.elements.new(0.87)
    emission_hot.color = (0.12, 0.12, 0.12, 1.0)

    link_nodes(links, texcoord, "Generated", large_noise, "Vector")
    link_nodes(links, texcoord, "Generated", streak_vector, "Vector")
    link_nodes(links, streak_vector, "Vector", rotation_bands, "Vector")
    link_nodes(links, texcoord, "Generated", fine_noise, "Vector")
    link_nodes(links, texcoord, "Generated", micro_noise, "Vector")
    link_nodes(links, texcoord, "Generated", hot_regions, "Vector")
    link_nodes(links, texcoord, "Generated", separate_xyz, "Vector")
    link_nodes(links, hot_regions, "Distance", hot_region_ramp, "Fac")

    links.new(separate_xyz.outputs["Z"], latitude_center.inputs[0])
    links.new(latitude_center.outputs[0], latitude_abs.inputs[0])
    links.new(latitude_abs.outputs[0], latitude_scale.inputs[0])
    links.new(latitude_scale.outputs[0], latitude_power.inputs[0])
    links.new(latitude_power.outputs[0], latitude_weight.inputs[0])

    link_nodes(links, large_noise, "Fac", large_weight, "Value")
    link_nodes(links, rotation_bands, "Fac", band_weight, "Value")
    link_nodes(links, fine_noise, "Fac", fine_weight, "Value")
    links.new(hot_region_ramp.outputs["Color"], hotspot_weight.inputs[0])
    links.new(large_weight.outputs[0], structure_ab.inputs[0])
    links.new(band_weight.outputs[0], structure_ab.inputs[1])
    links.new(structure_ab.outputs[0], structure_abc.inputs[0])
    links.new(fine_weight.outputs[0], structure_abc.inputs[1])
    links.new(structure_abc.outputs[0], structure_latitude.inputs[0])
    links.new(latitude_weight.outputs[0], structure_latitude.inputs[1])
    links.new(structure_latitude.outputs[0], final_heat.inputs[0])
    links.new(hotspot_weight.outputs[0], final_heat.inputs[1])

    links.new(final_heat.outputs[0], palette.inputs["Fac"])
    links.new(final_heat.outputs[0], emission_mask.inputs["Fac"])
    link_nodes(links, fine_noise, "Fac", roughness_ramp, "Fac")
    link_nodes(links, micro_noise, "Fac", bump, "Height")
    link_nodes(links, palette, "Color", principled, "Base Color")
    links.new(roughness_ramp.outputs["Color"], principled.inputs["Roughness"])
    link_nodes(links, bump, "Normal", principled, "Normal")
    link_nodes(links, palette, "Color", emission, "Color")
    links.new(emission_mask.outputs["Color"], mix_shader.inputs[0])
    links.new(principled.outputs["BSDF"], mix_shader.inputs[1])
    links.new(emission.outputs["Emission"], mix_shader.inputs[2])
    links.new(mix_shader.outputs["Shader"], output.inputs["Surface"])
    return material

def make_halo_material():
    material = bpy.data.materials.new("Compact Mass Limb Halo")
    material.diffuse_color = (0.06, 0.12, 0.34, 0.08)

    set_enum_property(material, "surface_render_method", ("DITHERED", "BLENDED"))
    set_enum_property(material, "blend_method", ("BLEND", "HASHED"))
    if hasattr(material, "use_transparency_overlap"):
        material.use_transparency_overlap = False

    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (620, 0)
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    transparent.location = (140, 100)
    emission = nodes.new("ShaderNodeEmission")
    emission.location = (140, -100)
    set_input(emission, "Color", (0.025, 0.12, 0.62, 1.0))
    set_input(emission, "Strength", 0.78)

    layer_weight = nodes.new("ShaderNodeLayerWeight")
    layer_weight.location = (-620, 0)
    invert = nodes.new("ShaderNodeMath")
    invert.operation = "SUBTRACT"
    invert.location = (-400, 0)
    invert.inputs[0].default_value = 1.0
    power = nodes.new("ShaderNodeMath")
    power.operation = "POWER"
    power.location = (-205, 0)
    power.inputs[1].default_value = 1.7
    geometry = nodes.new("ShaderNodeNewGeometry")
    geometry.location = (-615, -230)
    front_facing = nodes.new("ShaderNodeMath")
    front_facing.operation = "SUBTRACT"
    front_facing.location = (-395, -230)
    front_facing.inputs[0].default_value = 1.0
    front_rim = nodes.new("ShaderNodeMath")
    front_rim.operation = "MULTIPLY"
    front_rim.location = (-185, -105)
    strength = nodes.new("ShaderNodeMath")
    strength.operation = "MULTIPLY"
    strength.location = (5, 0)
    strength.inputs[1].default_value = 0.13
    mix = nodes.new("ShaderNodeMixShader")
    mix.location = (400, 0)

    links.new(layer_weight.outputs["Facing"], invert.inputs[1])
    links.new(invert.outputs[0], power.inputs[0])
    links.new(geometry.outputs["Backfacing"], front_facing.inputs[1])
    links.new(power.outputs[0], front_rim.inputs[0])
    links.new(front_facing.outputs[0], front_rim.inputs[1])
    links.new(front_rim.outputs[0], strength.inputs[0])
    links.new(strength.outputs[0], mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(emission.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], output.inputs["Surface"])
    return material


def make_field_materials():
    ge_materials = [
        make_emission_material("GE Cyan Dim", scaled_color(GE_COLOR, 0.72), 4.2),
        make_emission_material("GE Cyan", GE_COLOR, 6.2),
        make_emission_material("GE Cyan Bright", scaled_color(GE_COLOR, 1.15), 8.0),
    ]
    gm_materials = [
        make_emission_material("GM Magenta Dim", scaled_color(GM_COLOR, 0.75), 4.8),
        make_emission_material("GM Magenta", GM_COLOR, 6.8),
        make_emission_material("GM Magenta Bright", scaled_color(GM_COLOR, 1.12), 8.8),
    ]
    rotation_material = make_emission_material(
        "Rotation Amber", ROTATION_COLOR, 4.2
    )
    axis_material = make_emission_material(
        "Rotation Axis Faint", scaled_color(ROTATION_COLOR, 0.48), 0.75
    )
    return ge_materials, gm_materials, rotation_material, axis_material


# =============================================================================
# CURVES, ARROWS, AND PULSES
# =============================================================================

def create_curve_from_points(
    name,
    points,
    material,
    collection,
    bevel_radius,
    smooth=True,
    cyclic=False,
):
    if len(points) < 2:
        raise ValueError(f"Curve {name!r} needs at least two points")

    curve = bpy.data.curves.new(name, type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 3
    curve.render_resolution_u = 3
    curve.bevel_depth = bevel_radius
    curve.bevel_resolution = 4
    if hasattr(curve, "use_fill_caps"):
        curve.use_fill_caps = True
    if hasattr(curve, "twist_smooth"):
        curve.twist_smooth = 10
    curve.materials.append(material)

    if smooth and len(points) >= 4:
        spline = curve.splines.new("BEZIER")
        spline.bezier_points.add(len(points) - 1)
        for bezier_point, point in zip(spline.bezier_points, points):
            bezier_point.co = point
            bezier_point.handle_left_type = "AUTO"
            bezier_point.handle_right_type = "AUTO"
    else:
        spline = curve.splines.new("POLY")
        spline.points.add(len(points) - 1)
        for curve_point, point in zip(spline.points, points):
            curve_point.co = (point.x, point.y, point.z, 1.0)

    spline.use_cyclic_u = cyclic
    curve.use_path = True
    curve.path_duration = FRAME_COUNT

    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    return obj


def create_arrow_mesh(name, material):
    sides = 8
    vertices = [(0.0, 0.0, 0.60)]
    for z, radius in ((0.02, 0.31), (-0.50, 0.115)):
        for i in range(sides):
            angle = TAU * i / sides
            vertices.append((radius * math.cos(angle), radius * math.sin(angle), z))
    base_center = len(vertices)
    vertices.append((0.0, 0.0, -0.50))

    faces = []
    shoulder_start = 1
    tail_start = 1 + sides
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((0, shoulder_start + i, shoulder_start + j))
        faces.append(
            (
                shoulder_start + i,
                tail_start + i,
                tail_start + j,
                shoulder_start + j,
            )
        )
        faces.append((base_center, tail_start + j, tail_start + i))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return mesh


def add_arrow(name, location, tangent, mesh, collection, scale=ARROW_SCALE):
    tangent = Vector(tangent)
    if tangent.length_squared < 1.0e-12:
        return None
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.location = Vector(location)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = tangent.normalized().to_track_quat("Z", "Y")
    obj.scale = (scale, scale, scale)
    return obj


def sample_polyline(points, fraction):
    fraction = min(max(float(fraction), 0.0), 1.0)
    lengths = [0.0]
    total = 0.0
    for a, b in zip(points[:-1], points[1:]):
        total += (b - a).length
        lengths.append(total)
    if total < 1.0e-12:
        return Vector(points[0]), Vector((0.0, 0.0, 1.0))

    target = fraction * total
    for index in range(len(points) - 1):
        if lengths[index + 1] >= target:
            segment = points[index + 1] - points[index]
            segment_length = segment.length
            if segment_length < 1.0e-12:
                continue
            local = (target - lengths[index]) / segment_length
            return points[index].lerp(points[index + 1], local), segment.normalized()
    return Vector(points[-1]), (points[-1] - points[-2]).normalized()


def create_unit_icosphere_mesh(name, material):
    golden_ratio = (1.0 + math.sqrt(5.0)) / 2.0
    vertices = [
        Vector((-1.0, golden_ratio, 0.0)),
        Vector((1.0, golden_ratio, 0.0)),
        Vector((-1.0, -golden_ratio, 0.0)),
        Vector((1.0, -golden_ratio, 0.0)),
        Vector((0.0, -1.0, golden_ratio)),
        Vector((0.0, 1.0, golden_ratio)),
        Vector((0.0, -1.0, -golden_ratio)),
        Vector((0.0, 1.0, -golden_ratio)),
        Vector((golden_ratio, 0.0, -1.0)),
        Vector((golden_ratio, 0.0, 1.0)),
        Vector((-golden_ratio, 0.0, -1.0)),
        Vector((-golden_ratio, 0.0, 1.0)),
    ]
    vertices = [vertex.normalized() for vertex in vertices]
    faces = [
        (0, 11, 5),
        (0, 5, 1),
        (0, 1, 7),
        (0, 7, 10),
        (0, 10, 11),
        (1, 5, 9),
        (5, 11, 4),
        (11, 10, 2),
        (10, 7, 6),
        (7, 1, 8),
        (3, 9, 4),
        (3, 4, 2),
        (3, 2, 6),
        (3, 6, 8),
        (3, 8, 9),
        (4, 9, 5),
        (2, 4, 11),
        (6, 2, 10),
        (8, 6, 7),
        (9, 8, 1),
    ]

    # One dependency-free subdivision gives each tiny pulse a smooth silhouette.
    midpoint_cache = {}

    def midpoint_index(first, second):
        key = tuple(sorted((first, second)))
        if key not in midpoint_cache:
            midpoint_cache[key] = len(vertices)
            vertices.append((vertices[first] + vertices[second]).normalized())
        return midpoint_cache[key]

    subdivided_faces = []
    for first, second, third in faces:
        ab = midpoint_index(first, second)
        bc = midpoint_index(second, third)
        ca = midpoint_index(third, first)
        subdivided_faces.extend(
            (
                (first, ab, ca),
                (second, bc, ab),
                (third, ca, bc),
                (ab, bc, ca),
            )
        )

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], subdivided_faces)
    mesh.update()
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return mesh


def add_animated_pulse(
    name, curve_object, mesh, collection, phase, radius=0.065
):
    pulse = bpy.data.objects.new(name, mesh)
    collection.objects.link(pulse)
    pulse.scale = (radius, radius, radius)

    constraint = pulse.constraints.new("FOLLOW_PATH")
    constraint.name = "Travel Along Physical Field Line"
    constraint.target = curve_object
    constraint.use_fixed_location = True
    constraint.offset_factor = phase % 1.0

    expression = (
        f"(((frame - {FRAME_START}) / {float(FRAME_COUNT):.9f}) + "
        f"{float(phase):.9f}) % 1.0"
    )
    fcurve = constraint.driver_add("offset_factor")
    fcurve.driver.type = "SCRIPTED"
    fcurve.driver.expression = expression
    return pulse


# =============================================================================
# CENTRAL MASS AND ROTATION CUES
# =============================================================================

def create_mass(collections, mass_material, halo_material):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=160,
        ring_count=96,
        radius=STAR_EQUATORIAL_RADIUS,
        enter_editmode=False,
        align="WORLD",
        location=(0.0, 0.0, 0.0),
    )
    mass = bpy.context.object
    mass.name = "Rotating Compact Mass"
    move_to_collection(mass, collections["Central Mass"])
    mass.data.name = "High Resolution Compact Mass"
    mass.data.materials.append(mass_material)
    mass.scale.z = STAR_POLAR_RADIUS / STAR_EQUATORIAL_RADIUS
    mass["equatorial_radius"] = STAR_EQUATORIAL_RADIUS
    mass["polar_radius"] = STAR_POLAR_RADIUS
    for polygon in mass.data.polygons:
        polygon.use_smooth = True

    mass.rotation_mode = "XYZ"
    if STAR_ROTATION_ENABLED:
        set_linear_driver(
            mass,
            "rotation_euler",
            2,
            f"{TAU * STAR_ROTATIONS_PER_ANIMATION:.12f} * "
            f"(frame - {FRAME_START}) / {float(FRAME_COUNT):.9f}",
        )

    halo = None
    if ADD_HALO:
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=128,
            ring_count=64,
            radius=STAR_EQUATORIAL_RADIUS * 1.075,
            enter_editmode=False,
            align="WORLD",
            location=(0.0, 0.0, 0.0),
        )
        halo = bpy.context.object
        halo.name = "Subtle Limb Halo"
        move_to_collection(halo, collections["Environment"])
        halo.data.materials.append(halo_material)
        halo.scale.z = STAR_POLAR_RADIUS / STAR_EQUATORIAL_RADIUS
        for polygon in halo.data.polygons:
            polygon.use_smooth = True

    return mass, halo


def create_rotation_cues(
    collections, rotation_material, axis_material, rotation_arrow_mesh
):
    environment = collections["Environment"]
    arrows = collections["Arrows"]

    # Thin equatorial band, just above the body's surface.
    band_points = []
    band_radius = BODY_RADIUS * 1.035
    for i in range(192):
        angle = TAU * i / 192
        band_points.append(
            Vector((band_radius * math.cos(angle), band_radius * math.sin(angle), 0.0))
        )
    create_curve_from_points(
        "Subtle Equatorial Rotation Band",
        band_points,
        rotation_material,
        environment,
        bevel_radius=FIELD_LINE_RADIUS * 0.48,
        smooth=True,
        cyclic=True,
    )

    # A counter-clockwise arc as viewed from +Z: the right-hand-rule sense of
    # positive rotation about the +Z axis.
    camera_side_angle = math.radians(-49.0)
    arc_span = math.radians(246.0)
    arc_radius = BODY_RADIUS * 1.24
    arc_points = []
    arc_steps = 110
    for i in range(arc_steps):
        t = i / (arc_steps - 1)
        angle = camera_side_angle - arc_span + arc_span * t
        arc_points.append(
            Vector(
                (
                    arc_radius * math.cos(angle),
                    arc_radius * math.sin(angle),
                    BODY_RADIUS * 0.10,
                )
            )
        )
    create_curve_from_points(
        "Positive Z Rotation Arc",
        arc_points,
        rotation_material,
        environment,
        bevel_radius=FIELD_LINE_RADIUS * 0.62,
        smooth=True,
    )
    arc_location, arc_tangent = sample_polyline(arc_points, 1.0)
    add_arrow(
        "Positive Z Rotation Arrow",
        arc_location,
        arc_tangent,
        rotation_arrow_mesh,
        arrows,
        scale=ARROW_SCALE * 1.15,
    )

    # Faint axis plus a small +Z arrow makes the spin-axis alignment explicit.
    axis_points = [
        Vector((0.0, 0.0, -BODY_RADIUS * 1.62)),
        Vector((0.0, 0.0, BODY_RADIUS * 1.82)),
    ]
    create_curve_from_points(
        "Rotation Axis +Z",
        axis_points,
        axis_material,
        environment,
        bevel_radius=FIELD_LINE_RADIUS * 0.25,
        smooth=False,
    )
    add_arrow(
        "Positive Z Axis Arrow",
        axis_points[-1],
        Vector((0.0, 0.0, 1.0)),
        rotation_arrow_mesh,
        arrows,
        scale=ARROW_SCALE * 0.70,
    )


# =============================================================================
# GRAVITOELECTRIC FIELD
# =============================================================================

def fibonacci_directions(count):
    golden_angle = math.pi * (3.0 - math.sqrt(5.0))
    for index in range(count):
        z = 1.0 - 2.0 * (index + 0.5) / count
        radial_xy = math.sqrt(max(0.0, 1.0 - z * z))
        azimuth = golden_angle * index
        yield Vector(
            (radial_xy * math.cos(azimuth), radial_xy * math.sin(azimuth), z)
        )


def create_gravitoelectric_field(
    collections, materials, arrow_mesh, pulse_mesh
):
    if not SHOW_GRAVITOELECTRIC:
        return []

    field_collection = collections["Gravitoelectric Field"]
    arrow_collection = collections["Arrows"]
    stop_radius = BODY_RADIUS + FIELD_SURFACE_GAP
    line_records = []

    for index, direction in enumerate(fibonacci_directions(GE_LINE_COUNT)):
        # Points are deliberately ordered outer -> inner so tangents, arrows,
        # and animated pulses all follow g = -GM r / r^3.
        points = [direction * GE_OUTER_RADIUS, direction * stop_radius]
        material = materials[(index * 7) % len(materials)]
        radius_variation = 0.78 + 0.16 * (0.5 + 0.5 * math.sin(index * 2.17))
        curve_object = create_curve_from_points(
            f"GE Inward Line {index + 1:02d}",
            points,
            material,
            field_collection,
            bevel_radius=FIELD_LINE_RADIUS * radius_variation,
            smooth=False,
        )
        line_records.append((curve_object, points))

        if index % 2 == 0:
            fraction = 0.46 + 0.12 * ((index // 2) % 3)
            location, tangent = sample_polyline(points, fraction)
            add_arrow(
                f"GE Inward Arrow {index + 1:02d}",
                location,
                tangent,
                arrow_mesh,
                arrow_collection,
                scale=ARROW_SCALE * 0.86,
            )

        if ANIMATE_FIELD_PULSES and index % 6 == 0:
            add_animated_pulse(
                f"GE Inward Pulse {index + 1:02d}",
                curve_object,
                pulse_mesh,
                field_collection,
                phase=(index * 0.173) % 1.0,
                radius=FIELD_LINE_RADIUS * 3.1,
            )

    return line_records


# =============================================================================
# GRAVITOMAGNETIC DIPOLE FIELD AND RK4 INTEGRATION
# =============================================================================

def gravitomagnetic_field(position):
    """Dipole field for J = +Z, omitting one overall convention-dependent scale."""
    position = Vector(position)
    r2 = position.length_squared
    if r2 < 1.0e-18:
        return Vector((0.0, 0.0, 0.0))
    r = math.sqrt(r2)
    inv_r5 = 1.0 / (r2 * r2 * r)
    x, y, z = position
    return Vector(
        (
            3.0 * x * z * inv_r5,
            3.0 * y * z * inv_r5,
            (3.0 * z * z - r2) * inv_r5,
        )
    )


def normalized_gm_direction(position, integration_sign):
    field = gravitomagnetic_field(position)
    magnitude = field.length
    if magnitude < 1.0e-16:
        return Vector((0.0, 0.0, 0.0))
    return field * (float(integration_sign) / magnitude)


def rk4_step(position, step_size, integration_sign):
    """One constant-arc-length RK4 step along +Bg or -Bg."""
    k1 = normalized_gm_direction(position, integration_sign)
    if k1.length_squared < 1.0e-18:
        return None
    k2 = normalized_gm_direction(position + 0.5 * step_size * k1, integration_sign)
    k3 = normalized_gm_direction(position + 0.5 * step_size * k2, integration_sign)
    k4 = normalized_gm_direction(position + step_size * k3, integration_sign)
    if min(k2.length_squared, k3.length_squared, k4.length_squared) < 1.0e-18:
        return None
    return position + (step_size / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)


def segment_sphere_intersection(start, end, radius):
    """Return the first line-segment intersection with a sphere, if present."""
    delta = end - start
    a = delta.dot(delta)
    if a < 1.0e-20:
        return None
    b = 2.0 * start.dot(delta)
    c = start.dot(start) - radius * radius
    discriminant = b * b - 4.0 * a * c
    if discriminant < 0.0:
        return None
    root = math.sqrt(discriminant)
    candidates = ((-b - root) / (2.0 * a), (-b + root) / (2.0 * a))
    valid = [t for t in candidates if -1.0e-7 <= t <= 1.0 + 1.0e-7]
    if not valid:
        return None
    t = min(max(min(valid), 0.0), 1.0)
    return start.lerp(end, t)


def integrate_streamline(seed, integration_sign):
    stop_radius = BODY_RADIUS + FIELD_SURFACE_GAP
    points = [Vector(seed)]
    current = Vector(seed)
    termination = "max_steps"

    for _ in range(GM_MAX_STEPS):
        nxt = rk4_step(current, GM_STEP_SIZE, integration_sign)
        if nxt is None or not all(math.isfinite(value) for value in nxt):
            termination = "degenerate"
            break

        next_radius = nxt.length
        if next_radius <= stop_radius:
            crossing = segment_sphere_intersection(current, nxt, stop_radius)
            points.append(crossing if crossing is not None else nxt.normalized() * stop_radius)
            termination = "surface"
            break

        if next_radius >= GM_BOUND_RADIUS:
            crossing = segment_sphere_intersection(current, nxt, GM_BOUND_RADIUS)
            points.append(crossing if crossing is not None else nxt.normalized() * GM_BOUND_RADIUS)
            termination = "bound"
            break

        points.append(nxt)
        current = nxt

    return points, termination


def generate_gm_seeds():
    if GM_SEED_COUNT <= 0:
        return []
    shell_count = min(max(1, GM_SHELL_COUNT), GM_SEED_COUNT)
    base = GM_SEED_COUNT // shell_count
    remainder = GM_SEED_COUNT % shell_count
    seeds = []

    for shell_index in range(shell_count):
        if shell_count == 1:
            blend = 0.5
        else:
            blend = shell_index / (shell_count - 1)
        shell_radius = (
            GM_SEED_RADIUS_MIN
            + blend * (GM_SEED_RADIUS_MAX - GM_SEED_RADIUS_MIN)
        )
        count = base + (1 if shell_index < remainder else 0)
        phase = (0.5 * shell_index % 1.0) * TAU / count
        for azimuth_index in range(count):
            azimuth = TAU * azimuth_index / count + phase
            seeds.append(
                Vector(
                    (
                        shell_radius * math.cos(azimuth),
                        shell_radius * math.sin(azimuth),
                        0.0,
                    )
                )
            )
    return seeds


def decimate_streamline(points, stride=2):
    if len(points) <= 4 or stride <= 1:
        return points
    reduced = points[::stride]
    if reduced[-1] != points[-1]:
        reduced.append(points[-1])
    return reduced


def create_gravitomagnetic_field(
    collections, materials, arrow_mesh, pulse_mesh
):
    if not SHOW_GRAVITOMAGNETIC:
        return []

    field_collection = collections["Gravitomagnetic Field"]
    arrow_collection = collections["Arrows"]
    line_records = []

    for index, seed in enumerate(generate_gm_seeds()):
        backward, backward_end = integrate_streamline(seed, -1.0)
        forward, forward_end = integrate_streamline(seed, +1.0)

        # Reversing the -Bg half makes the complete stored curve follow +Bg:
        # north surface -> equator -> south surface.
        full_points = list(reversed(backward)) + forward[1:]
        if len(full_points) < 8:
            continue
        curve_points = decimate_streamline(full_points, stride=2)
        material = materials[(index * 5 + 1) % len(materials)]
        radius_variation = 0.98 + 0.13 * (0.5 + 0.5 * math.cos(index * 1.73))
        curve_object = create_curve_from_points(
            f"GM Dipole Streamline {index + 1:02d}",
            curve_points,
            material,
            field_collection,
            bevel_radius=FIELD_LINE_RADIUS * radius_variation,
            smooth=True,
        )
        line_records.append(
            {
                "object": curve_object,
                "points": full_points,
                "backward_end": backward_end,
                "forward_end": forward_end,
            }
        )

        if index % 2 == 0:
            fraction = 0.34 if (index // 2) % 2 == 0 else 0.66
            location, tangent = sample_polyline(full_points, fraction)
            add_arrow(
                f"GM Direction Arrow {index + 1:02d}",
                location,
                tangent,
                arrow_mesh,
                arrow_collection,
                scale=ARROW_SCALE,
            )

        if ANIMATE_FIELD_PULSES and index % 4 == 0:
            add_animated_pulse(
                f"GM Field Pulse {index + 1:02d}",
                curve_object,
                pulse_mesh,
                field_collection,
                phase=(0.14 + index * 0.137) % 1.0,
                radius=FIELD_LINE_RADIUS * 3.4,
            )

    return line_records


# =============================================================================
# ORBITING GYROSCOPE AND LENSE-THIRRING PRECESSION
# =============================================================================

def make_gyro_principled_material(name, color, metallic, roughness):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    set_input(principled, "Base Color", color)
    set_input(principled, "Metallic", metallic)
    set_input(principled, "Roughness", roughness)
    set_input(principled, ("Specular IOR Level", "Specular"), 0.42)
    set_input(principled, ("Coat Weight", "Clearcoat"), 0.14)
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return material


def make_gyroscope_materials():
    return {
        "frame": make_gyro_principled_material(
            "Gyroscope Frame Material", (0.045, 0.060, 0.095, 1.0), 0.72, 0.27
        ),
        "rotor": make_gyro_principled_material(
            "Gyroscope Rotor Material", (0.16, 0.055, 0.18, 1.0), 0.62, 0.25
        ),
        "axis": make_emission_material(
            "Gyroscope Spin Axis Material", (0.52, 1.00, 0.20, 1.0), 4.2
        ),
        "marker": make_emission_material(
            "Gyroscope Rotor Marker Material", (0.42, 0.82, 1.00, 1.0), 3.5
        ),
        "debug": make_emission_material(
            "Local LT Vector Material", (0.72, 0.18, 1.00, 1.0), 3.0
        ),
    }


def gyro_orbit_position(normalized_time):
    angle = TAU * GYRO_ORBITS_PER_ANIMATION * normalized_time
    inclination = math.radians(GYRO_ORBIT_INCLINATION_DEG)
    cosine = math.cos(angle)
    sine = math.sin(angle)
    return GYRO_ORBIT_RADIUS * Vector(
        (
            cosine,
            sine * math.cos(inclination),
            sine * math.sin(inclination),
        )
    )


def lt_precession_vector(position):
    if not ENABLE_LT_PRECESSION:
        return Vector((0.0, 0.0, 0.0))
    return PRECESSION_VISUAL_SCALE * gravitomagnetic_field(position)


def gyro_spin_derivative(normalized_time, spin):
    omega = lt_precession_vector(gyro_orbit_position(normalized_time))
    return omega.cross(spin)


def rk4_spin_step(normalized_time, spin, step_size):
    """RK4 integration of dS/du = Omega_LT(r(u)) cross S."""
    k1 = gyro_spin_derivative(normalized_time, spin)
    trial_2 = spin + 0.5 * step_size * k1
    if trial_2.length_squared > 1.0e-18:
        trial_2.normalize()
    k2 = gyro_spin_derivative(normalized_time + 0.5 * step_size, trial_2)
    trial_3 = spin + 0.5 * step_size * k2
    if trial_3.length_squared > 1.0e-18:
        trial_3.normalize()
    k3 = gyro_spin_derivative(normalized_time + 0.5 * step_size, trial_3)
    trial_4 = spin + step_size * k3
    if trial_4.length_squared > 1.0e-18:
        trial_4.normalize()
    k4 = gyro_spin_derivative(normalized_time + step_size, trial_4)
    result = spin + (step_size / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
    if result.length_squared < 1.0e-18:
        raise RuntimeError("Gyroscope spin vector became degenerate")
    result.normalize()
    return result


def precompute_gyroscope_animation():
    spin = Vector(GYRO_INITIAL_SPIN)
    if spin.length_squared < 1.0e-18:
        raise ValueError("GYRO_INITIAL_SPIN must be nonzero")
    spin.normalize()
    step_size = 1.0 / FRAME_COUNT
    samples = []

    # The extra virtual sample at FRAME_END + 1 keeps the orbit and rotor
    # interpolation continuous across the rendered frame-range boundary.
    for step in range(FRAME_COUNT + 1):
        normalized_time = step / FRAME_COUNT
        position = gyro_orbit_position(normalized_time)
        omega = lt_precession_vector(position)
        samples.append(
            {
                "frame": FRAME_START + step,
                "time": normalized_time,
                "position": position,
                "spin": spin.copy(),
                "omega": omega,
            }
        )
        if step < FRAME_COUNT and ENABLE_LT_PRECESSION:
            spin = rk4_spin_step(normalized_time, spin, step_size)
    return samples


def stable_direction_quaternion(direction, previous_x=None, previous_quaternion=None):
    """Orient local +Z along a vector while parallel-transporting local +X."""
    z_axis = Vector(direction)
    if z_axis.length_squared < 1.0e-18:
        z_axis = Vector((0.0, 0.0, 1.0))
    else:
        z_axis.normalize()

    if previous_x is None:
        seed = Vector((0.0, 0.0, 1.0))
        if abs(seed.dot(z_axis)) > 0.88:
            seed = Vector((1.0, 0.0, 0.0))
        x_axis = seed - z_axis * seed.dot(z_axis)
    else:
        x_axis = previous_x - z_axis * previous_x.dot(z_axis)
        if x_axis.length_squared < 1.0e-12:
            seed = Vector((1.0, 0.0, 0.0))
            if abs(seed.dot(z_axis)) > 0.88:
                seed = Vector((0.0, 1.0, 0.0))
            x_axis = seed - z_axis * seed.dot(z_axis)

    x_axis.normalize()
    y_axis = z_axis.cross(x_axis).normalized()
    x_axis = y_axis.cross(z_axis).normalized()
    basis = Matrix(
        (
            (x_axis.x, y_axis.x, z_axis.x),
            (x_axis.y, y_axis.y, z_axis.y),
            (x_axis.z, y_axis.z, z_axis.z),
        )
    )
    quaternion = basis.to_quaternion()
    if previous_quaternion is not None and quaternion.dot(previous_quaternion) < 0.0:
        quaternion.negate()
    return quaternion, x_axis


def create_gyro_cylinder(
    name, radius, depth, location, rotation, parent, material, collection
):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=32,
        radius=radius,
        depth=depth,
        enter_editmode=False,
        align="WORLD",
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    move_to_collection(obj, collection)
    obj.data.materials.append(material)
    obj.parent = parent
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def create_gyro_torus(
    name, major_radius, minor_radius, rotation, parent, material, collection
):
    bpy.ops.mesh.primitive_torus_add(
        major_segments=96,
        minor_segments=16,
        major_radius=major_radius,
        minor_radius=minor_radius,
        align="WORLD",
        location=(0.0, 0.0, 0.0),
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    move_to_collection(obj, collection)
    obj.data.materials.append(material)
    obj.parent = parent
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def create_gyro_sphere(name, radius, location, parent, material, collection):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=40,
        ring_count=20,
        radius=radius,
        enter_editmode=False,
        align="WORLD",
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    move_to_collection(obj, collection)
    obj.data.materials.append(material)
    obj.parent = parent
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def keyframe_gyroscope(root, orientation, debug_orientation, samples):
    previous_x = None
    previous_quaternion = None
    previous_debug_x = None
    previous_debug_quaternion = None
    quaternion_dots = []
    edit_preferences = getattr(bpy.context.preferences, "edit", None)
    interpolation_property = "keyframe_new_interpolation_type"
    old_interpolation = None

    if edit_preferences is not None and hasattr(
        edit_preferences, interpolation_property
    ):
        old_interpolation = getattr(edit_preferences, interpolation_property)
        setattr(edit_preferences, interpolation_property, "LINEAR")

    try:
        for sample in samples:
            frame = sample["frame"]
            root.location = sample["position"]
            root.keyframe_insert(data_path="location", frame=frame, group="Orbit")

            quaternion, previous_x = stable_direction_quaternion(
                sample["spin"], previous_x, previous_quaternion
            )
            if previous_quaternion is not None:
                quaternion_dots.append(quaternion.dot(previous_quaternion))
            orientation.rotation_quaternion = quaternion
            orientation.keyframe_insert(
                data_path="rotation_quaternion", frame=frame, group="LT Precession"
            )
            previous_quaternion = quaternion.copy()

            if debug_orientation is not None:
                debug_quaternion, previous_debug_x = stable_direction_quaternion(
                    sample["omega"], previous_debug_x, previous_debug_quaternion
                )
                debug_orientation.rotation_quaternion = debug_quaternion
                debug_orientation.keyframe_insert(
                    data_path="rotation_quaternion",
                    frame=frame,
                    group="Local LT Vector",
                )
                previous_debug_quaternion = debug_quaternion.copy()
    finally:
        if old_interpolation is not None:
            setattr(edit_preferences, interpolation_property, old_interpolation)

    return min(quaternion_dots) if quaternion_dots else 1.0


def create_gyroscope(collections):
    if not SHOW_GYROSCOPE:
        return None

    collection = collections["Gyroscope"]
    materials = make_gyroscope_materials()
    scale = GYRO_SCALE

    root = bpy.data.objects.new("GyroscopeRoot", None)
    collection.objects.link(root)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.22 * scale
    root["orbit_radius"] = GYRO_ORBIT_RADIUS
    root["orbit_inclination_deg"] = GYRO_ORBIT_INCLINATION_DEG
    root["precession_visual_scale"] = PRECESSION_VISUAL_SCALE

    orientation = bpy.data.objects.new("SpinAxisOrientation", None)
    collection.objects.link(orientation)
    orientation.parent = root
    orientation.rotation_mode = "QUATERNION"
    orientation.empty_display_type = "ARROWS"
    orientation.empty_display_size = 0.28 * scale

    rotor_spin = bpy.data.objects.new("RotorIntrinsicSpin", None)
    collection.objects.link(rotor_spin)
    rotor_spin.parent = orientation
    rotor_spin.rotation_mode = "XYZ"
    set_linear_driver(
        rotor_spin,
        "rotation_euler",
        2,
        f"{TAU * GYRO_ROTOR_SPINS_PER_ANIMATION:.12f} * "
        f"(frame - {FRAME_START}) / {float(FRAME_COUNT):.9f}",
    )

    rotor_radius = 0.48 * scale
    create_gyro_torus(
        "Gyroscope Fast Rotor Ring",
        rotor_radius,
        0.050 * scale,
        (0.0, 0.0, 0.0),
        rotor_spin,
        materials["rotor"],
        collection,
    )
    create_gyro_cylinder(
        "Gyroscope Rotor Spoke X",
        0.020 * scale,
        2.0 * rotor_radius,
        (0.0, 0.0, 0.0),
        (0.0, math.pi / 2.0, 0.0),
        rotor_spin,
        materials["rotor"],
        collection,
    )
    create_gyro_cylinder(
        "Gyroscope Rotor Spoke Y",
        0.020 * scale,
        2.0 * rotor_radius,
        (0.0, 0.0, 0.0),
        (math.pi / 2.0, 0.0, 0.0),
        rotor_spin,
        materials["rotor"],
        collection,
    )
    create_gyro_cylinder(
        "Gyroscope Rotor Hub",
        0.125 * scale,
        0.14 * scale,
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0),
        rotor_spin,
        materials["frame"],
        collection,
    )
    create_gyro_sphere(
        "Gyroscope Rotor Motion Marker",
        0.070 * scale,
        (rotor_radius, 0.0, 0.0),
        rotor_spin,
        materials["marker"],
        collection,
    )

    create_gyro_torus(
        "Gyroscope Outer Gimbal Ring",
        0.61 * scale,
        0.023 * scale,
        (math.pi / 2.0, 0.0, 0.0),
        orientation,
        materials["frame"],
        collection,
    )
    create_gyro_sphere(
        "Gyroscope Central Body",
        0.145 * scale,
        (0.0, 0.0, 0.0),
        orientation,
        materials["frame"],
        collection,
    )

    axis_half_length = 0.92 * scale
    create_gyro_cylinder(
        "Gyroscope Spin Axis Shaft",
        0.026 * scale,
        2.0 * axis_half_length,
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0),
        orientation,
        materials["axis"],
        collection,
    )
    axis_arrow_mesh = create_arrow_mesh(
        "Gyroscope Spin Axis Arrow Mesh", materials["axis"]
    )
    axis_arrow = bpy.data.objects.new("Gyroscope Spin Vector Arrowhead", axis_arrow_mesh)
    collection.objects.link(axis_arrow)
    axis_arrow.parent = orientation
    axis_arrow.location = (0.0, 0.0, axis_half_length)
    axis_arrow.scale = (0.25 * scale,) * 3

    debug_orientation = None
    if SHOW_LOCAL_PRECESSION_VECTOR:
        debug_orientation = bpy.data.objects.new("LocalLTVectorOrientation", None)
        collection.objects.link(debug_orientation)
        debug_orientation.parent = root
        debug_orientation.rotation_mode = "QUATERNION"
        debug_length = 0.72 * scale
        create_gyro_cylinder(
            "Local LT Vector Shaft",
            0.018 * scale,
            debug_length,
            (0.0, 0.0, 0.5 * debug_length),
            (0.0, 0.0, 0.0),
            debug_orientation,
            materials["debug"],
            collection,
        )
        debug_mesh = create_arrow_mesh(
            "Local LT Vector Arrow Mesh", materials["debug"]
        )
        debug_arrow = bpy.data.objects.new("Local LT Vector Arrowhead", debug_mesh)
        collection.objects.link(debug_arrow)
        debug_arrow.parent = debug_orientation
        debug_arrow.location = (0.0, 0.0, debug_length)
        debug_arrow.scale = (0.19 * scale,) * 3

    samples = precompute_gyroscope_animation()
    minimum_quaternion_dot = keyframe_gyroscope(
        root, orientation, debug_orientation, samples
    )
    return {
        "root": root,
        "orientation": orientation,
        "rotor_spin": rotor_spin,
        "samples": samples,
        "minimum_quaternion_dot": minimum_quaternion_dot,
    }


def validate_gyroscope(gyro_record):
    if gyro_record is None:
        return {
            "gyro_samples": 0,
            "gyro_spin_deflection_deg": 0.0,
            "gyro_max_radius_error": 0.0,
            "gyro_min_quaternion_dot": 1.0,
        }

    samples = gyro_record["samples"]
    radius_error = max(
        abs(sample["position"].length - GYRO_ORBIT_RADIUS) for sample in samples
    )
    spin_norm_error = max(abs(sample["spin"].length - 1.0) for sample in samples)
    start_spin = samples[0]["spin"]
    end_spin = samples[-1]["spin"]
    cosine = min(max(start_spin.dot(end_spin), -1.0), 1.0)
    deflection = math.degrees(math.acos(cosine))
    minimum_quaternion_dot = gyro_record["minimum_quaternion_dot"]

    if radius_error > 1.0e-6:
        raise RuntimeError("Gyroscope orbit radius drifted numerically")
    if spin_norm_error > 1.0e-6:
        raise RuntimeError("Gyroscope spin normalization drifted numerically")
    if minimum_quaternion_dot < 0.0:
        raise RuntimeError("Gyroscope quaternion continuity check failed")

    return {
        "gyro_samples": len(samples),
        "gyro_spin_deflection_deg": deflection,
        "gyro_max_radius_error": radius_error,
        "gyro_min_quaternion_dot": minimum_quaternion_dot,
    }


# =============================================================================
# ENVIRONMENT, CAMERA, LIGHTS, COMPOSITOR, AND RENDER
# =============================================================================

def create_world():
    world = bpy.data.worlds.new("Near Black Blue Violet World")
    bpy.context.scene.world = world

    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputWorld")
    output.location = (680, 0)
    background = nodes.new("ShaderNodeBackground")
    background.location = (440, 0)
    set_input(background, "Strength", 0.34)

    texcoord = nodes.new("ShaderNodeTexCoord")
    texcoord.location = (-760, 0)
    dot = nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    dot.location = (-535, 0)
    dot.inputs[1].default_value = (0.18, -0.35, 0.92)
    map_range = nodes.new("ShaderNodeMapRange")
    map_range.location = (-310, 0)
    map_range.inputs[1].default_value = -1.0
    map_range.inputs[2].default_value = 1.0
    map_range.inputs[3].default_value = 0.0
    map_range.inputs[4].default_value = 1.0
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.location = (-70, 0)
    ramp.color_ramp.interpolation = "EASE"
    ramp.color_ramp.elements[0].position = 0.05
    ramp.color_ramp.elements[0].color = (0.0012, 0.0020, 0.0075, 1.0)
    ramp.color_ramp.elements[1].position = 0.95
    ramp.color_ramp.elements[1].color = (0.014, 0.0028, 0.026, 1.0)
    middle = ramp.color_ramp.elements.new(0.54)
    middle.color = (0.0025, 0.0065, 0.019, 1.0)

    link_nodes(links, texcoord, "Normal", dot, "Vector")
    links.new(dot.outputs["Value"], map_range.inputs[0])
    links.new(map_range.outputs["Result"], ramp.inputs["Fac"])
    link_nodes(links, ramp, "Color", background, "Color")
    link_nodes(links, background, "Background", output, "Surface")
    return world


def create_dust(collection, material):
    if not ADD_DUST or DUST_COUNT <= 0:
        return None

    rng = random.Random(RANDOM_SEED)
    vertices = []
    faces = []
    inner_radius = BODY_RADIUS * 2.1
    outer_radius = max(GE_OUTER_RADIUS, GM_BOUND_RADIUS) * 1.10

    for _ in range(DUST_COUNT):
        z = rng.uniform(-1.0, 1.0)
        azimuth = rng.uniform(0.0, TAU)
        xy = math.sqrt(max(0.0, 1.0 - z * z))
        direction = Vector((xy * math.cos(azimuth), xy * math.sin(azimuth), z))
        radius = (
            inner_radius ** 3
            + rng.random() * (outer_radius ** 3 - inner_radius ** 3)
        ) ** (1.0 / 3.0)
        center = direction * radius
        size = rng.uniform(0.010, 0.027)
        base = len(vertices)
        vertices.extend(
            [
                center + Vector((size, 0.0, 0.0)),
                center + Vector((-size, 0.0, 0.0)),
                center + Vector((0.0, size, 0.0)),
                center + Vector((0.0, -size, 0.0)),
                center + Vector((0.0, 0.0, size)),
                center + Vector((0.0, 0.0, -size)),
            ]
        )
        faces.extend(
            [
                (base + 4, base + 0, base + 2),
                (base + 4, base + 2, base + 1),
                (base + 4, base + 1, base + 3),
                (base + 4, base + 3, base + 0),
                (base + 5, base + 2, base + 0),
                (base + 5, base + 1, base + 2),
                (base + 5, base + 3, base + 1),
                (base + 5, base + 0, base + 3),
            ]
        )

    mesh = bpy.data.meshes.new("Sparse Atmospheric Dust Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    mesh.update()
    obj = bpy.data.objects.new("Sparse Atmospheric Dust", mesh)
    collection.objects.link(obj)
    return obj


def add_area_light(name, location, energy, color, size, collection):
    light_data = bpy.data.lights.new(name, type="AREA")
    light_data.energy = energy
    light_data.color = color
    light_data.shape = "DISK"
    light_data.size = size
    obj = bpy.data.objects.new(name, light_data)
    collection.objects.link(obj)
    obj.location = Vector(location)
    look_at(obj)
    return obj


def create_camera(collections):
    collection = collections["Camera and Lights"]

    rig = bpy.data.objects.new("Camera Orbit Rig", None)
    collection.objects.link(rig)
    rig.empty_display_type = "PLAIN_AXES"
    rig.empty_display_size = BODY_RADIUS * 0.5

    camera_data = bpy.data.cameras.new("GEM Three Quarter Camera")
    camera_data.lens = CAMERA_LENS_MM
    camera_data.sensor_width = 36.0
    camera_data.clip_start = 0.05
    camera_data.clip_end = 250.0
    camera = bpy.data.objects.new("GEM Three Quarter Camera", camera_data)
    collection.objects.link(camera)

    visible_radius = max(
        BODY_RADIUS * 2.0,
        GE_OUTER_RADIUS if SHOW_GRAVITOELECTRIC else 0.0,
        GM_BOUND_RADIUS if SHOW_GRAVITOMAGNETIC else 0.0,
    )
    camera_distance = visible_radius * 6.10
    view_direction = Vector((0.72, -0.88, 0.52)).normalized()
    camera.location = view_direction * camera_distance
    look_at(camera, (0.0, 0.0, 0.05))
    camera.parent = rig

    if USE_DEPTH_OF_FIELD:
        focus = bpy.data.objects.new("Camera Focus at Mass", None)
        collection.objects.link(focus)
        focus.location = (0.0, 0.0, 0.0)
        camera_data.dof.use_dof = True
        camera_data.dof.focus_object = focus
        camera_data.dof.aperture_fstop = 11.0

    if ANIMATE_CAMERA:
        rig.rotation_mode = "XYZ"
        amplitude = math.radians(2.2)
        expression = (
            f"{amplitude:.12f} * sin({TAU:.12f} * "
            f"(frame - {FRAME_START}) / {float(FRAME_COUNT):.9f})"
        )
        set_linear_driver(rig, "rotation_euler", 2, expression)

    bpy.context.scene.camera = camera
    return camera, rig


def create_lighting(collections):
    collection = collections["Camera and Lights"]
    add_area_light(
        "Cool Soft Key",
        (5.4, -6.2, 7.8),
        1425.0,
        (0.40, 0.58, 1.00),
        5.2,
        collection,
    )
    add_area_light(
        "Magenta Rim",
        (-5.8, 3.9, 4.2),
        825.0,
        (1.00, 0.16, 0.38),
        4.1,
        collection,
    )
    add_area_light(
        "Dim Lower Fill",
        (2.0, 5.2, -3.2),
        440.0,
        (0.24, 0.32, 0.58),
        5.6,
        collection,
    )


def setup_compositor():
    scene = bpy.context.scene
    tree = bpy.data.node_groups.new("GEM Glow Compositor", "CompositorNodeTree")
    scene.compositing_node_group = tree
    scene.render.use_compositing = True
    nodes = tree.nodes
    links = tree.links

    # Blender 5 replaces the old Composite node with the first Color output on
    # a compositor node group's Group Output node.
    tree.interface.new_socket(
        name="Image", in_out="OUTPUT", socket_type="NodeSocketColor"
    )

    render_layers = nodes.new("CompositorNodeRLayers")
    render_layers.location = (-420, 0)
    glare = nodes.new("CompositorNodeGlare")
    glare.location = (-160, 0)
    # Blender 5.2 exposes compositor settings as node sockets rather than RNA
    # properties. "Image" is the tasteful original-plus-glare result.
    set_input(glare, "Type", "Fog Glow")
    set_input(glare, "Quality", "High")
    set_input(glare, "Threshold", 0.72)
    set_input(glare, "Strength", 0.78)
    set_input(glare, "Saturation", 0.94)
    set_input(glare, "Size", 0.72)

    contrast = nodes.new("CompositorNodeBrightContrast")
    contrast.location = (100, 0)
    contrast.inputs["Bright"].default_value = -0.5
    contrast.inputs["Contrast"].default_value = 3.5

    group_output = nodes.new("NodeGroupOutput")
    group_output.location = (350, 0)
    group_output.is_active_output = True

    links.new(render_layers.outputs["Image"], glare.inputs["Image"])
    links.new(glare.outputs["Image"], contrast.inputs["Image"])
    links.new(contrast.outputs["Image"], group_output.inputs["Image"])


def setup_render():
    scene = bpy.context.scene

    selected_engine = set_enum_property(
        scene.render, "engine", ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE")
    )
    if selected_engine is None:
        raise RuntimeError("This Blender build does not expose the Eevee render engine")

    scene.frame_start = FRAME_START
    scene.frame_end = FRAME_END
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    scene.render.resolution_x = RENDER_RESOLUTION_X
    scene.render.resolution_y = RENDER_RESOLUTION_Y
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = 1.0
    scene.render.pixel_aspect_y = 1.0
    scene.render.film_transparent = False
    scene.render.use_file_extension = True
    scene.render.filepath = OUTPUT_PATH

    # Blender has renamed some Eevee sampling properties across 5.x builds.
    eevee = getattr(scene, "eevee", None)
    if eevee is not None:
        for property_name in ("taa_samples", "taa_render_samples"):
            if hasattr(eevee, property_name):
                setattr(eevee, property_name, RENDER_SAMPLES)

    output_format = OUTPUT_FORMAT.upper()
    if output_format == "PNG":
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.image_settings.color_depth = "8"
        scene.render.image_settings.compression = 35
    elif output_format == "FFMPEG":
        scene.render.image_settings.file_format = "FFMPEG"
        scene.render.ffmpeg.format = "MPEG4"
        scene.render.ffmpeg.codec = "H264"
        scene.render.ffmpeg.constant_rate_factor = "HIGH"
        scene.render.ffmpeg.ffmpeg_preset = "GOOD"
        scene.render.ffmpeg.audio_codec = "NONE"
    else:
        raise ValueError("OUTPUT_FORMAT must be 'PNG' or 'FFMPEG'")

    set_enum_property(scene.view_settings, "view_transform", ("AgX", "Standard"))
    set_enum_property(
        scene.view_settings,
        "look",
        (
            "AgX - Medium High Contrast",
            "Medium High Contrast",
            "AgX - Medium Low Contrast",
            "Medium Low Contrast",
            "None",
        ),
    )
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0


# =============================================================================
# VALIDATION AND MAIN BUILD
# =============================================================================

def validate_configuration():
    if BODY_RADIUS <= 0.0:
        raise ValueError("BODY_RADIUS must be positive")
    if STAR_EQUATORIAL_RADIUS <= 0.0 or STAR_POLAR_RADIUS <= 0.0:
        raise ValueError("Compact-star radii must be positive")
    if STAR_POLAR_RADIUS > STAR_EQUATORIAL_RADIUS:
        raise ValueError("A rapidly rotating oblate star requires polar <= equatorial radius")
    if SHOW_GYROSCOPE:
        if GYRO_SCALE <= 0.0:
            raise ValueError("GYRO_SCALE must be positive")
        if GYRO_ORBIT_RADIUS <= STAR_EQUATORIAL_RADIUS + 0.7 * GYRO_SCALE:
            raise ValueError("GYRO_ORBIT_RADIUS must keep the gyroscope outside the star")
        if Vector(GYRO_INITIAL_SPIN).length_squared < 1.0e-18:
            raise ValueError("GYRO_INITIAL_SPIN must be nonzero")
    if FIELD_SURFACE_GAP <= 0.0:
        raise ValueError("FIELD_SURFACE_GAP must be positive")
    if SHOW_GRAVITOELECTRIC:
        if GE_LINE_COUNT < 1:
            raise ValueError("GE_LINE_COUNT must be at least 1")
        if GE_OUTER_RADIUS <= BODY_RADIUS + FIELD_SURFACE_GAP:
            raise ValueError("GE_OUTER_RADIUS must lie outside the mass")
    if SHOW_GRAVITOMAGNETIC:
        if GM_SEED_COUNT < 1:
            raise ValueError("GM_SEED_COUNT must be at least 1")
        if GM_STEP_SIZE <= 0.0 or GM_MAX_STEPS < 1:
            raise ValueError("GM integration settings must be positive")
        if GM_SEED_RADIUS_MIN <= BODY_RADIUS + FIELD_SURFACE_GAP:
            raise ValueError("GM seeds must lie outside the mass")
        if GM_SEED_RADIUS_MAX >= GM_BOUND_RADIUS:
            raise ValueError("GM_SEED_RADIUS_MAX must be inside GM_BOUND_RADIUS")

    north = gravitomagnetic_field(Vector((0.0, 0.0, 2.0 * BODY_RADIUS)))
    equator = gravitomagnetic_field(Vector((2.0 * BODY_RADIUS, 0.0, 0.0)))
    if north.z <= 0.0 or equator.z >= 0.0:
        raise RuntimeError("Dipole field sanity check failed for J = +Z")


def validate_constructed_fields(ge_records, gm_records):
    stop_radius = BODY_RADIUS + FIELD_SURFACE_GAP

    for _, points in ge_records:
        tangent = (points[-1] - points[0]).normalized()
        outward = points[0].normalized()
        if tangent.dot(outward) > -0.999:
            raise RuntimeError("A gravitoelectric line is not directed inward")
        if abs(points[-1].length - stop_radius) > 1.0e-5:
            raise RuntimeError("A gravitoelectric line does not stop above the surface")

    positive_segments = 0
    tested_segments = 0
    surface_terminated = 0
    for record in gm_records:
        points = record["points"]
        if record["backward_end"] == "surface" and record["forward_end"] == "surface":
            surface_terminated += 1
        stride = max(1, len(points) // 24)
        for index in range(0, len(points) - 1, stride):
            tangent = points[index + 1] - points[index]
            midpoint = 0.5 * (points[index + 1] + points[index])
            field = gravitomagnetic_field(midpoint)
            if tangent.length_squared < 1.0e-16 or field.length_squared < 1.0e-20:
                continue
            tested_segments += 1
            if tangent.dot(field) > 0.0:
                positive_segments += 1

    if gm_records and surface_terminated != len(gm_records):
        raise RuntimeError(
            f"Only {surface_terminated}/{len(gm_records)} GM lines reached both surfaces; "
            "increase GM_MAX_STEPS or adjust the bounds"
        )
    if tested_segments and positive_segments / tested_segments < 0.98:
        raise RuntimeError("Gravitomagnetic curve ordering is inconsistent with +Bg")

    return {
        "ge_lines": len(ge_records),
        "gm_lines": len(gm_records),
        "gm_surface_terminated": surface_terminated,
        "gm_direction_fraction": (
            positive_segments / tested_segments if tested_segments else 1.0
        ),
    }


def build_scene():
    validate_configuration()
    clear_scene()
    collections = create_collections()
    create_world()

    ge_materials, gm_materials, rotation_material, axis_material = (
        make_field_materials()
    )
    mass_material = make_mass_material()
    halo_material = make_halo_material()
    dust_material = make_emission_material(
        "Faint Dust", (0.22, 0.32, 0.72, 1.0), 1.15
    )

    ge_arrow_mesh = create_arrow_mesh("GE Tapered Arrow Mesh", ge_materials[2])
    gm_arrow_mesh = create_arrow_mesh("GM Tapered Arrow Mesh", gm_materials[2])
    rotation_arrow_mesh = create_arrow_mesh(
        "Rotation Tapered Arrow Mesh", rotation_material
    )
    ge_pulse_mesh = create_unit_icosphere_mesh("GE Pulse Mesh", ge_materials[2])
    gm_pulse_mesh = create_unit_icosphere_mesh("GM Pulse Mesh", gm_materials[2])

    mass, _halo = create_mass(collections, mass_material, halo_material)
    create_rotation_cues(
        collections, rotation_material, axis_material, rotation_arrow_mesh
    )
    ge_records = create_gravitoelectric_field(
        collections, ge_materials, ge_arrow_mesh, ge_pulse_mesh
    )
    gm_records = create_gravitomagnetic_field(
        collections, gm_materials, gm_arrow_mesh, gm_pulse_mesh
    )
    gyro_record = create_gyroscope(collections)

    create_dust(collections["Environment"], dust_material)
    create_camera(collections)
    create_lighting(collections)
    setup_compositor()
    setup_render()

    validation = validate_constructed_fields(ge_records, gm_records)
    validation.update(validate_gyroscope(gyro_record))

    scene = bpy.context.scene
    scene.frame_set(FRAME_START)
    bpy.context.view_layer.objects.active = mass
    mass.select_set(True)

    print("=" * 72)
    print("GEM VISUALIZATION BUILD COMPLETE")
    print(f"Blender version: {bpy.app.version_string}")
    print(f"Frames: {FRAME_START}-{FRAME_END} at {FPS} fps")
    print(f"Gravitoelectric lines: {validation['ge_lines']}")
    print(f"Gravitomagnetic RK4 lines: {validation['gm_lines']}")
    print(
        "GM lines reaching both body surfaces: "
        f"{validation['gm_surface_terminated']}"
    )
    print(
        "GM sampled tangent agreement with +Bg: "
        f"{100.0 * validation['gm_direction_fraction']:.1f}%"
    )
    print(f"Gyroscope animation samples: {validation['gyro_samples']}")
    print(
        "Gyroscope accumulated spin-axis deflection: "
        f"{validation['gyro_spin_deflection_deg']:.2f} degrees"
    )
    print(
        "Gyroscope minimum adjacent quaternion dot: "
        f"{validation['gyro_min_quaternion_dot']:.6f}"
    )
    print(f"Output: {OUTPUT_PATH} ({OUTPUT_FORMAT.upper()})")
    print("=" * 72)
    return validation


if __name__ == "__main__":
    build_scene()
