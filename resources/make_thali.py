# Game export: the Surat KHAMAN THALI for Surat World.
#   blender.exe -b --python resources/make_thali.py
# Writes: static/khaman/khaman.glb  (World.js setKhaman reads it)
#
# It appends the four LOCKED studio models from the scratchpad .blend files, converts their PBR
# materials to the game's flat PALETTE swatches (static/palette.png), adds colliders, names the
# nodes the game expects, and exports one Y-up GLB.
#
# GLB nodes:
#   khamanPhysicalDynamic   one soft/porous khaman + baked seeds, + cuboid_k       (World instances 6)
#   onion/chili/curryleaf/sevPhysicalDynamic   13 LOOSE toppings (own node + cuboid_t each); their node
#                           position is where they sit on the khaman, so World puts a set on every piece
#   servingPlatePhysical    the big scalloped platter, rim flattened to a low lip (collider built in World.js)
#   chutneyBowl             the chutney bowl (scenery)
#   onionBowl               the onion plate (scenery)
import bpy, bmesh, math, os, re
from mathutils import Vector, Matrix

ROOT = r"D:\P3Q\research\surat-world"
SCRATCH = r"C:\Users\Vansh\AppData\Local\Temp\claude\D--P3Q-research\01343f68-53b9-4556-bd9b-eca4b885edd7\scratchpad"
PALETTE = os.path.join(ROOT, "static", "palette.png")
OUT_GLB = os.path.join(ROOT, "static", "khaman", "khaman.glb")

# material base-name -> palette swatch index
MAT2SW = {
    "Khaman Yellow": 24, "Khaman Pore": 25,
    "Mustard": 22, "Sesame": 23, "Sev": 8,
    "Green Chili": 26, "Fresh Green Chili": 26, "Chili Inner Green": 26, "Chili Seeds": 1,
    # The chutney: a VIVID light-green filling (swatch 31; a dark green turned grey-purple in the bowl's
    # shadow), with dark herb flecks on top. (The swirl on top is a mid green, see OBJ2SW.)
    "Curry Leaf": 27, "Chutney Dark Herbs": 27, "Fresh Green Chutney": 31,
    "Onion Purple": 28, "Onion Outer Purple": 28, "Onion Purple Edge": 28,
    "Onion Pale": 29, "Onion Light Purple": 29,
    "Onion White": 30, "Onion Inner Flesh": 30,
    "Cream Ceramic": 1, "Warm Cream Ceramic": 1,
}
DEFAULT_SW = 24

# object name -> swatch, for objects that should differ from their material's usual colour
OBJ2SW = {
    "Chutney Central Swirl": 26,   # a mid-green swirl on the vivid chutney, so it shows up
}

# studio objects whose faces point INTO the mesh (their normals are inverted). Blender's renderer does not
# mind, but in the game the surface then lights as if it faced away from the sun and looks dark and grey.
FLIP_NORMALS = {"Green Chutney"}

def basemat(name):
    return re.sub(r"\.\d+$", "", name)

def say(m): print("@@LOG@@ " + m)

# clean
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for c in list(bpy.data.collections):
    bpy.data.collections.remove(c)

# shared palette material
palimg = bpy.data.images.load(PALETTE, check_existing=True)
PAL = bpy.data.materials.new("palette"); PAL.use_nodes = True
tex = PAL.node_tree.nodes.new("ShaderNodeTexImage"); tex.image = palimg; tex.interpolation = "Closest"
bsdf = PAL.node_tree.nodes["Principled BSDF"]; bsdf.inputs["Roughness"].default_value = 1.0
PAL.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

scene = bpy.context.scene

def append(blendfile):
    path = os.path.join(SCRATCH, blendfile)
    before = set(bpy.data.objects)
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = list(src.objects)
    out = []
    for o in bpy.data.objects:
        if o in before:
            continue
        if o.type not in {"MESH", "CURVE"} or o.name.startswith(("Ground", "Display")):
            continue
        scene.collection.objects.link(o)
        out.append(o)
    return out

