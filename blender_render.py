"""
TABAHI — Next Level Blender Python render script
=================================================
Renders the "Controlled Chaos" 3D animation to image sequence + audio, then
stitches to MP4 (requires Blender + FFmpeg installed on your machine).

Usage inside Blender (Scripting tab) or headless:
    blender -b -P blender_render.py
    blender -b scene.blend -a           # render frames
    ffmpeg -framerate 60 -i frames/%04d.png -i audio.wav \
        -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest tabahi.mp4

Mirrors the Three.js storyboard (STORYBOARD.md) with 18 psychology-driven beats.
30s loop, 60 FPS, 1920x1080.
"""

import bpy
import math
import os
import random

# ----------------------------------------------------------------------------
# CONFIG — mirrors STORYBOARD.md beats (18 beats, 30s, 60 FPS)
# ----------------------------------------------------------------------------
FPS = 60
SECONDS = 30
WIDTH, HEIGHT = 1920, 1080
TOTAL_FRAMES = FPS * SECONDS

bpy.context.scene.render.resolution_x = WIDTH
bpy.context.scene.render.resolution_y = HEIGHT
bpy.context.scene.render.fps = FPS
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = TOTAL_FRAMES
bpy.context.scene.render.image_settings.file_format = 'PNG'
bpy.context.scene.render.filepath = '//frames/'

bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'RenderEngine') else 'BLENDER_EEVEE'
try:
    bpy.context.scene.eevee.use_bloom = True
    bpy.context.scene.eevee.bloom_intensity = 1.8
    bpy.context.scene.eevee.bloom_threshold = 0.1
    bpy.context.scene.eevee.use_ssr = True
    bpy.context.scene.eevee.use_ssr_refraction = True
except Exception:
    pass

# ----------------------------------------------------------------------------
# CLEAR DEFAULT SCENE
# ----------------------------------------------------------------------------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for mesh in bpy.data.meshes:
    bpy.data.meshes.remove(mesh)
for mat in bpy.data.materials:
    bpy.data.materials.remove(mat)

scene = bpy.context.scene
scene.world.use_nodes = True
world_nodes = scene.world.node_tree.nodes
bg = world_nodes.get("Background")
if bg:
    bg.inputs[0].default_value = (0.01, 0.01, 0.02, 1.0)  # noir
    bg.inputs[1].default_value = 0.3

# ----------------------------------------------------------------------------
# MATERIALS
# ----------------------------------------------------------------------------
def mat(name, color, emissive=0.0, roughness=0.6, metalness=0.2, transparent=False, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (*color, 1.0)
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metalness
        bsdf.inputs['Emission Color'].default_value = (*color, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emissive
        if transparent:
            bsdf.inputs['Alpha'].default_value = alpha
            m.blend_method = 'BLEND'
    return m

C_NOIR    = (0.01, 0.01, 0.02)
C_CONCRETE= (0.08, 0.08, 0.11)
C_CYAN    = (0.0, 0.95, 1.0)
C_VIOLET  = (0.48, 0.17, 1.0)
C_ORANGE  = (1.0, 0.42, 0.21)
C_GLASS   = (0.13, 0.13, 0.20)
C_SKIN    = (0.93, 0.85, 0.78)
C_CLOTH   = (0.14, 0.14, 0.21)

M_CONCRETE = mat('concrete', C_CONCRETE, roughness=0.65, metalness=0.2)
M_GLASS    = mat('glass', C_GLASS, emissive=0.9, roughness=0.05, metalness=0.95, transparent=True, alpha=0.9)
M_CYAN_LAMP= mat('cyan_lamp', C_CYAN, emissive=5.0, roughness=0.1)
M_VIOLET   = mat('violet', C_VIOLET, emissive=2.5, roughness=0.2)
M_ORANGE   = mat('orange', C_ORANGE, emissive=2.5, roughness=0.2)
M_SKIN     = mat('skin', C_SKIN, roughness=0.5)
M_CLOTH    = mat('cloth', C_CLOTH, roughness=0.7)
M_EYE      = mat('eye', (1,1,1), roughness=0.1)
M_PUPIL    = mat('pupil', (0,0,0))
M_MOUTH    = mat('mouth', (0.35,0.16,0.10), roughness=0.6)

# ----------------------------------------------------------------------------
# ENVIRONMENT
# ----------------------------------------------------------------------------
def add_plane(size, z=0.0, rot_x=0.0, mat=None, name='plane'):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z))
    ob = bpy.context.active_object
    ob.name = name
    if rot_x:
        ob.rotation_euler[0] = rot_x
    if mat:
        ob.data.materials.append(mat)
    return ob

