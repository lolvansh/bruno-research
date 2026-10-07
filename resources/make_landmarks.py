# Builds TOY versions of Surat landmarks, all in ONE file: static/landmarks/landmarks.glb
#
#   blender.exe -b --factory-startup --python resources/make_landmarks.py
#
# Each landmark is a node named "<name>Physical" (fixed, never moves) with invisible collider children
# (cuboid_* boxes, tube_* cylinders, ball_* spheres): the same naming convention as the cable bridge.
#
# FRAME OF EACH MODEL: the middle of its footprint is the origin, the ground is z = 0 (foundations go below),
# the FRONT is +X (the side with the entrance and the sign), left is +Y, up is +Z.
# The game turns each one to face where we want, see World.js setLandmarks().
#
# COLOURS come from the game's palette image (static/palette.png): change a number in the C dict to recolour.
import bpy, bmesh, math, os
from mathutils import Matrix, Vector

ROOT = r"D:\P3Q\research\surat-world"
PALETTE = os.path.join(ROOT, "static", "palette.png")
OUT_BLEND = os.path.join(ROOT, "resources", "landmarks.blend")
OUT_GLB = os.path.join(ROOT, "static", "landmarks", "landmarks.glb")
PREVIEW = os.path.join(ROOT, "resources", "landmarks-preview")

C = dict(girder=0, cream=1, brown=2, glass=3, kerb=4, darkbrown=5, grey=6, peach=7, yellow=8, orange=15, red=19,
         white=17, offwhite=23, sandstone=18, dark=22, blue=3, purple=20, pink=21, rose=10, leaf=9)

def say(m): print("@@LOG@@ " + m)
for _ob in list(bpy.data.objects):
    bpy.data.objects.remove(_ob, do_unlink=True)

# ------------------------------------------------------------------ tiny modelling kit
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

def cyl(bm, axis, c, radius, length, sw, seg=16, radius2=None):
    rot = {"X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Y": Matrix.Rotation(math.pi / 2, 4, "X"), "Z": Matrix.Identity(4)}[axis]
    m = Matrix.Translation(c) @ rot
    r2 = radius if radius2 is None else radius2
    tag(bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=radius, radius2=r2, depth=length, matrix=m)["verts"], sw)

def ring_pts(cx, cy, z, r, seg):
    return [(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg), z) for i in range(seg)]

def dome(bm, c, radius, sw_a, sw_b, seg=16, rings=4):
    """A dome built from stacked bands that alternate two colours."""
    prev = None
    for i in range(rings + 1):
        ang = (math.pi / 2) * i / rings
        z = c[2] + radius * math.sin(ang)
        r = max(radius * math.cos(ang), 0.001)
        pts = ring_pts(c[0], c[1], z, r, seg)
        if prev:
            hull(bm, prev + pts, sw_a if i % 2 else sw_b)
        prev = pts

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
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    mw = ob.matrix_world
    nv = [bm.verts.new(mw @ v.co) for v in me.vertices]
    for p in me.polygons:
        f = bm.faces.new([nv[i] for i in p.vertices])
        f.material_index = sw
    bpy.data.objects.remove(ob, do_unlink=True)

# Text on a wall that faces +X (the front): reads left to right for someone standing in front, facing the wall.
FRONT = Matrix(((0, 0, 1), (1, 0, 0), (0, 1, 0)))

def new_object(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob

class Landmark:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.colliders = []

    def cuboid(self, x0, x1, y0, y1, z0, z1):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        ob = new_object(f"cuboid_{len(self.colliders)}", bm)
        ob.location = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
        ob.scale = (x1 - x0, y1 - y0, z1 - z0)        # the box size is the object's scale (not applied)
        self.colliders.append(ob)

    def tube(self, cx, cy, z0, z1, diameter):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.5, radius2=0.5, depth=1.0)
        ob = new_object(f"tube_{len(self.colliders)}", bm)
        ob.location = (cx, cy, (z0 + z1) / 2)
        ob.scale = (diameter, diameter, z1 - z0)      # x = diameter, z (height) = the tube's height
        self.colliders.append(ob)

    def ball(self, c, diameter):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.5)
        ob = new_object(f"ball_{len(self.colliders)}", bm)
        ob.location = c
        ob.scale = (diameter, diameter, diameter)
        self.colliders.append(ob)

