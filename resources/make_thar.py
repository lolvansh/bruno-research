# Builds a TOY low-poly Mahindra Thar from simple shapes, in game units, ready for Surat World.
#
#   blender.exe -b --factory-startup --python resources/make_thar.py
#
# Writes: resources/thar-toy.blend   (open it in Blender to edit)
#         static/vehicle/thar.glb    (load with #car=thar)
#         resources/thar-preview/*.png (quick renders to check the shape)
#
# THE FRAME THE GAME EXPECTS (see PhysicsVehicle.js): the car's middle is (0,0,0).
# Front is +X, left is +Y, up is +Z (Blender). Wheel centres are at x +-0.9, y +-0.75, z -0.7,
# the wheel radius is 0.4, so the ground is at z = -1.1.
#
# COLOURS: the game has a palette image (static/palette.png): 24 colours in 4x4 pixel squares.
# Every face is pointed at one square, that is its colour. Change a number in SW below to recolour a part.
import bpy, bmesh, math, os
from mathutils import Matrix, Vector

ROOT = r"D:\P3Q\research\surat-world"
PALETTE = os.path.join(ROOT, "static", "palette.png")
OUT_BLEND = os.path.join(ROOT, "resources", "thar-toy.blend")
OUT_GLB = os.path.join(ROOT, "static", "vehicle", "thar.glb")
PREVIEW = os.path.join(ROOT, "resources", "thar-preview")

# Palette squares (see Materials.js): number -> colour
SW = dict(
    glass=3,      # sky blue
    chrome=4,     # light grey
    dark=22,      # near black (tyres, grille slots, flares, mirrors)
    grey=6,       # dark grey (bumpers, steps, grille backing, snorkel)
    white=17,     # headlight lenses
    orange=15,    # indicators
    red=19,       # tail lights, tow hooks
)

def say(m): print("@@LOG@@ " + m)

# An empty Blender scene still contains a cube, a light and a camera: remove them
for _ob in list(bpy.data.objects):
    bpy.data.objects.remove(_ob, do_unlink=True)

# ---------------------------------------------------------------- tiny modelling helpers
def box(bm, x0, x1, y0, y1, z0, z1, sw):
    m = Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)) @ Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1))
    res = bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    tag(res["verts"], sw)

def cyl(bm, axis, c, radius, length, sw, seg=14):
    rot = Matrix.Rotation(math.pi / 2, 4, "Y" if axis == "X" else "X") if axis in ("X", "Y") else Matrix.Identity(4)
    m = Matrix.Translation(c) @ rot
    res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=radius, radius2=radius, depth=length, matrix=m)
    tag(res["verts"], sw)

def hull(bm, pts, sw):
    vs = [bm.verts.new(p) for p in pts]
    res = bmesh.ops.convex_hull(bm, input=vs)
    faces = [g for g in res["geom"] if isinstance(g, bmesh.types.BMFace)]
    for f in faces:
        f.material_index = sw

def tag(verts, sw):
    for v in verts:
        for f in v.link_faces:
            f.material_index = sw

def new_object(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob

def ctx(ob):
    return bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob])

def cut(ob, cutter):
    mod = ob.modifiers.new("cut", "BOOLEAN")
    mod.object = cutter
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    with ctx(ob):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)

def merge_into(bm_total, ob):
    """Copy a (modified) object's mesh into a bmesh, then delete the object."""
    tmp = bmesh.new()
    tmp.from_mesh(ob.data)
    vmap = {v: bm_total.verts.new(v.co) for v in tmp.verts}
    for f in tmp.faces:
        bm_total.faces.new([vmap[v] for v in f.verts])
    tmp.free()
    bpy.data.objects.remove(ob, do_unlink=True)

WHEELS = [(0.9, 0.75), (0.9, -0.75), (-0.9, 0.75), (-0.9, -0.75)]
WZ = -0.7

# ---------------------------------------------------------------- 1. the painted body (red, changes with the C key)
def arch_cutter():
    bm = bmesh.new()
    for wx, wy in WHEELS:
        side = 1 if wy > 0 else -1
        cyl(bm, "Y", (wx, side * 0.85, WZ), 0.5, 0.9, 0, seg=14)   # a round hole, radius 0.5 (tyre is 0.4)
    return new_object("cutter", bm)