def add_box(size, loc, rot=None, mat=None, name='box'):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    if rot:
        ob.rotation_euler = rot
    if mat:
        ob.data.materials.append(mat)
    return ob

# Ground
ground = add_plane(240, z=0.0, rot_x=-math.pi/2, mat=M_CONCRETE, name='Ground')
# Road
road = add_plane(220, z=0.02, rot_x=-math.pi/2, mat=M_CONCRETE, name='Road')

# Glowing lane lines
for i in range(-3, 4):
    add_box((210, 0.05, 0.4), (i*22, 0.03, 0), rot=(0,0,math.pi/2), mat=M_CYAN_LAMP, name=f'line_x_{i}')
    add_box((0.4, 0.05, 210), (0.03, i*22, 0), rot=(0,0,0), mat=M_CYAN_LAMP, name=f'line_z_{i}')

# Buildings grid
GRID = 11
SPACING = 18
buildings = []
for gx in range(GRID):
    for gz in range(GRID):
        cx = (gx - GRID/2) * SPACING + SPACING/2
        cz = (gz - GRID/2) * SPACING + SPACING/2
        h = random.uniform(10, 36)
        w = random.uniform(7, 13)
        d = random.uniform(7, 13)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, h/2, cz))
        b = bpy.context.active_object
        b.name = f'Building_{gx}_{gz}'
        b.scale = (w, h, d)
        b.data.materials.append(M_CONCRETE)
        b.cast_shadow = True
        buildings.append(b)

        win_count = int(h / 3)
        for wj in range(win_count):
            bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 1.5 + wj*3, d/2 + 0.01))
            win = bpy.context.active_object
            win.name = f'Win_{gx}_{gz}_{wj}'
            win.scale = (w*0.9, 1.8, 1.0)
            win.parent = b
            win.data.materials.append(M_GLASS)

        if random.random() > 0.65:
            accent_color = C_VIOLET if random.random() > 0.5 else C_ORANGE
            bpy.ops.mesh.primitive_cube_add(size=1, location=(0, h + 0.7, 0))
            acc = bpy.context.active_object
            acc.name = f'Accent_{gx}_{gz}'
            acc.scale = (w*0.95, 1.4, d*0.95)
            acc.parent = b
            acc.data.materials.append(mat(f'accent_{gx}_{gz}', accent_color, emissive=2.5, roughness=0.2))

# Street lamps
lamps = []
for i in range(32):
    ang = (i / 32) * math.pi * 2
    rad = 88
    lx, lz = math.cos(ang)*rad, math.sin(ang)*rad
    grp = bpy.data.objects.new('LampGroup', None)
    scene.collection.objects.link(grp)
    grp.location = (lx, 0, lz)
    grp.rotation_euler = (0, 0, ang + math.pi/2)

    pole = add_box((0.17, 0.17, 8), (0, 4, 0), name='Pole')
    pole.data.materials.append(bpy.data.materials.new('PoleMat'))
    pole.data.materials[0].use_nodes = True
    pole.data.materials[0].node_tree.nodes.get("Principled BSDF").inputs['Base Color'].default_value = (0.16,0.16,0.16,1)
    pole.parent = grp

    head = add_box((0.5, 1.5, 0.5), (0, 8, 0), mat=M_CYAN_LAMP, name='Head')
    head.parent = grp

    bulb = add_box((0.3, 0.3, 0.3), (0, 8, 0), mat=M_CYAN_LAMP, name='Bulb')
    bulb.parent = grp

    lgt = bpy.data.lights.new('LampLight', 'POINT')
    lgt.energy = 40
    lgt.color = C_CYAN
    lgt.shadow_soft_size = 0.5
    lobj = bpy.data.objects.new('LampLightObj', lgt)
    lobj.location = (0, 8, 0)
    scene.collection.objects.link(lobj)
    lobj.parent = grp

    lamps.append({'obj': grp, 'bulb': bulb, 'light': lgt})