landmarks = []
def landmark(name):
    lm = Landmark(name)
    landmarks.append(lm)
    return lm

W, W2, D, GR, GL, OR, RD, YL, SS, BR = (C[k] for k in ("offwhite", "white", "dark", "grey", "glass", "orange", "red", "yellow", "sandstone", "brown"))

# ================================================================== 1. VR SURAT (Vesu / Piplod): the big modern mall
lm = landmark("vrSurat"); b = lm.bm
box(b, -6, 6, -11, 11, -0.5, 3.2, W)                                    # podium: shops on the lower floors
box(b, 5.99, 6.1, -10.4, 10.4, 0.7, 2.6, GL)                            # glass band along the front
for y in range(-10, 11, 3):
    box(b, 5.95, 6.2, y - 0.14, y + 0.14, 0.3, 3.0, W2)                 # pillars between the windows
box(b, -5, 5, -11, 11, 3.2, 9.0, W2)                                    # upper floors
for z0 in (3.8, 5.4):
    box(b, 4.99, 5.1, -10.4, 10.4, z0, z0 + 1.0, GL)                    # window bands (front)
    for s in (1, -1):
        box(b, -4.5, 4.5, *sorted((s * 10.99, s * 11.1)), z0, z0 + 1.0, GL)   # ... and the two sides
for k in range(-7, 8):
    box(b, 5.0, 5.35, k * 1.4 - 0.1, k * 1.4 + 0.1, 3.4, 6.7, OR)       # orange fins, the mall's look
box(b, -6.3, 6.3, -11.3, 11.3, 9.0, 9.4, W)                             # roof edge
box(b, -5, 5, -11, 11, 9.4, 9.45, GR)
box(b, -3, -1, -4, 0, 9.4, 11, GR); box(b, 1, 3, 1, 6, 9.4, 10.6, GR)  # roof machinery
box(b, 6, 8.4, -3.6, 3.6, 0, 5.0, GL)                                   # glass entrance hall
for y in (-3.6, -1.2, 1.2, 3.6):
    box(b, 6, 8.5, y - 0.15, y + 0.15, 0, 5.1, W)
box(b, 6, 10.4, -4.6, 4.6, 5.0, 5.4, W)                                 # entrance canopy
for y in (-4.2, 4.2):
    box(b, 10.0, 10.4, y - 0.25, y + 0.25, 0, 5.0, W)
box(b, 8.4, 8.45, -2.6, 2.6, 0, 2.5, D)                                 # doors
add_text(b, "VR SURAT", (5.1, 0, 7.9), 2.0, 0.25, D, FRONT, stretch=1.3)
lm.cuboid(-6, 6, -11, 11, -0.5, 9.4)
lm.cuboid(6, 8.5, -3.6, 3.6, -0.5, 5.0)

# ================================================================== 2. RAHULRAJ MALL (Piplod): the tall glass tower
lm = landmark("rahulRajMall"); b = lm.bm
box(b, -7, 7, -9, 9, -0.5, 4.5, GR)                                     # podium
box(b, 6.99, 7.1, -8.4, 8.4, 1.0, 3.8, GL)
for y in range(-8, 9, 4):
    box(b, 6.95, 7.2, y - 0.2, y + 0.2, 0.4, 4.2, W)
box(b, -4, 4, -6, 6, 4.5, 17, GR)                                       # the tower
z = 5.4
while z < 16.2:
    box(b, 3.99, 4.1, -5.4, 5.4, z, z + 1.0, GL)                        # glass bands, front
    box(b, -4.1, -3.99, -5.4, 5.4, z, z + 1.0, GL)
    for s in (1, -1):
        box(b, -3.4, 3.4, *sorted((s * 5.99, s * 6.1)), z, z + 1.0, GL)
    z += 1.6
for sx in (1, -1):
    for sy in (1, -1):
        box(b, sx * 4 - 0.3, sx * 4 + 0.3, sy * 6 - 0.3, sy * 6 + 0.3, 4.5, 17.2, W)   # corner columns