def painted_part(name, x0, x1, y0, y1, z0, z1):
    bm = bmesh.new()
    box(bm, x0, x1, y0, y1, z0, z1, 0)
    ob = new_object(name, bm)
    cut(ob, arch_cutter())
    return ob

tub = painted_part("tub", -1.45, 0.45, -0.72, 0.72, -0.60, 0.10)
hood = painted_part("hood", 0.45, 1.40, -0.68, 0.68, -0.55, 0.00)

# cabin: side view is a trapezoid (raked windscreen at the front, a slightly raked back), painted like the rest
bm = bmesh.new()
profile = [(0.45, 0.10), (0.30, 0.78), (-1.38, 0.78), (-1.45, 0.10)]
hull(bm, [(x, y, z) for (x, z) in profile for y in (-0.68, 0.68)], 0)
# roof: a thin panel that overhangs the cabin a little, sloping down at the front over the windscreen
hull(bm, [(x, y, z) for (x, z) in [(0.40, 0.76), (0.34, 0.86), (-1.46, 0.86), (-1.50, 0.76)] for y in (-0.72, 0.72)], 0)
# the hood's power bulge (painted): a low raised block down the middle that slopes at the front and back
hull(bm, [(x, y, z) for (x, hw, z) in [(0.55, 0.26, 0.0), (0.66, 0.18, 0.065), (1.17, 0.18, 0.065), (1.30, 0.26, 0.0)] for y in (-hw, hw)], 0)
# a pair of ribs along the roof for strength, like a pressed panel
for s in (1, -1):
    box(bm, -1.30, 0.20, s * 0.28 - 0.03, s * 0.28 + 0.03, 0.855, 0.885, 0)
cabin = new_object("cabin", bm)

paint_bm = bmesh.new()
for ob in (tub, hood, cabin):
    merge_into(paint_bm, ob)

# ---------------------------------------------------------------- 2. everything that is NOT painted (one mesh, palette colours)
d = bmesh.new()

# roof details: rain gutters along both sides, a roof rack with bars, and an off-road light bar
for s in (1, -1):
    box(d, -1.46, 0.36, *sorted((s * 0.70, s * 0.74)), 0.74, 0.79, SW["grey"])                   # gutter
    box(d, -1.20, 0.10, *sorted((s * 0.46, s * 0.50)), 0.88, 0.93, SW["grey"])                   # rack rail
for x in (-1.15, -0.65, -0.15, 0.08):
    box(d, x - 0.025, x + 0.025, -0.50, 0.50, 0.93, 0.97, SW["dark"])                            # rack cross bar
box(d, 0.22, 0.31, -0.40, 0.40, 0.84, 0.92, SW["dark"])                                          # light bar
for k in range(4):
    cy = -0.27 + 0.18 * k
    box(d, 0.31, 0.335, cy - 0.05, cy + 0.05, 0.85, 0.91, SW["white"])                           # its lights

# 3D letters. `rot` turns the flat text (reading along +X, facing +Z) into place, `stretch` makes the letters taller.
def add_text(bm, text, loc, size, depth, sw, rot, stretch=1.0):
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body, cu.size, cu.extrude = text, size, depth
    cu.align_x, cu.align_y = "CENTER", "CENTER"
    ob = bpy.data.objects.new("txt", cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.scale = (1.0, stretch, 1.0)
    ob.rotation_euler = rot.to_euler()
    ob.location = loc
    bpy.context.view_layer.update()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))   # the letters as a mesh
    mw = ob.matrix_world
    new_verts = [bm.verts.new(mw @ v.co) for v in me.vertices]
    for p in me.polygons:
        f = bm.faces.new([new_verts[i] for i in p.vertices])
        f.material_index = sw
    bpy.data.objects.remove(ob, do_unlink=True)
# "THAR" across the whole rear window. Seen from behind it reads left to right (towards -Y), tops up (+Z),
# facing backwards (-X), and leans back with the glass.
rear_rot = Matrix.Rotation(0.103, 3, "Y") @ Matrix(((0, 0, -1), (-1, 0, 0), (0, 1, 0)))
add_text(d, "THAR", (-1.452, 0.0, 0.475), 0.30, 0.03, SW["dark"], rear_rot, stretch=1.7)