# ----------------------------------------------------------------------------
# CAMERA
# ----------------------------------------------------------------------------
bpy.ops.object.camera_add(location=(0, 10, 20))
cam = bpy.context.active_object
cam.name = 'HeroCam'
cam.data.lens = 35
scene.camera = cam

target = bpy.data.objects.new('CamTarget', None)
scene.collection.objects.link(target)
target.location = (0, 2, 0)

cons = cam.constraints.new(type='TRACK_TO')
cons.target = target
cons.track_axis = 'TRACK_NEGATIVE_Z'
cons.up_axis = 'UP_Y'

# ----------------------------------------------------------------------------
# CHARACTERS (6 expressive, low-poly)
# ----------------------------------------------------------------------------
def add_cyl(r1, r2, depth, loc, rot=None, mat=None, name='cyl'):
    bpy.ops.mesh.primitive_cylinder_add(radius_top=r1, radius_bottom=r2, depth=depth, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    if rot: ob.rotation_euler = rot
    if mat: ob.data.materials.append(mat)
    return ob

def add_sph(radius, loc, mat=None, name='sph'):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=loc, segments=30, ring_count=30)
    ob = bpy.context.active_object
    ob.name = name
    if mat: ob.data.materials.append(mat)
    return ob

def add_box_small(size, loc, mat=None, name='box'):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    if mat: ob.data.materials.append(mat)
    return ob

chars = []
TOTAL_CHARS = 6
for i in range(TOTAL_CHARS):
    ang = (i / TOTAL_CHARS) * math.pi * 2
    rad = 17
    cx, cz = math.cos(ang)*rad, math.sin(ang)*rad
    grp = bpy.data.objects.new(f'Char_{i}', None)
    scene.collection.objects.link(grp)
    grp.location = (cx, 0, cz)
    grp.rotation_euler = (0, ang + math.pi, 0)
    chars.append(grp)

    body = add_cyl(0.7, 0.7, 2.2, (0, 1.1, 0), mat=M_CLOTH, name='Body')
    body.parent = grp

    head = add_sph(0.9, (0, 2.5, 0), mat=M_SKIN, name='Head')
    head.parent = grp

    neck = add_cyl(0.24, 0.24, 0.45, (0, 2.05, 0), mat=M_SKIN, name='Neck')
    neck.parent = grp

    eyeL = add_sph(0.17, (-0.28, 0.11, 0.8), mat=M_EYE, name='EyeL')
    eyeL.parent = head
    eyeR = add_sph(0.17, (0.28, 0.11, 0.8), mat=M_EYE, name='EyeR')
    eyeR.parent = head

    pupilL = add_sph(0.07, (0, 0, 0.18), mat=M_PUPIL, name='PupilL')
    pupilL.parent = eyeL
    pupilR = add_sph(0.07, (0, 0, 0.18), mat=M_PUPIL, name='PupilR')
    pupilR.parent = eyeR

    browL = add_box_small((0.55, 0.05, 0.04), (-0.28, 0.26, 0.83), mat=M_CLOTH, name='BrowL')
    browL.parent = head
    browR = add_box_small((0.55, 0.05, 0.04), (0.28, 0.26, 0.83), mat=M_CLOTH, name='BrowR')
    browR.parent = head

    mouth = add_box_small((0.28, 0.11, 0.06), (0, -0.18, 0.83), mat=M_MOUTH, name='Mouth')
    mouth.parent = head

    armL = add_cyl(0.19, 0.15, 1.2, (-0.9, 1.35, 0), rot=(0,0,0.45), mat=M_CLOTH, name='ArmL')
    armL.parent = grp
    armR = add_cyl(0.19, 0.15, 1.2, (0.9, 1.35, 0), rot=(0,0,-0.45), mat=M_CLOTH, name='ArmR')
    armR.parent = grp

    legL = add_cyl(0.26, 0.22, 1.4, (-0.26, 0.33, 0), mat=M_CLOTH, name='LegL')
    legL.parent = grp
    legR = add_cyl(0.26, 0.22, 1.4, (0.26, 0.33, 0), mat=M_CLOTH, name='LegR')
    legR.parent = grp

