# Builds a MINIATURE version of Surat's Cable Bridge (Pandit Dindayal Upadhyay Bridge over the Tapi) for the game.
#
#   blender.exe -b --factory-startup --python resources/make_cable_bridge.py
#
# Writes: resources/cable-bridge.blend, static/cableBridge/cableBridge.glb, resources/cable-bridge-preview/*.png
#
# FROM THE REAL BRIDGE (sources: Wikipedia / Surat Municipal Corporation): cable-stayed, 2 pylons, 48 cables,
# a wide 4-lane deck, 15 spans. The real one is 918 m long; ours is a showpiece of about 15 units, the size of
# Bruno's bridge (12 long, 3 high) so it sits in the world like his structures do.
# 48 cables = 4 pylon legs x 12 (6 each way, fanning out from the leg down to the edge of the road).
#
# THE FRAME: bridge length along X, width along Y, up is Z, the ground is z = 0, the middle of the bridge is x = 0.
# The model is ONE visual mesh named "cableBridgePhysical" (fixed: it never moves) with child "colliders":
#    cuboid_*  a box (its Blender scale is its size)        hull_*  a convex solid (the ramps)
# Those names are what the game reads for physics (see Objects.js). The children are not drawn.
import bpy, bmesh, math, os
from mathutils import Matrix, Vector

ROOT = r"D:\P3Q\research\surat-world"
PALETTE = os.path.join(ROOT, "static", "palette.png")
OUT_BLEND = os.path.join(ROOT, "resources", "cable-bridge.blend")
OUT_GLB = os.path.join(ROOT, "static", "cableBridge", "cableBridge.glb")
PREVIEW = os.path.join(ROOT, "resources", "cable-bridge-preview")

# Palette squares (static/palette.png, see Materials.js)
SW = dict(girder=0, cream=1, kerb=4, road=6, yellow=8, orange=15, red=19, white=17, sky=3, dark=22, cable=23)

# ---- measurements (game units). The car is about 3 long, 2 wide and 2 tall. ----
DECK_TOP = 0.9        # height of the road above the ground (a car's wheel is 0.4 high: easy to climb)
SLAB = 0.3            # thickness of the road slab
HALF_DECK = 4.0       # the flat part runs from -4 to +4
RAMP = 3.6            # each ramp is 3.6 long: slope about 14 degrees, like Bruno's ramps
WIDTH = 4.6           # road width incl. kerbs: a bit over two car widths
KERB = 0.3            # kerb width and height
PYLON_X = 2.0         # where the two pylons stand
LEG_Y = 2.55          # the legs stand just outside the road edge, left and right
PYLON_TOP = 5.0       # a bit more than twice the car's height
PIER_X = 3.0
FOOT = -1.5           # pylons and piers sink this far into the ground (hidden)

def say(m): print("@@LOG@@ " + m)
for _ob in list(bpy.data.objects):
    bpy.data.objects.remove(_ob, do_unlink=True)

def tag(verts, sw):
    for v in verts:
        for f in v.link_faces:
            f.material_index = sw

def box(bm, x0, x1, y0, y1, z0, z1, sw):
    m = Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)) @ Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1))
    tag(bmesh.ops.create_cube(bm, size=1.0, matrix=m)["verts"], sw)

def hull(bm, pts, sw):
    vs = [bm.verts.new(p) for p in pts]
    res = bmesh.ops.convex_hull(bm, input=vs)
    for g in res["geom"]:
        if isinstance(g, bmesh.types.BMFace):
            g.material_index = sw