# ---- hood: a power bulge with an air scoop and vents (the bulge itself is painted, see the cabin above),
# louvres on both sides and four chrome hood pins
box(d, 1.19, 1.235, -0.14, 0.14, 0.015, 0.06, SW["dark"])                                        # scoop opening
for k in range(4):
    x = 0.72 + 0.1 * k
    box(d, x - 0.02, x + 0.02, -0.15, 0.15, 0.064, 0.074, SW["dark"])                            # vents on the bulge
for s in (1, -1):
    for k in range(3):
        y = s * (0.42 + 0.055 * k)
        box(d, 0.62, 1.12, y - 0.015, y + 0.015, -0.002, 0.012, SW["dark"])                      # louvres
    for x in (0.60, 1.26):
        cyl(d, "Z", (x, s * 0.58, 0.015), 0.028, 0.035, SW["chrome"], seg=8)                    # hood pins

# windows (sky blue): windscreen follows the rake of the cabin front
def front_x(z):  # x of the raked cabin front at height z
    return 0.45 - 0.15 * (z - 0.10) / 0.68
hull(d, [(front_x(z) + off, y, z) for z in (0.20, 0.72) for y in (-0.60, 0.60) for off in (0.003, 0.025)], SW["glass"])
for s in (1, -1):
    box(d, -1.35, -0.45, *sorted((s * 0.67, s * 0.70)), 0.25, 0.70, SW["glass"])   # rear side window
    box(d, -0.30, 0.25, *sorted((s * 0.67, s * 0.70)), 0.25, 0.70, SW["glass"])    # front side window
def back_x(z):  # x of the raked cabin back at height z
    return -1.45 + 0.07 * (z - 0.10) / 0.68
hull(d, [(back_x(z) - off, y, z) for z in (0.25, 0.70) for y in (-0.50, 0.50) for off in (0.003, 0.025)], SW["glass"])   # rear window

# ---- extra detail on the body (not all of it is a Thar thing, it just makes the toy richer)
for s in (1, -1):
    # door seams: thin dark grooves down the tub and up the cabin
    for x in (0.40, -0.52, -1.36):
        box(d, x - 0.012, x + 0.012, *sorted((s * 0.715, s * 0.73)), -0.52, 0.10, SW["dark"])
        box(d, x - 0.012, x + 0.012, *sorted((s * 0.675, s * 0.69)), 0.10, 0.76, SW["dark"])
    box(d, -1.44, 0.44, *sorted((s * 0.715, s * 0.73)), 0.03, 0.07, SW["chrome"])               # a light stripe along the side
    box(d, 0.40, 0.44, *sorted((s * 0.08, s * 0.50)), 0.00, 0.03, SW["dark"])                   # windscreen wiper
    cyl(d, "X", (1.58, s * 0.68, -0.53), 0.06, 0.04, SW["white"], seg=10)                       # fog lamp in the bumper
box(d, 1.58, 1.60, -0.20, 0.20, -0.60, -0.47, SW["white"])                                      # front number plate
box(d, -1.60, -1.58, -0.20, 0.20, -0.60, -0.47, SW["white"])                                    # rear number plate
cyl(d, "Y", (-1.00, -0.725, 0.0), 0.07, 0.03, SW["chrome"], seg=10)                             # fuel cap
box(d, -1.50, -1.44, -0.12, 0.12, 0.66, 0.74, SW["red"])                                        # high brake light

# front: grille with 7 slots, round headlights, indicators, bumper, tow hooks
box(d, 1.395, 1.43, -0.42, 0.42, -0.42, -0.08, SW["grey"])
for k in range(7):
    cy = -0.33 + 0.11 * k
    box(d, 1.43, 1.46, cy - 0.025, cy + 0.025, -0.38, -0.12, SW["dark"])
for s in (1, -1):
    cyl(d, "X", (1.42, s * 0.56, -0.20), 0.12, 0.05, SW["dark"], seg=12)         # ring
    cyl(d, "X", (1.44, s * 0.56, -0.20), 0.095, 0.06, SW["white"], seg=12)        # lens
    box(d, 1.395, 1.45, *sorted((s * 0.49, s * 0.63)), -0.40, -0.32, SW["orange"])  # indicator
    box(d, 1.56, 1.64, s * 0.5 - 0.05, s * 0.5 + 0.05, -0.58, -0.50, SW["red"])     # tow hook