# ----------------------------------------------------------------------------
# KEYFRAME HELPERS
# ----------------------------------------------------------------------------
def cam_keyframe(frame, loc, tar, lens=35, roll=0.0):
    cam.location = loc
    cam.keyframe_insert(data_path='location', frame=frame)
    target.location = tar
    target.keyframe_insert(data_path='location', frame=frame)
    cam.data.lens = lens
    cam.data.keyframe_insert(data_path='lens', frame=frame)
    cam.rotation_euler.z = roll
    cam.keyframe_insert(data_path='rotation_euler', frame=frame)

# ----------------------------------------------------------------------------
# STORY BEAT KEYFRAMES (camera) — 18 beats
# (start_frame, end_frame, loc, target, lens, roll)
# ----------------------------------------------------------------------------
cam_beats = [
    (1,      150,   (0, 10, 20),   (0, 2, 0),   35,  0.0),   # hook
    (150,    240,   (3, 8, 15),    (0, 7, 0),   40,  0.14),  # crack
    (240,    330,   (-6,10,11),    (0, 6, 0),   38, -0.21),   # glass
    (330,    450,   (-9,12,12),    (0, 5, 0),   37, -0.28),   # fold
    (450,    570,   (12, 9, 4),    (0, 1, 0),   40,  0.42),   # gravity
    (570,    690,   (0, 5, 18),    (0, 2, 0),   35,  0.0),    # awaken
    (690,    810,   (6, 8, 12),    (0, 3, 0),   48, -0.21),   # surge
    (810,    930,   (0, 7, 6),     (0, 0, 0),   52,  0.0),    # break
    (930,    1050,  (-5, 9, 3),    (0, 3, 0),   46,  0.24),   # debris
    (1050,   1170,  (-16, 10,-10), (0, 5, 0),   37,  0.35),   # zerog
    (1170,   1290,  (24, 16, 24),  (0, 2, 0),   35,  0.0),    # reassemble
    (1290,   1410,  (36, 26,-14),  (0, 7, 0),   34, -0.14),   # spiral
    (1410,   1530,  (0, 9, 26),    (0, 5, 0),   34,  0.0),    # hope
    (1530,   1650,  (44, 34,-24),  (0, 9, 0),   33, -0.10),   # stars
    (1650,   1800,  (0, 10, 20),   (0, 2, 0),   35,  0.0),    # loop
]

for i in range(len(cam_beats)-1):
    f1, f2, loc, tar, lens, roll = cam_beats[i]
    f2_next = cam_beats[i+1][0]
    cam_keyframe(f1, loc, tar, lens, roll)
    cam_keyframe(f2_next, cam_beats[i+1][1], cam_beats[i+1][2], cam_beats[i+1][4], cam_beats[i+1][5])
    for fcu in cam.animation_data.action.fcurves:
        for kf in fcu.keyframe_points:
            if f1 <= kf.co.x <= f2_next:
                kf.interpolation = 'BEZIER'
    for fcu in target.animation_data.action.fcurves if target.animation_data else []:
        for kf in fcu.keyframe_points:
            if f1 <= kf.co.x <= f2_next:
                kf.interpolation = 'BEZIER'