box(b, -3.2, 3.2, -4.6, 4.6, 17, 18.2, W)                               # crown
box(b, -0.2, 0.2, -0.2, 0.2, 18.2, 21, W)                               # mast
box(b, -0.3, 0.3, -0.3, 0.3, 21, 21.6, RD)                              # beacon
box(b, 7, 9.5, -3.2, 3.2, 0, 3.6, GL)                                   # entrance
for y in (-3.2, 3.2):
    box(b, 7, 9.6, y - 0.15, y + 0.15, 0, 3.7, W)
box(b, 7, 11.2, -4.2, 4.2, 3.6, 4.0, OR)                                # canopy
for y in (-3.8, 3.8):
    box(b, 10.8, 11.2, y - 0.2, y + 0.2, 0, 3.6, W)
add_text(b, "RAHULRAJ", (4.1, 0, 15.2), 1.5, 0.2, W2, FRONT, stretch=1.1)
lm.cuboid(-7, 7, -9, 9, -0.5, 4.5)
lm.cuboid(-4, 4, -6, 6, 4.5, 18.2)
lm.cuboid(7, 9.6, -3.3, 3.3, -0.5, 3.6)

# ================================================================== 3. ATHWA GATE (Athwalines): a sandstone gate you can drive through
lm = landmark("athwaGate"); b = lm.bm
wall = new_object("wall", bmesh.new())
bw = bmesh.new()
box(bw, -1.5, 1.5, -6.75, 6.75, -0.5, 13.5, SS)
wobj = new_object("wall", bw)
# the arch: a "D" shape (convex), cut through the wall: 6 wide, straight up to 4.5, then a half circle
cut = bmesh.new()
arch = [(-4.25, -1), (4.25, -1)] + [(4.25 * math.cos(math.pi * i / 10), 7.0 + 4.25 * math.sin(math.pi * i / 10)) for i in range(0, 11)]
hull(cut, [(x, y, z) for (y, z) in arch for x in (-3, 3)], 0)
cobj = new_object("cut", cut)
mod = wobj.modifiers.new("arch", "BOOLEAN"); mod.object = cobj; mod.operation = "DIFFERENCE"; mod.solver = "EXACT"
with bpy.context.temp_override(object=wobj, active_object=wobj, selected_objects=[wobj]):
    bpy.ops.object.modifier_apply(modifier="arch")
bpy.data.objects.remove(cobj, do_unlink=True)
tmp = bmesh.new(); tmp.from_mesh(wobj.data)
nv = {v: b.verts.new(v.co) for v in tmp.verts}
for f in tmp.faces:
    nf = b.faces.new([nv[v] for v in f.verts]); nf.material_index = SS