box(d, 1.36, 1.58, -0.78, 0.78, -0.64, -0.42, SW["grey"])                             # bumper

# rear: bumper, tail lights, spare wheel on the back
box(d, -1.58, -1.40, -0.78, 0.78, -0.64, -0.40, SW["grey"])
for s in (1, -1):
    box(d, -1.50, -1.44, *sorted((s * 0.52, s * 0.68)), -0.30, 0.06, SW["red"])
cyl(d, "X", (-1.57, 0.0, -0.10), 0.34, 0.22, SW["dark"], seg=14)                      # spare tyre
cyl(d, "X", (-1.69, 0.0, -0.10), 0.17, 0.05, SW["chrome"], seg=10)                    # its hub

# sides: black fender flares (a square arch frame round each wheel), steps, mirrors, handles, snorkel
for wx, wy in WHEELS:
    s = 1 if wy > 0 else -1
    ya, yb = sorted((s * 0.62, s * 0.98))
    box(d, wx - 0.56, wx + 0.56, ya, yb, -0.28, -0.14, SW["dark"])     # top of the arch
    box(d, wx - 0.56, wx - 0.49, ya, yb, -0.62, -0.14, SW["dark"])     # one side
    box(d, wx + 0.49, wx + 0.56, ya, yb, -0.62, -0.14, SW["dark"])     # other side
for s in (1, -1):
    box(d, -0.45, 0.35, *sorted((s * 0.72, s * 0.90)), -0.66, -0.58, SW["grey"])      # side step
    box(d, 0.30, 0.38, *sorted((s * 0.68, s * 0.84)), 0.12, 0.17, SW["dark"])        # mirror arm
    box(d, 0.27, 0.41, *sorted((s * 0.84, s * 0.91)), 0.08, 0.30, SW["dark"])         # mirror
    box(d, -0.50, -0.36, *sorted((s * 0.72, s * 0.76)), -0.05, 0.02, SW["chrome"])     # door handle
box(d, 0.52, 0.60, -0.76, -0.66, -0.10, 0.70, SW["grey"])                              # snorkel (right side)
box(d, 0.48, 0.66, -0.78, -0.64, 0.64, 0.72, SW["grey"])                                # snorkel top

# ---------------------------------------------------------------- 3. the wheel (modelled around its own centre, cloned 4x by the game)
tyre_bm = bmesh.new()
cyl(tyre_bm, "Y", (0, 0, 0), 0.40, 0.34, SW["dark"], seg=14)          # tyre
cyl(tyre_bm, "Y", (0, 0, 0), 0.10, 0.37, SW["chrome"], seg=8)          # centre cap
rim_bm = bmesh.new()
cyl(rim_bm, "Y", (0, 0, 0), 0.25, 0.355, 0, seg=14)                    # painted rim

# ---------------------------------------------------------------- 4. UVs: point every face at its palette square
def set_uvs(bm, fn):
    layer = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for loop in f.loops:
            loop[layer].uv = fn(f, loop.vert.co)
        f.material_index = 0
        f.smooth = False

def swatch_uv(f, co):
    return ((f.material_index * 4 + 2) / 128.0, 0.5)   # centre of the 4x4 square

# palette bits: all faces go to their square. painted bits: v runs 0 (bottom) to 1 (top) = the paint gradient
zmin = min(v.co.z for v in paint_bm.verts); zmax = max(v.co.z for v in paint_bm.verts)
set_uvs(d, swatch_uv)
set_uvs(tyre_bm, swatch_uv)
set_uvs(paint_bm, lambda f, co: (0.5, (co.z - zmin) / (zmax - zmin)))
set_uvs(rim_bm, lambda f, co: (0.5, 0.35 + 0.3 * (co.y > 0)))