def new_object(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob

# side profile of one ramp (x, z): buried bottom, down to the ground at the far end, up to deck height
FAR = HALF_DECK + RAMP
RAMP_PROFILE = [(HALF_DECK, -0.3), (FAR, -0.3), (FAR, 0.0), (HALF_DECK, DECK_TOP)]
KERB_PROFILE = [(HALF_DECK, DECK_TOP), (FAR, 0.0), (FAR, KERB), (HALF_DECK, DECK_TOP + KERB)]
GIRDER = 0.25         # the darker beam under the road slab

# ---------------------------------------------------------------- the visible bridge
v = bmesh.new()

# The road slab, a darker girder under it, and the kerbs along both edges
box(v, -HALF_DECK, HALF_DECK, -WIDTH / 2, WIDTH / 2, DECK_TOP - SLAB, DECK_TOP, SW["road"])
box(v, -HALF_DECK, HALF_DECK, -WIDTH / 2 + 0.4, WIDTH / 2 - 0.4, DECK_TOP - SLAB - GIRDER, DECK_TOP - SLAB, SW["girder"])
for s in (1, -1):
    box(v, -HALF_DECK, HALF_DECK, *sorted((s * (WIDTH / 2 - KERB), s * WIDTH / 2)), DECK_TOP, DECK_TOP + KERB, SW["kerb"])
    box(v, -HALF_DECK, HALF_DECK, *sorted((s * 1.75, s * 1.82)), DECK_TOP, DECK_TOP + 0.01, SW["yellow"])    # edge line
# dashed white line down the middle
x = -HALF_DECK + 0.5
while x < HALF_DECK - 0.5:
    box(v, x, x + 0.55, -0.04, 0.04, DECK_TOP, DECK_TOP + 0.012, SW["white"])
    x += 1.1

# The two ramps (solid wedges) with sloping kerbs
for sx in (1, -1):
    hull(v, [(sx * x, y, z) for (x, z) in RAMP_PROFILE for y in (-WIDTH / 2, WIDTH / 2)], SW["road"])
    for s in (1, -1):
        hull(v, [(sx * x, y, z) for (x, z) in KERB_PROFILE for y in sorted((s * (WIDTH / 2 - KERB), s * WIDTH / 2))], SW["kerb"])

# Piers: a short column under each side span
for sx in (1, -1):
    box(v, *sorted((sx * (PIER_X - 0.3), sx * (PIER_X + 0.3))), -1.6, 1.6, FOOT, DECK_TOP - SLAB - GIRDER, SW["girder"])

# The pylons: each is two tapering legs joined by cross beams, with a red light on top of each leg
for sx in (1, -1):
    px_ = sx * PYLON_X
    for s in (1, -1):
        cy = s * LEG_Y
        hull(v, [(px_ + dx * w, cy + dy * w, z) for (w, z) in [(0.3, FOOT), (0.17, PYLON_TOP)] for dx in (-1, 1) for dy in (-1, 1)], SW["white"])
        box(v, px_ - 0.07, px_ + 0.07, cy - 0.07, cy + 0.07, PYLON_TOP, PYLON_TOP + 0.25, SW["red"])
    box(v, px_ - 0.15, px_ + 0.15, -LEG_Y, LEG_Y, PYLON_TOP - 0.55, PYLON_TOP - 0.25, SW["white"])        # top cross beam
    box(v, px_ - 0.15, px_ + 0.15, -LEG_Y, LEG_Y, DECK_TOP + 2.5, DECK_TOP + 2.8, SW["white"])             # lower cross beam, clear of the car

# The 48 cables: each leg has 6 going towards the middle of the bridge and 6 towards the end. They fan out
# from the leg (the farthest cable starts highest) down to the edge of the road.
def cable(bm, a, b, thickness=0.025):
    ax, ay, az = a
    bx, by, bz = b
    dx, dz = bx - ax, bz - az
    ln = math.hypot(dx, dz)
    nx, nz = -dz / ln, dx / ln
    pts = []
    for (cx, cz) in ((ax, az), (bx, bz)):
        for o in (-1, 1):
            for dy in (-1, 1):
                pts.append((cx + nx * thickness * o, ay + dy * thickness, cz + nz * thickness * o))
    hull(bm, pts, SW["cable"])

count = 0
for sx in (1, -1):
    for s in (1, -1):
        for direction in (-1, 1):
            for k in range(1, 7):
                anchor_x = sx * (PYLON_X + direction * sx * 0.3 * k)
                top_z = 2.9 + 0.3 * k
                cable(v, (sx * PYLON_X, s * (LEG_Y - 0.1), top_z), (anchor_x, s * (LEG_Y - 0.1), DECK_TOP + KERB))
                count += 1
say(f"{count} cables")

# ---------------------------------------------------------------- the invisible colliders (children, named for the game)
colliders = []
def cuboid(name, x0, x1, y0, y1, z0, z1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    ob = new_object(name, bm)
    ob.location = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    ob.scale = (x1 - x0, y1 - y0, z1 - z0)           # the size of the box = the object's scale (NOT applied)
    colliders.append(ob)

def hull_collider(name, pts):
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    bmesh.ops.convex_hull(bm, input=vs)
    colliders.append(new_object(name, bm))        # points stored directly, so scale stays 1

cuboid("cuboid_deck", -HALF_DECK, HALF_DECK, -WIDTH / 2, WIDTH / 2, DECK_TOP - SLAB, DECK_TOP)
for s in (1, -1):
    cuboid(f"cuboid_kerb{'L' if s > 0 else 'R'}", -HALF_DECK, HALF_DECK, *sorted((s * (WIDTH / 2 - KERB), s * WIDTH / 2)), DECK_TOP, DECK_TOP + KERB)
for sx in (1, -1):
    end = 'A' if sx > 0 else 'B'
    hull_collider(f"hull_ramp{end}", [(sx * x, y, z) for (x, z) in RAMP_PROFILE for y in (-WIDTH / 2, WIDTH / 2)])
    for s in (1, -1):
        hull_collider(f"hull_rampKerb{end}{'L' if s > 0 else 'R'}", [(sx * x, y, z) for (x, z) in KERB_PROFILE for y in sorted((s * (WIDTH / 2 - KERB), s * WIDTH / 2))])
    cuboid(f"cuboid_pier{end}", *sorted((sx * (PIER_X - 0.3), sx * (PIER_X + 0.3))), -1.6, 1.6, FOOT, DECK_TOP - SLAB)
    for s in (1, -1):
        cuboid(f"cuboid_leg{end}{'L' if s > 0 else 'R'}", sx * PYLON_X - 0.2, sx * PYLON_X + 0.2, s * LEG_Y - 0.2, s * LEG_Y + 0.2, FOOT, PYLON_TOP)

# ---------------------------------------------------------------- UVs and material (same palette trick as the car)
layer = v.loops.layers.uv.verify()
for f in v.faces:
    u = (f.material_index * 4 + 2) / 128.0
    for loop in f.loops:
        loop[layer].uv = (u, 0.5)
    f.material_index = 0
    f.smooth = False

palette_img = bpy.data.images.load(PALETTE, check_existing=True)
mat = bpy.data.materials.new("palette")
mat.use_nodes = True
tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = palette_img
tex.interpolation = "Closest"
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 1.0
mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

bridge = new_object("cableBridgePhysical", v)
bridge.data.materials.append(mat)
for c in colliders:
    c.parent = bridge        # the parent sits at the origin with no rotation, so nothing moves
    c.hide_render = True     # invisible boxes: do not draw them in the preview pictures
bpy.context.view_layer.update()
say(f"visual: {len(bridge.data.vertices)} vertices; {len(colliders)} colliders")

# ---------------------------------------------------------------- preview renders
scn = bpy.context.scene
scn.render.engine = "BLENDER_WORKBENCH"
scn.display.shading.light = "STUDIO"
scn.display.shading.color_type = "TEXTURE"
scn.render.resolution_x, scn.render.resolution_y = 1000, 560
scn.world = bpy.data.worlds.new("w"); scn.world.color = (0.75, 0.82, 0.9)
cam_data = bpy.data.cameras.new("cam"); cam_data.lens = 35
cam = bpy.data.objects.new("cam", cam_data); scn.collection.objects.link(cam); scn.camera = cam
gbm = bmesh.new(); box(gbm, -9, 9, -6, 6, -0.3, -0.01, SW["cream"])
lay = gbm.loops.layers.uv.verify()
for f in gbm.faces:
    for loop in f.loops:
        loop[lay].uv = ((SW["cream"] * 4 + 2) / 128.0, 0.5)
ground = new_object("ground", gbm); ground.data.materials.append(mat)
os.makedirs(PREVIEW, exist_ok=True)
for name, pos, target in [("three-quarter", (7, -10, 5), (0, 0, 1.5)), ("side", (0, -15, 2.5), (0, 0, 2)),
                          ("driver", (-11, 0, 2.5), (0, 0, 1.8)), ("top", (0.1, 0, 20), (0, 0, 0))]:
    cam.location = pos
    cam.rotation_euler = (Vector(target) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
    scn.render.filepath = os.path.join(PREVIEW, name + ".png")
    bpy.ops.render.render(write_still=True)
bpy.data.objects.remove(ground, do_unlink=True)
bpy.data.objects.remove(cam, do_unlink=True)

# ---------------------------------------------------------------- save + export
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, copy=True)
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=False, export_apply=True,
                          export_yup=True, export_cameras=False, export_lights=False)
say(f"exported {OUT_GLB} ({os.path.getsize(OUT_GLB)} bytes)")
print("@@DONE@@")