tmp.free(); bpy.data.objects.remove(wobj, do_unlink=True); bpy.data.objects.remove(wall, do_unlink=True)
for s in (1, -1):
    box(b, -2.2, 2.2, *sorted((s * 6.75, s * 9.75)), -0.5, 13.5, SS)                    # side towers
    box(b, -2.5, 2.5, *sorted((s * 6.55, s * 9.95)), 13.5, 14.0, BR)                      # tower cap
    for k in range(4):                                                                   # four small pillars + a dome (a chhatri)
        px_, py_ = (-1.4, 1.4)[k % 2], s * (8.25 + (-1.0, 1.0)[k // 2])
        box(b, px_ - 0.18, px_ + 0.18, py_ - 0.18, py_ + 0.18, 14.0, 15.3, SS)
    dome(b, (0, s * 8.25, 15.3), 1.7, C["orange"], C["white"], seg=12, rings=3)
    box(b, -0.1, 0.1, s * 8.25 - 0.1, s * 8.25 + 0.1, 17.0, 17.9, C["yellow"])           # spire
    box(b, 2.0, 2.45, *sorted((s * 7.0, s * 9.5)), 5.0, 6.2, BR)                        # little balcony on the tower front
for y in (-6.2, -5.0, 5.0, 6.2):
    if True:
        box(b, -1.6, 1.6, y - 0.35, y + 0.35, 13.5, 14.5, SS)                                  # battlements along the wall top
for s in (1, -1):
    box(b, 1.5, 1.7, *sorted((s * 4.25, s * 4.65)), 0, 7.0, BR)                            # dark frames on the arch sides
add_text(b, "ATHWA GATE", (1.6, 0, 12.4), 1.3, 0.2, BR, FRONT)
lm.cuboid(-1.5, 1.5, -6.75, -4.25, -0.5, 13.5)
lm.cuboid(-1.5, 1.5, 4.25, 6.75, -0.5, 13.5)
lm.cuboid(-1.5, 1.5, -4.25, 4.25, 11.3, 13.5)
for s in (1, -1):
    lm.cuboid(-2.2, 2.2, *sorted((s * 6.75, s * 9.75)), -0.5, 13.5)

# ================================================================== 4. SCIENCE CENTRE (City Light): a dome with a ring of windows
lm = landmark("scienceCentre"); b = lm.bm
cyl(b, "Z", (0, 0, 2.0), 8, 5.0, W2, seg=16)
cyl(b, "Z", (0, 0, 1.9), 8.12, 1.6, GL, seg=16)                                           # a ring of windows around the drum
dome(b, (0, 0, 4.5), 8, C["blue"], W2, seg=16, rings=4)
cyl(b, "Z", (0, 0, 13.1), 0.2, 1.2, GR, seg=6)                                            # antenna
box(b, 6.0, 10.4, -3.2, 3.2, -0.5, 3.8, W2)                                                # entrance wing
box(b, 10.38, 10.45, -2.4, 2.4, 0, 2.6, GL)
box(b, 6.0, 11.2, -3.8, 3.8, 3.8, 4.2, C["orange"])
for y in (-3.4, 3.4):
    box(b, 10.8, 11.2, y - 0.2, y + 0.2, 0, 3.8, W2)
for y in (-5.4, 5.4):                                                                      # sign board on two posts
    box(b, 12.4, 12.7, y - 0.2, y + 0.2, 0, 2.6, GR)
box(b, 12.35, 12.75, -6.2, 6.2, 2.6, 4.4, C["blue"])
add_text(b, "SCIENCE CENTRE", (12.78, 0, 3.5), 0.85, 0.15, W2, FRONT)
for k in range(6):                                                                         # atom sculpture orbit rings in front
    pass
lm.tube(0, 0, -0.5, 4.5, 16)
lm.ball((0, 0, 4.5), 16)
lm.cuboid(6.0, 10.4, -3.2, 3.2, -0.5, 3.8)

# ================================================================== 5. DUMAS BEACH: sign, umbrellas, lifeguard tower, a food stall
lm = landmark("dumasBeach"); b = lm.bm
for y in (-6.5, 6.5):                                                                      # welcome sign on two posts, the car drives between and under
    box(b, -0.2, 0.2, y - 0.25, y + 0.25, -0.5, 9.5, BR)
box(b, -0.35, 0.35, -7.4, 7.4, 8.2, 10.0, C["blue"])
add_text(b, "DUMAS BEACH", (0.37, 0, 9.1), 1.4, 0.15, W2, FRONT)
lm.cuboid(-0.2, 0.2, -6.75, -6.25, -0.5, 9.5)
lm.cuboid(-0.2, 0.2, 6.25, 6.75, -0.5, 9.5)
umb = [(-7, -6, RD), (-7, 0, YL), (-7, 6, C["blue"]), (-12, -3, YL), (-12, 3, RD)]
for (x, y, col) in umb:                                                                    # beach umbrellas
    box(b, x - 0.1, x + 0.1, y - 0.1, y + 0.1, -0.5, 4.6, BR)
    cyl(b, "Z", (x, y, 4.6), 2.8, 1.0, col, seg=8, radius2=0.12)
    box(b, x - 1.4, x + 1.4, y - 1.4, y + 1.4, 0.0, 0.25, C["peach"])                      # a towel
    lm.tube(x, y, -0.5, 4.6, 0.4)
for x_, y_ in ((-9, 9.5), (-9, 12.5)):                                                     # lifeguard tower on stilts
    pass
lg_x, lg_y = -10, 11
for dx in (-0.9, 0.9):
    for dy in (-0.9, 0.9):
        box(b, lg_x + dx - 0.12, lg_x + dx + 0.12, lg_y + dy - 0.12, lg_y + dy + 0.12, -0.5, 2.6, BR)
box(b, lg_x - 1.3, lg_x + 1.3, lg_y - 1.3, lg_y + 1.3, 2.6, 2.8, BR)
box(b, lg_x - 1.0, lg_x + 1.0, lg_y - 1.0, lg_y + 1.0, 2.8, 4.4, RD)
box(b, lg_x + 0.99, lg_x + 1.05, lg_y - 0.6, lg_y + 0.6, 3.2, 4.0, GL)
box(b, lg_x - 1.5, lg_x + 1.5, lg_y - 1.5, lg_y + 1.5, 4.4, 4.7, W2)
box(b, lg_x + 1.05, lg_x + 1.25, lg_y - 0.3, lg_y + 0.3, 0.0, 2.6, BR)
lm.cuboid(lg_x - 1.2, lg_x + 1.2, lg_y - 1.2, lg_y + 1.2, -0.5, 4.7)
st_x, st_y = -10, -10                                                                      # food stall
box(b, st_x - 1.8, st_x + 1.8, st_y - 1.2, st_y + 1.2, -0.5, 2.2, W2)
box(b, st_x + 1.7, st_x + 1.9, st_y - 1.0, st_y + 1.0, 1.0, 1.8, GL)
box(b, st_x - 2.3, st_x + 2.3, st_y - 1.9, st_y + 1.9, 2.2, 2.5, OR)
for y in (-1.8, 1.8):
    box(b, st_x + 2.1, st_x + 2.3, st_y + y - 0.07, st_y + y + 0.07, 0, 2.2, BR)
lm.cuboid(st_x - 1.8, st_x + 1.8, st_y - 1.2, st_y + 1.2, -0.5, 2.5)

# ================================================================== 6. DARIYA GANESH TEMPLE (Dumas): a small seaside temple
lm = landmark("dariyaGaneshTemple"); b = lm.bm
box(b, -4.5, 4.5, -4.5, 4.5, -0.5, 0.4, C["cream"])                                        # plinth
box(b, -4.0, 4.0, -4.0, 4.0, 0.4, 0.8, C["cream"])
for i in range(3):                                                                          # steps at the front
    box(b, 4.0 + i * 0.5, 4.5 + i * 0.5, -1.6, 1.6, -0.5, 0.8 - i * 0.25, C["cream"])
box(b, -3.5, 0.5, -3, 3, 0.8, 4.6, SS)                                                      # the sanctum
box(b, -3.7, 0.7, -3.2, 3.2, 4.6, 5.0, BR)
for px_ in (1.2, 3.4):                                                                      # porch with four pillars
    for py_ in (-2.8, 2.8):
        box(b, px_ - 0.3, px_ + 0.3, py_ - 0.3, py_ + 0.3, 0.8, 4.2, C["cream"])
box(b, 0.8, 3.9, -3.4, 3.4, 4.2, 4.7, C["orange"])
box(b, 0.5, 0.6, -1.0, 1.0, 0.8, 3.0, BR)                                                   # doorway into the sanctum
tiers = [(2.6, 5.0), (2.2, 6.2), (1.8, 7.3), (1.4, 8.3), (1.0, 9.1), (0.6, 9.7)]           # the shikhara tower: stacked, narrowing
prev = None
for i, (hw, z) in enumerate(tiers):
    pts = [(-1.5 + sx * hw, sy * hw, z) for sx in (-1, 1) for sy in (-1, 1)]
    if prev:
        hull(b, prev + pts, C["orange"] if i % 2 else W2)
    prev = pts
cyl(b, "Z", (-1.5, 0, 10.0), 0.45, 0.6, YL, seg=8)                                          # kalash
cyl(b, "Z", (-1.5, 0, 10.5), 0.2, 0.5, YL, seg=6, radius2=0.02)
box(b, -1.55, -1.45, -0.05, 0.05, 10.5, 12.5, BR)                                           # flag pole
box(b, -1.55, -1.5, 0.0, 1.4, 11.4, 12.4, RD)                                               # flag
lm.cuboid(-4.5, 4.5, -4.5, 4.5, -0.5, 0.8)
lm.cuboid(-3.5, 0.5, -3, 3, 0.8, 5.0)
lm.cuboid(-3.0, 0.0, -2.2, 2.2, 5.0, 10)
for px_ in (1.2, 3.4):
    for py_ in (-2.8, 2.8):
        lm.cuboid(px_ - 0.3, px_ + 0.3, py_ - 0.3, py_ + 0.3, 0.8, 4.2)

# ================================================================== UVs, material, hierarchy, export
palette_img = bpy.data.images.load(PALETTE, check_existing=True)
mat = bpy.data.materials.new("palette")
mat.use_nodes = True
tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = palette_img
tex.interpolation = "Closest"
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 1.0
mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

# MINIATURES. Bruno's showpieces are small: his areas are about 5 to 11 units wide and 2 to 8 tall, and the car
# is about 3 long. Each landmark was modelled big (easier to detail), then shrunk by its own factor here.
# Change a number to resize one landmark; the colliders shrink with it.
SCALES = {"vrSurat": 0.27, "rahulRajMall": 0.25, "athwaGate": 0.36, "scienceCentre": 0.31, "dumasBeach": 0.3, "dariyaGaneshTemple": (0.5, 0.5, 0.32)}

objs = []
for i, lm in enumerate(landmarks):
    k = SCALES[lm.name]
    kx, ky, kz = k if isinstance(k, tuple) else (k, k, k)
    bmesh.ops.scale(lm.bm, vec=(kx, ky, kz), space=Matrix.Identity(4), verts=lm.bm.verts)   # about the origin: the ground stays at z = 0
    for c in lm.colliders:
        c.location = Vector((c.location.x * kx, c.location.y * ky, c.location.z * kz))
        c.scale = Vector((c.scale.x * kx, c.scale.y * ky, c.scale.z * kz))
    layer = lm.bm.loops.layers.uv.verify()
    for f in lm.bm.faces:
        u = (f.material_index * 4 + 2) / 128.0
        for loop in f.loops:
            loop[layer].uv = (u, 0.5)
        f.material_index = 0
        f.smooth = False
    ob = new_object(lm.name + "Physical", lm.bm)
    ob.data.materials.append(mat)
    ob.location = (0, i * 50, 0)            # spread out in Blender so they do not overlap (the game ignores this)
    for c in lm.colliders:
        c.parent = ob
        c.hide_render = True        # invisible boxes: do not draw them in the preview pictures
    objs.append(ob)
    say(f"{lm.name}: {len(ob.data.vertices)} vertices, {len(lm.colliders)} colliders")
bpy.context.view_layer.update()

# preview renders: one picture per landmark from two angles
scn = bpy.context.scene
scn.render.engine = "BLENDER_WORKBENCH"
scn.display.shading.light = "STUDIO"
scn.display.shading.color_type = "TEXTURE"
scn.render.resolution_x, scn.render.resolution_y = 900, 560
scn.world = bpy.data.worlds.new("w"); scn.world.color = (0.75, 0.82, 0.9)
cam_data = bpy.data.cameras.new("cam"); cam_data.lens = 35
cam = bpy.data.objects.new("cam", cam_data); scn.collection.objects.link(cam); scn.camera = cam
os.makedirs(PREVIEW, exist_ok=True)
dist = {"vrSurat": 14, "rahulRajMall": 14, "athwaGate": 14, "scienceCentre": 12, "dumasBeach": 12, "dariyaGaneshTemple": 10}
for ob in objs:
    base = ob.name.replace("Physical", "")
    d = dist[base]
    cy = ob.location.y
    for tag_, ang in (("front", 0.55), ("back", math.pi + 0.55), ("head", 0.0)):
        pos = (d * math.cos(ang), cy + d * math.sin(ang) * 0.9, d * 0.38)
        cam.location = pos
        cam.rotation_euler = (Vector((0, cy, d * 0.14)) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
        scn.render.filepath = os.path.join(PREVIEW, f"{base}-{tag_}.png")
        bpy.ops.render.render(write_still=True)
bpy.data.objects.remove(cam, do_unlink=True)

bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, copy=True)
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=False, export_apply=True,
                          export_yup=True, export_cameras=False, export_lights=False)
say(f"exported {OUT_GLB} ({os.path.getsize(OUT_GLB)} bytes)")
print("@@DONE@@")