# ---------------------------------------------------------------- 5. materials (by name, the game swaps them)
def material(name, image=None, rgba=(1, 0.2, 0.2, 1)):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 1.0
    if image:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.interpolation = "Closest"
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = rgba
        # a tiny dummy texture so the exporter keeps the UV coordinates (the game's paint reads them)
        dummy = bpy.data.images.new("uvkeep", 4, 4)
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = dummy
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs[0].default_value = 0.0
        mix.inputs[6].default_value = rgba
        nt.links.new(tex.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    mat.diffuse_color = rgba
    return mat

palette_img = bpy.data.images.load(PALETTE, check_existing=True)
palette_mat = material("palette", palette_img, (0.6, 0.6, 0.6, 1))
paint_mat = material("redGradient", None, (1.0, 0.23, 0.23, 1))

def finish(name, bm, mat):
    ob = new_object(name, bm)
    ob.data.materials.append(mat)
    bm.free()
    return ob

body = finish("bodyPainted", paint_bm, paint_mat)
details = finish("details", d, palette_mat)
tyre = finish("tyre", tyre_bm, palette_mat)
rim = finish("wheelPainted", rim_bm, paint_mat)

# ---------------------------------------------------------------- 6. the parent structure the game looks for
def empty(name, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "PLAIN_AXES"
    e.empty_display_size = 0.5
    e.location = loc
    bpy.context.scene.collection.objects.link(e)
    return e

def adopt(child, parent):
    bpy.context.view_layer.update()
    w = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    child.matrix_world = w

wheel_pos = Vector((0.9, 0.75, WZ))   # the model holds ONE wheel, on the left-front spot
for ob in (tyre, rim):
    ob.location = wheel_pos
chassis = empty("chassis", (0, 0, 0))
container = empty("wheelContainer", wheel_pos)
cylinder = empty("wheelCylinder", wheel_pos)
adopt(body, chassis); adopt(details, chassis)
adopt(cylinder, container)
adopt(tyre, cylinder); adopt(rim, cylinder)
bpy.context.view_layer.update()

def report(ob):
    pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    say(f"{ob.name}: {len(ob.data.vertices)} verts, min {tuple(round(v, 2) for v in lo)} max {tuple(round(v, 2) for v in hi)}")
for ob in (body, details, tyre, rim):
    report(ob)

# ---------------------------------------------------------------- 7. preview renders (flat colours, a few angles)
scn = bpy.context.scene
scn.render.engine = "BLENDER_WORKBENCH"
scn.display.shading.light = "STUDIO"
scn.display.shading.color_type = "TEXTURE"
scn.render.resolution_x, scn.render.resolution_y = 900, 600
scn.world = bpy.data.worlds.new("w")
scn.world.color = (0.75, 0.82, 0.9)
cam_data = bpy.data.cameras.new("cam"); cam_data.lens = 50
cam = bpy.data.objects.new("cam", cam_data); scn.collection.objects.link(cam); scn.camera = cam
# a ground line so you can see where the tyres touch
gbm = bmesh.new(); box(gbm, -3, 3, -2, 2, -1.2, -1.1, 0); set_uvs(gbm, swatch_uv)
for f in gbm.faces: f.material_index = 0
gnd = new_object("ground", gbm); gnd.data.materials.append(palette_mat)
for f in gnd.data.polygons: pass
os.makedirs(PREVIEW, exist_ok=True)
for name, pos, target in [("front-left", (5.0, 4.2, 2.2), (0, 0, -0.3)), ("back-right", (-5.0, -4.2, 2.4), (0, 0, -0.3)),
                          ("side", (0.01, 6.5, 0.2), (0, 0, -0.3)), ("top", (0.3, 0.2, 8.0), (0, 0, -0.3)),
                          ("hood-from-behind", (0.2, 0.0, 2.0), (1.0, 0, 0.0))]:
    cam.location = pos
    direction = Vector(target) - Vector(pos)
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scn.render.filepath = os.path.join(PREVIEW, name + ".png")
    bpy.ops.render.render(write_still=True)
bpy.data.objects.remove(gnd, do_unlink=True)
bpy.data.objects.remove(cam, do_unlink=True)

# ---------------------------------------------------------------- 8. save + export
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, copy=True)
say("saved " + OUT_BLEND)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=False,
                          export_apply=True, export_yup=True, export_cameras=False, export_lights=False)
say(f"exported {OUT_GLB} ({os.path.getsize(OUT_GLB)} bytes)")
print("@@DONE@@")