def process(obj):
    """curve->mesh, apply modifiers, re-UV every face to its palette swatch, collapse to PAL."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    original_name = obj.name
    if obj.type == "CURVE":
        bpy.ops.object.convert(target="MESH")
        obj = bpy.context.active_object
    for m in list(obj.modifiers):
        try: bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception: obj.modifiers.remove(m)
    me = obj.data
    if basemat(original_name) in FLIP_NORMALS:
        fbm = bmesh.new(); fbm.from_mesh(me)
        bmesh.ops.reverse_faces(fbm, faces=fbm.faces)
        fbm.to_mesh(me); fbm.free()
    swatch_of_slot = [MAT2SW.get(basemat(ms.name), DEFAULT_SW) if ms else DEFAULT_SW for ms in me.materials]
    if basemat(original_name) in OBJ2SW:
        swatch_of_slot = [OBJ2SW[basemat(original_name)]] * max(len(swatch_of_slot), 1)
    if not swatch_of_slot:
        swatch_of_slot = [DEFAULT_SW]
    if not me.uv_layers:
        me.uv_layers.new()
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        sw = swatch_of_slot[poly.material_index] if poly.material_index < len(swatch_of_slot) else DEFAULT_SW
        u = (sw * 4 + 2) / 128.0
        for li in poly.loop_indices:
            uv[li].uv = (u, 0.5)
    me.materials.clear()
    me.materials.append(PAL)
    return obj

def join(objs, name):
    objs = [process(o) for o in objs]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    j = bpy.context.active_object
    j.name = name
    return j

def apply_all(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def bbox(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    return (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))

def cuboid(name, sx, sy, sz, center):
    cbm = bmesh.new(); bmesh.ops.create_cube(cbm, size=1.0)
    me = bpy.data.meshes.new(name); cbm.to_mesh(me); cbm.free()
    ob = bpy.data.objects.new(name, me)
    ob.scale = (sx, sy, sz); ob.location = center
    scene.collection.objects.link(ob)
    ob.hide_render = True
    return ob

# ---------------- KHAMAN (body + tiny baked seeds) and its LOOSE toppings ----------------
# The body, the mustard seeds and the sesame are one mesh (the seeds are too small to be loose).
# The bigger toppings (onion, chili, curry leaf, sev) become their OWN nodes, each with a collider, so
# the game can make them separate bodies that tumble off when the khaman is hit. Each keeps its place
# on the khaman as the node's position, so the game can put it back in the right spot.
KH_SCALE = 0.50
src = append("khaman2.blend")

def first_mat(o):
    names = [s.material.name for s in o.material_slots if s.material]
    return basemat(names[0]) if names else ""

LOOSE_KIND = {"Onion Purple": "onion", "Green Chili": "chili", "Curry Leaf": "curryleaf", "Sev": "sev"}
body_parts = [o for o in src if first_mat(o) in ("Khaman Yellow", "Mustard", "Sesame")]
loose_parts = [(o, LOOSE_KIND[first_mat(o)]) for o in src if first_mat(o) in LOOSE_KIND]
say("khaman parts: %d baked, %d loose toppings" % (len(body_parts), len(loose_parts)))

kh = join(body_parts, "khamanPhysicalDynamic")
apply_all(kh)   # bake the joined mesh's own place first, so its origin is the world origin like the toppings'
kh.scale = (KH_SCALE, KH_SCALE, KH_SCALE)
apply_all(kh)
x0, y0, z0, x1, y1, z1 = bbox(kh)
# centre it on the origin in x/y, base at z=0. The SAME shift moves every loose topping too.
SHIFT = Vector((-(x0 + x1) / 2, -(y0 + y1) / 2, -z0))
kh.location = SHIFT
apply_all(kh)
x0, y0, z0, x1, y1, z1 = bbox(kh)
# the collider stops just under the seeds, so the loose toppings rest on it instead of inside it
col = cuboid("cuboid_k", (x1 - x0) * 0.96, (y1 - y0) * 0.96, (z1 - z0) - 0.04, (0, 0, ((z1 - z0) - 0.04) / 2))
col.parent = kh
say("khaman size %.2f x %.2f x %.2f" % (x1 - x0, y1 - y0, z1 - z0))

kept_loose = []
for o, kind in loose_parts:
    t = process(o)
    apply_all(t)   # first bake its own place into the mesh (origin -> world origin) ...
    t.scale = (KH_SCALE, KH_SCALE, KH_SCALE)
    apply_all(t)   # ... so this scale shrinks the position as well as the shape, like the khaman body
    t.location = SHIFT
    apply_all(t)
    # put the node's origin at the topping's own centre; the offset on the khaman becomes the node position
    tx0, ty0, tz0, tx1, ty1, tz1 = bbox(t)
    centre = Vector(((tx0 + tx1) / 2, (ty0 + ty1) / 2, (tz0 + tz1) / 2))
    # two toppings of the same kind in the same spot (the studio file has a doubled sev) would shove each other
    if any(k == kind and (centre - c).length < 0.06 for k, c in kept_loose):
        say("skipping a duplicate %s at the same spot" % kind)
        mesh = t.data
        bpy.data.objects.remove(t, do_unlink=True)
        bpy.data.meshes.remove(mesh)
        continue
    kept_loose.append((kind, centre))
    t.data.transform(Matrix.Translation(-centre))
    t.location = centre
    t.name = "%sPhysicalDynamic" % kind
    # a box collider (never thinner than 0.06, so a thin leaf cannot slip through the khaman)
    tc = cuboid("cuboid_t", max(tx1 - tx0, 0.06), max(ty1 - ty0, 0.06), max(tz1 - tz0, 0.06), (0, 0, 0))
    tc.parent = t
say("exported %d loose toppings" % len(kept_loose))

# ---------------- SERVING PLATE (a movable platter you can drive onto) ----------------
plate = join(append("cream_serving_plate.blend"), "servingPlatePhysical")
apply_all(plate)
# The studio plate has a raised rim 0.69 high, a wall for a car with 0.4-radius wheels. Squash everything
# above z = 0.30 to a fifth of its height: the scalloped outline stays, but the rim becomes a low lip.
RIM_FROM, RIM_KEEP = 0.30, 0.20
for v in plate.data.vertices:
    if v.co.z > RIM_FROM:
        v.co.z = RIM_FROM + (v.co.z - RIM_FROM) * RIM_KEEP
plate.data.update()
# (no collider here: World.js gives the platter a sloped ramp-shaped collider so the car can drive on and off)
px0, py0, pz0, px1, py1, pz1 = bbox(plate)
say("plate radius %.2f, rim height now %.2f" % ((px1 - px0) / 2, pz1 - pz0))

# ---------------- BOWLS (scenery) ----------------
chut = join(append("chutney_bowl.blend"), "chutneyBowl")
chut.scale = (0.70, 0.70, 0.70)
apply_all(chut)
cx0, cy0, cz0, cx1, cy1, cz1 = bbox(chut)
chut.location = (0, 0, -cz0)   # base at z=0
apply_all(chut)

onp = join(append("onion_plate.blend"), "onionBowl")
onp.scale = (0.70, 0.70, 0.70)
apply_all(onp)
ox0, oy0, oz0, ox1, oy1, oz1 = bbox(onp)
onp.location = (0, 0, -oz0)
apply_all(onp)

# ---------------- export ----------------
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=False, export_apply=False,
                          export_yup=True, export_cameras=False, export_lights=False)
say("exported %s (%d bytes)" % (OUT_GLB, os.path.getsize(OUT_GLB)))
print("@@DONE@@")
