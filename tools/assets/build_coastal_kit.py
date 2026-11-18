"""Generate the original Vibe Town coastal rowhouse kit with Blender."""
import sys
from pathlib import Path

import bpy

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)


def material(name, color):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1.0)
    result.use_nodes = True
    result.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (*color, 1.0)
    return result


def box(name, position, size, surface):
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    obj.data.materials.append(surface)
    return obj


def roof(name, width, depth, eave, rise, surface):
    x, y = width / 2, depth / 2
    surface_points = [
        (-x, -y, eave), (x, -y, eave), (x, y, eave), (-x, y, eave),
        (0, -y, eave + rise), (0, y, eave + rise),
    ]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(surface_points, [], [(0, 1, 4), (3, 5, 2), (0, 4, 5, 3), (4, 1, 2, 5), (0, 3, 2, 1)])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(surface)


for suffix, wall_color, roof_color in [
    ("sand", (0.76, 0.47, 0.27), (0.24, 0.16, 0.12)),
    ("cedar", (0.51, 0.26, 0.18), (0.15, 0.24, 0.23)),
    ("sage", (0.38, 0.53, 0.39), (0.22, 0.25, 0.30)),
]:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    wall = material("Painted board", wall_color)
    tiles = material("Roof tile", roof_color)
    sill = material("Trim", (0.78, 0.77, 0.62))
    glass = material("Glass", (0.11, 0.23, 0.25))
    concrete = material("Footing", (0.39, 0.36, 0.28))
    box("Footing", (0, 0, 0.5), (19, 16, 1), concrete)
    box("Main volume", (0, 0, 4.9), (17.8, 14.8, 8.8), wall)
    roof("Gable", 20, 17, 9.3, 4.2, tiles)
    box("Chimney", (-5, 3.3, 11.4), (2, 2, 5.2), wall)
    for z in [3.4, 6.8]:
        for x in [-5.7, 0, 5.7]:
            for side in [-1, 1]:
                box("Window trim", (x, side * 7.45, z), (2.7, 0.28, 2.1), sill)
                box("Window glazing", (x, side * 7.58, z), (2.25, 0.1, 1.62), glass)
    box("Entry", (0, -7.52, 1.85), (2.2, 0.6, 2.7), tiles)
    box("Entry step", (0, -8.2, 0.35), (3.8, 2.2, 0.7), concrete)
    output = Path(sys.argv[-1]).resolve() / f"coastal-{suffix}.glb"
    bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", export_yup=True)