# ----------------------------------------------------------------------------
# CHARACTER ANIMATION
# ----------------------------------------------------------------------------
expr_schedule = [
    (1,   'neutral'),
    (150, 'wonder'),
    (240, 'wonder'),
    (330, 'awe'),
    (450, 'awe'),
    (570, 'awe'),
    (690, 'awe'),
    (810, 'determination'),
    (930, 'determination'),
    (1050,'awe'),
    (1170,'awe'),
    (1290,'calm'),
    (1410,'calm'),
    (1530,'calm'),
    (1650,'calm'),
    (1800,'neutral'),
]
for cidx, grp in enumerate(chars):
    offset = cidx * 8
    for frame, expr in expr_schedule:
        f = min(frame + offset, TOTAL_FRAMES)
        head = [c for c in grp.children if c.name=='Head'][0]
        mouth = [c for c in head.children if c.name=='Mouth'][0]
        browL = [c for c in head.children if c.name=='BrowL'][0]
        browR = [c for c in head.children if c.name=='BrowR'][0]
        presets = {
            'neutral':   dict(my=0.11, by=0.26),
            'wonder':    dict(my=0.24, by=0.34),
            'awe':       dict(my=0.36, by=0.38),
            'determination': dict(my=0.13, by=0.16),
            'calm':      dict(my=0.09, by=0.26),
        }
        p = presets.get(expr, presets['neutral'])
        mouth.scale.y = p['my'] / 0.11
        mouth.keyframe_insert(data_path='scale', frame=f, index=1)
        browL.location.y = p['by']; browL.keyframe_insert(data_path='location', frame=f, index=1)
        browR.location.y = p['by']; browR.keyframe_insert(data_path='location', frame=f, index=1)

# ----------------------------------------------------------------------------
# BUILDING FOLD (destruction beat ~ frames 810-930)
# ----------------------------------------------------------------------------
for b in buildings:
    b.keyframe_insert(data_path='scale', frame=810)
    b.keyframe_insert(data_path='rotation_euler', frame=810)
    b.scale.z = 0.15
    b.rotation_euler.x = 0.6
    b.keyframe_insert(data_path='scale', frame=930)
    b.keyframe_insert(data_path='rotation_euler', frame=930)
    b.scale.z = 1.0
    b.rotation_euler.x = 0.0
    b.keyframe_insert(data_path='scale', frame=1170)
    b.keyframe_insert(data_path='rotation_euler', frame=1170)

# ----------------------------------------------------------------------------
# DEBRIS
# ----------------------------------------------------------------------------
for i in range(210):
    bpy.ops.mesh.primitive_cube_add(size=0.4, location=(0, 10, 0))
    s = bpy.context.active_object
    s.name = f'Debris_{i}'
    s.scale = (0.4, random.uniform(0.8, 1.8), 0.4)
    m = bpy.data.materials.new('DebrisMat')
    m.use_nodes = True
    m.node_tree.nodes.get("Principled BSDF").inputs['Base Color'].default_value = (0.54,0.54,0.54,1)
    m.node_tree.nodes.get("Principled BSDF").inputs['Roughness'].default_value = 0.85
    s.data.materials.append(m)
    s.keyframe_insert(data_path='location', frame=810)
    s.keyframe_insert(data_path='rotation_euler', frame=810)
    vx, vy, vz = random.uniform(-10,10), random.uniform(5,16), random.uniform(-10,10)
    end_frame = 810 + random.randint(50, 150)
    s.location = (vx*0.6, 10+vy*0.12, vz*0.6)
    s.keyframe_insert(data_path='location', frame=end_frame)
    s.keyframe_insert(data_path='rotation_euler', frame=end_frame)

# ----------------------------------------------------------------------------
# RENDER ANIMATION
# ----------------------------------------------------------------------------
import os
frames_dir = os.path.join(os.getcwd(), 'frames')
os.makedirs(frames_dir, exist_ok=True)
bpy.context.scene.render.filepath = frames_dir + '/'
bpy.ops.render.render(animation=True)
print(f"Rendered {TOTAL_FRAMES} frames to {frames_dir}/")

# ----------------------------------------------------------------------------
# SAVE
# ----------------------------------------------------------------------------
bpy.ops.wm.save_as_mainfile(filepath='//scene.blend')
print("TABAHI Blender scene saved: scene.blend")
print(f"Frames: 1..{TOTAL_FRAMES} @ {FPS} FPS, {WIDTH}x{HEIGHT}")
