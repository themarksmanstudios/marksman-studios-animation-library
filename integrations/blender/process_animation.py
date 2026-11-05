"""Background Blender worker for one Marksman production manifest."""
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


SUPPORTED = {".fbx", ".bvh", ".glb", ".gltf", ".blend"}
VIDEO = {".mp4", ".mov", ".webm", ".mkv"}


def load_json(path):
    with open(path, "r", encoding="utf-8-sig") as stream:
        return json.load(stream)


def save_json(path, value):
    with open(path, "w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")


def files_in(directory, extensions):
    return sorted((p for p in Path(directory).glob("*") if p.is_file() and p.suffix.lower() in extensions), key=lambda p: p.name.lower())


def action_fcurves(action):
    """Return curves from both legacy and Blender 5 layered Actions."""
    curves = list(getattr(action, "fcurves", ()))
    for layer in getattr(action, "layers", ()):
        for strip in getattr(layer, "strips", ()):
            for channelbag in getattr(strip, "channelbags", ()):
                curves.extend(channelbag.fcurves)
    return curves


def action_curve_count(action):
    return len(action_fcurves(action))


def import_asset(file_path):
    suffix = file_path.suffix.lower()
    if suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(file_path))
    elif suffix == ".bvh":
        bpy.ops.import_anim.bvh(filepath=str(file_path))
    elif suffix in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(file_path))
    elif suffix == ".blend":
        with bpy.data.libraries.load(str(file_path), link=False) as (source, destination):
            destination.objects = list(source.objects)
        for obj in destination.objects:
            if obj:
                bpy.context.scene.collection.objects.link(obj)
    else:
        raise RuntimeError("Unsupported Blender input: " + str(file_path))


def is_source_head_mesh(obj):
    if obj.type != "MESH":
        return False
    for value in (obj.name, obj.data.name if obj.data else ""):
        name = re.sub(r"\.\d+$", "", value).lower()
        compact = re.sub(r"[^a-z0-9]", "", name)
        if re.search(r"(^|[^a-z0-9])head[a-z0-9]*(?=$|[^a-z0-9])", name):
            return True
        if re.search(r"head(?:face|mesh|geo|lod\d*)?$", compact):
            return True
    return False


def strip_source_head_meshes(objects):
    """Remove separately named head mesh objects, never armature head bones."""
    live_objects = [obj for obj in objects if obj.name in bpy.data.objects]
    heads = [obj for obj in live_objects if is_source_head_mesh(obj)]
    head_pointers = {obj.as_pointer() for obj in heads}
    remaining = [obj for obj in live_objects if obj.as_pointer() not in head_pointers]
    for obj in heads:
        bpy.data.objects.remove(obj, do_unlink=True)
    return remaining


def hide_imported_rig_from_render(scene, original_objects):
    """Keep the source body/rig available in the scene, but out of renders."""
    for obj in scene.objects:
        if obj not in original_objects:
            obj.hide_render = True


def sanitize_blend_source(source, output):
    script = Path(__file__).with_name("sanitize_blend.py")
    output = Path(output)
    output.unlink(missing_ok=True)
    result = subprocess.run(
        [bpy.app.binary_path, "--background", str(source), "--python", str(script), "--", str(output)],
        capture_output=True, text=True, timeout=1800,
    )
    if result.returncode or not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError("Could not create headless Blender source copy: " + (result.stderr or result.stdout)[-3000:])


def rig_related_objects(imported_objects):
    armatures = [obj for obj in imported_objects if obj.type == "ARMATURE"]
    if not armatures:
        return imported_objects
    selected = set(armatures)
    for obj in imported_objects:
        if obj.type != "MESH":
            continue
        if obj.parent in armatures or obj.parent_type == "BONE" or any(
            modifier.type == "ARMATURE" and modifier.object in armatures for modifier in obj.modifiers
        ):
            selected.add(obj)
    for obj in list(selected):
        parent = obj.parent
        while parent and parent in imported_objects:
            selected.add(parent)
            parent = parent.parent
    return [obj for obj in imported_objects if obj in selected]


def set_source_export_action(armature, scene):
    """Put the source animation on a dedicated NLA strip so FBX writes a take."""
    action = action_for_rig(armature)
    if not action or not action_curve_count(action):
        return None
    animation = armature.animation_data_create()
    slot = getattr(animation, "action_slot", None)
    action_slots = list(getattr(action, "slots", ()))
    if action_slots and slot not in action_slots:
        slot = action_slots[0]
    animation.action = action
    if slot and hasattr(animation, "action_slot"):
        animation.action_slot = slot
    track = animation.nla_tracks.new()
    track.name = "Source FBX Export"
    track.is_solo = True
    start = int(action.frame_range[0])
    strip = track.strips.new(action.name, start, action)
    if slot and hasattr(strip, "action_slot"):
        strip.action_slot = slot
    animation.action = None
    scene.frame_start = int(action.frame_range[0])
    scene.frame_end = max(int(action.frame_range[1]), scene.frame_start + 1)
    scene.frame_set(scene.frame_start)
    bpy.context.view_layer.update()
    return action


def export_sanitized_source(asset, imported_objects, output_directory, final_output_directory=None):
    """Export source armature/action as FBX after removing only its head mesh."""
    output_directory = Path(output_directory)
    output_directory.mkdir(parents=True, exist_ok=True)
    output = output_directory / (asset.stem + ".fbx")
    if asset.suffix.lower() == ".blend":
        strip_source_head_meshes(imported_objects)
        sanitize_blend_source(asset, output)
    else:
        cleaned_objects = strip_source_head_meshes(imported_objects)
        for obj in bpy.context.scene.objects:
            obj.select_set(False)
        exportable = rig_related_objects(cleaned_objects)
        if not exportable:
            raise RuntimeError("Could not export source animation as FBX because the input did not import any objects: " + str(asset))
        output.unlink(missing_ok=True)
        for obj in exportable:
            obj.select_set(True)
        armatures = [obj for obj in exportable if obj.type == "ARMATURE"]
        if not armatures:
            raise RuntimeError("Could not export source animation as FBX because the input has no armature: " + str(asset))
        bpy.context.view_layer.objects.active = armatures[0]
        actions = [set_source_export_action(armature, bpy.context.scene) for armature in armatures]
        if not any(actions):
            raise RuntimeError("Could not export source animation as FBX because no animated action was assigned: " + str(asset))
        bpy.ops.export_scene.fbx(
            filepath=str(output), use_selection=True, object_types={"ARMATURE", "MESH", "EMPTY"},
            add_leaf_bones=False, use_armature_deform_only=False, bake_anim=True,
            bake_anim_use_nla_strips=True, bake_anim_use_all_bones=True,
        )
        for obj in bpy.context.scene.objects:
            obj.select_set(False)
    final_copy = None
    if final_output_directory:
        final_directory = Path(final_output_directory)
        final_directory.mkdir(parents=True, exist_ok=True)
        final_copy = final_directory / output.name
        if final_copy.resolve() != output.resolve():
            shutil.copy2(output, final_copy)
    return output, final_copy


def import_motion_inputs(manifest, export_sanitized=True):
    paths = manifest["paths"]
    motion_files = files_in(paths["motionSource"], SUPPORTED)
    imported = []
    sanitized_outputs = []
    prior_objects = set(bpy.context.scene.objects)
    prior_actions = set(bpy.data.actions)
    for asset in motion_files:
        before_asset_objects = set(bpy.context.scene.objects)
        import_asset(asset)
        asset_objects = [obj for obj in bpy.context.scene.objects if obj not in before_asset_objects]
        if export_sanitized:
            final_root = Path(paths.get("finalProduct", Path(paths["motionSource"]).parent / "09-final-product"))
            final_source_output = str(final_root / "general-animations")
            sanitized, final_copy = export_sanitized_source(
                asset, asset_objects,
                paths.get("motionSourceOutput", str(Path(paths["motionSource"]) / "rig-output")),
                final_source_output,
            )
            sanitized_outputs.append(str(sanitized))
            if final_copy:
                sanitized_outputs.append(str(final_copy))
        imported.append(str(asset))
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE" and obj not in prior_objects]
    actions = [action for action in bpy.data.actions if action not in prior_actions]
    source_action = max(actions, key=action_curve_count, default=None)
    if not source_action:
        source_action = next((action_for_rig(rig) for rig in armatures if action_for_rig(rig)), None)
    if armatures and source_action:
        # Blender importers often attach the action automatically; preserve it if not.
        for rig in armatures:
            if not (rig.animation_data and rig.animation_data.action):
                rig.animation_data_create()
                rig.animation_data.action = source_action
    return imported, armatures, source_action, sanitized_outputs


def choose_character_rig(objects):
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not armatures:
        return None
    def score(rig):
        child_meshes = sum(1 for obj in objects if obj.type == "MESH" and (obj.parent == rig or any(mod.type == "ARMATURE" and mod.object == rig for mod in obj.modifiers)))
        return child_meshes * 10 + (1 if rig.animation_data and rig.animation_data.action else 0)
    return max(armatures, key=score)


def action_for_rig(rig):
    animation = rig.animation_data
    if animation and animation.action:
        return animation.action
    if animation:
        for track in animation.nla_tracks:
            for strip in track.strips:
                if strip.action:
                    return strip.action
    return None


def character_export_objects(template_objects, character_rig, fallback_armatures):
    if character_rig:
        selected = {character_rig}
        frontier = [character_rig]
        while frontier:
            parent = frontier.pop()
            children = [obj for obj in template_objects if obj.parent == parent and obj not in selected]
            selected.update(children)
            frontier.extend(children)
        for obj in template_objects:
            if obj.type == "MESH" and any(mod.type == "ARMATURE" and mod.object == character_rig for mod in obj.modifiers):
                selected.add(obj)
        return list(selected)
    meshes = [obj for obj in template_objects if obj.type == "MESH"]
    if meshes:
        return meshes
    return fallback_armatures


def ensure_camera_and_light(scene):
    subject = [obj for obj in scene.objects if obj.type in {"MESH", "ARMATURE"} and obj.visible_get()]
    center = (0.0, 0.0, 1.0)
    if subject:
        points = [obj.matrix_world.translation for obj in subject]
        center = tuple(sum(p[i] for p in points) / len(points) for i in range(3))
    if not scene.camera:
        camera_data = bpy.data.cameras.new("Preview Camera")
        camera = bpy.data.objects.new("Preview Camera", camera_data)
        scene.collection.objects.link(camera)
        camera.location = (center[0] + 4.5, center[1] - 6.0, center[2] + 2.6)
        camera_data.lens = 48
        from mathutils import Vector
        direction = Vector(center) - camera.location
        camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        scene.camera = camera
    if any(obj.type == "LIGHT" and not obj.hide_render for obj in scene.objects):
        return
    light_data = bpy.data.lights.new("Preview Key Light", "AREA")
    light = bpy.data.objects.new("Preview Key Light", light_data)
    scene.collection.objects.link(light)
    light.location = (center[0] + 2.0, center[1] - 3.0, center[2] + 5.0)
    light_data.energy = 900
    light_data.shape = "DISK"
    light_data.size = 5
    light.rotation_euler = camera.rotation_euler


def apply_hdri(scene, hdri_path):
    world = scene.world
    if not world or not world.use_nodes or not world.node_tree:
        return False
    nodes = world.node_tree.nodes
    output = next((node for node in nodes if node.type == "OUTPUT_WORLD" and node.is_active_output), None)
    if output is None:
        output = next((node for node in nodes if node.type == "OUTPUT_WORLD"), None)
    if output is None:
        return False

    visited = set()

    def find_environment(node):
        node_key = node.as_pointer()
        if node_key in visited:
            return None
        visited.add(node_key)
        if node.type == "TEX_ENVIRONMENT":
            return node
        for socket in node.inputs:
            for link in socket.links:
                result = find_environment(link.from_node)
                if result:
                    return result
        return None

    environment = find_environment(output)
    if environment is None:
        return False
    # Preserve the scene's World graph, profile, mapping, rotation, and strength.
    # Only replace the image datablock on the connected Environment Texture node.
    environment.image = bpy.data.images.load(str(hdri_path), check_existing=True)
    return True


def tune_preview_lighting(scene):
    """Slightly soften preview exposure without changing the World node graph."""
    if scene.get("marksman_preview_lighting_tuned", False):
        return
    scene.view_settings.exposure -= 0.1
    if scene.world and scene.world.use_nodes and scene.world.node_tree:
        for node in scene.world.node_tree.nodes:
            if node.type == "BACKGROUND":
                node.inputs["Strength"].default_value *= 0.9
    for obj in scene.objects:
        if obj.type != "LIGHT":
            continue
        obj.data.energy *= 0.8 if obj.data.type == "POINT" else 0.9
    scene["marksman_preview_lighting_tuned"] = True


def export_glb(subjects, folder, basename):
    if not subjects:
        return None
    # glTF does not round-trip Blender's bone-parent inverse reliably for the
    # mannequin's many rigid pieces. Bake that inverse into each mesh and use
    # a one-bone skin so the GLB matches the rendered Blender pose.
    frame, subframe = bpy.context.scene.frame_current, bpy.context.scene.frame_subframe
    bpy.context.scene.frame_set(bpy.context.scene.frame_start)
    bpy.context.view_layer.update()
    for obj in subjects:
        if obj.type != "MESH" or obj.parent_type != "BONE" or not obj.parent or obj.parent.type != "ARMATURE":
            continue
        rig = obj.parent
        bone_name = obj.parent_bone
        bone = rig.data.bones.get(bone_name)
        posed = rig.pose.bones.get(bone_name)
        if not bone or not posed:
            continue
        world = obj.matrix_world.copy()
        obj.parent = rig
        obj.parent_type = "OBJECT"
        obj.parent_bone = ""
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_world = world
        obj.data = obj.data.copy()
        deformation = rig.matrix_world @ posed.matrix @ bone.matrix_local.inverted_safe() @ rig.matrix_world.inverted_safe()
        local_deformation = obj.matrix_world.inverted_safe() @ deformation @ obj.matrix_world
        correction = local_deformation.inverted_safe()
        for vertex in obj.data.vertices:
            vertex.co = correction @ vertex.co
        group = obj.vertex_groups.get(bone_name) or obj.vertex_groups.new(name=bone_name)
        group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
        modifier = obj.modifiers.new(name="Rigid bone skin", type="ARMATURE")
        modifier.object = rig
    bpy.context.scene.frame_set(frame, subframe=subframe)
    bpy.context.view_layer.update()
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    for obj in subjects:
        if obj.name in bpy.context.view_layer.objects:
            obj.select_set(True)
    active = next((obj for obj in subjects if obj.type == "ARMATURE"), subjects[0])
    if active:
        bpy.context.view_layer.objects.active = active
    output = Path(folder) / (basename + ".glb")
    # Export only the action assigned to the selected character. Blender's
    # default ACTIONS mode also exports unrelated template actions (for
    # example, the scene's old "Jumpinh" clip) as the first GLB animation.
    bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", use_selection=True, export_animations=True, export_animation_mode="ACTIVE_ACTIONS", export_nla_strips=False, export_skins=True)
    with output.open("rb") as stream:
        header = stream.read(12)
        if len(header) != 12:
            raise RuntimeError("GLB export is truncated: missing header.")
        magic, version, total_length = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2 or total_length != output.stat().st_size:
            raise RuntimeError("GLB export has an invalid header or total length.")
        document = None
        while stream.tell() < total_length:
            chunk_header = stream.read(8)
            if len(chunk_header) != 8:
                break
            chunk_length, chunk_type = struct.unpack("<II", chunk_header)
            chunk = stream.read(chunk_length)
            if len(chunk) != chunk_length:
                break
            if chunk_type == 0x4E4F534A:
                document = json.loads(chunk.decode("utf-8").rstrip(" \t\r\n\x00"))
                break
    if document is None:
        raise RuntimeError("GLB export is missing its glTF scene data.")
    expected_meshes = len({obj.data.as_pointer() for obj in subjects if obj.type == "MESH" and len(obj.data.vertices)})
    actual_meshes = len(document.get("meshes", []))
    if actual_meshes != expected_meshes:
        raise RuntimeError(f"GLB is missing character mesh data: expected {expected_meshes} unique meshes, exported {actual_meshes}.")
    if any(obj.type == "ARMATURE" for obj in subjects) and not document.get("skins"):
        raise RuntimeError("GLB export is missing the character skin/armature data.")
    character_rig = next((obj for obj in subjects if obj.type == "ARMATURE"), None)
    if character_rig and character_rig.animation_data and character_rig.animation_data.action and not document.get("animations"):
        raise RuntimeError("GLB export is missing the character's active retargeted animation.")
    return output


def retarget_to_rig(source_rig, target_rig, map_file, scene):
    mapping = load_json(map_file) if Path(map_file).exists() else {}
    source_is_mixamo = any(bone.name.lower().startswith("mixamorig") for bone in source_rig.data.bones)

    def identity(name, mixamo=False):
        lowered = name.lower()
        side = "l" if "left" in lowered or re.search(r"(^|[^a-z])l([^a-z]|$)|([._-]l)$", lowered) else "r" if "right" in lowered or re.search(r"(^|[^a-z])r([^a-z]|$)|([._-]r)$", lowered) else ""
        compact = re.sub(r"^.*:", "", lowered)
        # Strip the side first: a leading "Right" must not be mistaken for
        # the generic "rig" prefix (which would turn RightHand into hthand).
        compact = compact.replace("left", "").replace("right", "")
        compact = re.sub(r"^(mixamorig|armature|skeleton|rig|def|org)[._-]*", "", compact)
        compact = re.sub(r"^(bip\d*|valvebiped)[._-]*", "", compact)
        compact = re.sub(r"^(l|r)[._-]+", "", compact)
        compact = re.sub(r"(^|[._-])(l|r)$", "", compact)
        compact = re.sub(r"[^a-z0-9]", "", compact)
        if compact in {"hips", "hip", "pelvis"}:
            base = "pelvis"
        elif compact == "root":
            base = "root"
        elif compact.startswith("spine"):
            suffix = compact[5:]
            index = int(suffix) + (1 if mixamo and suffix.isdigit() else 0) if suffix.isdigit() else 1
            base = "spine" + str(index)
        elif compact in {"shoulder", "clavicle", "collar", "collarbone"}:
            base = "clavicle"
        elif compact in {"arm", "upperarm", "uparm", "humerus"}:
            base = "upperarm"
        elif compact in {"forearm", "lowerarm", "elbow"}:
            base = "lowerarm"
        elif compact in {"upleg", "upperleg", "thigh", "femur"}:
            base = "thigh"
        elif compact in {"leg", "lowerleg", "calf", "shin", "tibia"}:
            base = "calf"
        elif compact in {"foot", "ankle"}:
            base = "foot"
        elif compact in {"toebase", "toe", "ball"}:
            base = "toe"
        elif compact in {"neck", "head", "hand", "wrist"}:
            base = "hand" if compact == "wrist" else compact
        else:
            finger = re.search(r"(thumb|index|middle|ring|pinky|little)(\d*)$", compact)
            base = f"{finger.group(1)}{int(finger.group(2) or 0)}" if finger else compact
        return base, side

    target_by_identity = {}
    for bone in target_rig.data.bones:
        target_by_identity.setdefault(identity(bone.name), []).append(bone.name)
    used_targets = set(mapping.values())
    for bone in source_rig.data.bones:
        if bone.name in mapping:
            continue
        if target_rig.data.bones.get(bone.name) and bone.name not in used_targets:
            mapping[bone.name] = bone.name
            used_targets.add(bone.name)
            continue
        candidates = target_by_identity.get(identity(bone.name, source_is_mixamo), [])
        match = next((name for name in candidates if name not in used_targets), None)
        if match:
            mapping[bone.name] = match
            used_targets.add(match)
    if not mapping:
        return False
    mapped = {}
    for source_bone, target_bone in mapping.items():
        if source_rig.data.bones.get(source_bone) is None or target_rig.data.bones.get(target_bone) is None:
            continue
        pose_bone = target_rig.pose.bones.get(target_bone)
        if not pose_bone:
            continue
        mapped[target_bone] = source_bone
    if not mapped:
        return False

    # Source and character rigs can share Mixamo names but still have different
    # bone roll and rest poses.
    # Transfer each source bone's world-space rotation delta from its own rest
    # orientation onto the corresponding target rest orientation, then solve
    # target local channels from the target hierarchy. The studio T-pose is the
    # target rest pose; directly copying source axes would reintroduce pose bias.
    if target_rig.animation_data:
        target_rig.animation_data.action = None
        for track in list(target_rig.animation_data.nla_tracks):
            target_rig.animation_data.nla_tracks.remove(track)
    target_rig.animation_data_create()
    action = bpy.data.actions.new(name=f"{source_rig.name}_to_{target_rig.name}_Retargeted")
    for pose_bone in target_rig.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.location = (0.0, 0.0, 0.0)
        pose_bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pose_bone.scale = (1.0, 1.0, 1.0)
    slot = action.slots.new("OBJECT", target_rig.name)
    layer = action.layers.new("Retargeted motion")
    strip = layer.strips.new(type="KEYFRAME")
    channelbag = strip.channelbag(slot, ensure=True)
    target_rig.animation_data.action = action
    target_rig.animation_data.action_slot = slot

    source_rest_world = {
        name: source_rig.matrix_world @ source_rig.data.bones[name].matrix_local
        for name in mapped.values()
    }
    target_rest_world = {
        name: target_rig.matrix_world @ target_rig.data.bones[name].matrix_local
        for name in mapped
    }
    target_rest_local = {}
    for bone in target_rig.data.bones:
        target_rest_local[bone.name] = bone.parent.matrix_local.inverted_safe() @ bone.matrix_local if bone.parent else bone.matrix_local.copy()
    target_by_identity = {identity(bone.name): bone.name for bone in target_rig.data.bones}
    hand_landmarks = {}
    for side in ("l", "r"):
        target_names = {part: target_by_identity.get((part, side)) for part in ("hand", "index1", "middle1", "pinky1")}
        if all(target_names.values()) and all(mapped.get(name) for name in target_names.values()):
            hand_landmarks[side] = (target_names, {part: mapped[name] for part, name in target_names.items()})

    def palm_axes(hand, index, middle, pinky):
        across = index - pinky
        forward = middle - hand
        if across.length < 1e-6 or forward.length < 1e-6:
            return None
        across.normalize()
        forward -= across * forward.dot(across)
        if forward.length < 1e-6:
            return None
        forward.normalize()
        normal = across.cross(forward).normalized()
        return across, forward, normal

    def armature_height(rig):
        points = [rig.matrix_world @ point for bone in rig.data.bones for point in (bone.head_local, bone.tail_local) if bone.use_deform]
        return max((point.z for point in points), default=1.0) - min((point.z for point in points), default=0.0)

    source_height = max(armature_height(source_rig), 1e-6)
    target_height = max(armature_height(target_rig), 1e-6)
    root_scale = target_height / source_height
    target_object_rotation = target_rig.matrix_world.to_quaternion()
    target_world_to_armature = target_rig.matrix_world.inverted_safe()
    source_start = round(scene.frame_start)
    source_end = round(scene.frame_end)
    target_bones = list(target_rig.data.bones)
    target_bones.sort(key=lambda bone: len(bone.parent_recursive))
    curve_values = {}
    sampled_frames = []
    previous_rotations = {}

    # Solve the upper arm and forearm as a two-bone chain. Copying their
    # rotations independently keeps their axes aligned but does not preserve
    # wrist positions when the source and character have different shoulder
    # widths or arm lengths. The source elbow supplies the bend plane (pole).
    arm_chains = []
    inverse_mapping = {target_name: source_name for target_name, source_name in mapped.items()}
    torso_anchor_target = "Chest" if target_rig.data.bones.get("Chest") else None
    torso_anchor_source = inverse_mapping.get(torso_anchor_target) if torso_anchor_target else None
    for side in ("L", "R"):
        upper = f"upper_arm.{side}"
        forearm = f"forearm.{side}"
        hand = f"hand.{side}"
        upper_source = inverse_mapping.get(upper)
        forearm_source = inverse_mapping.get(forearm)
        hand_source = inverse_mapping.get(hand)
        if all((target_rig.data.bones.get(upper), target_rig.data.bones.get(forearm), target_rig.data.bones.get(hand), source_rig.data.bones.get(upper_source or ""), source_rig.data.bones.get(forearm_source or ""), source_rig.data.bones.get(hand_source or ""))):
            arm_chains.append((side, upper, forearm, hand, upper_source, forearm_source, hand_source))

    def source_bone_head_world(rig_eval, bone_name):
        return rig_eval.matrix_world @ rig_eval.pose.bones[bone_name].matrix.translation

    def align_pose_bone_axis(base_pose, bone, desired_direction):
        direction = desired_direction.normalized()
        current_axis = base_pose.to_3x3() @ Vector((0.0, bone.length, 0.0))
        correction = current_axis.normalized().rotation_difference(direction)
        return correction @ base_pose.to_quaternion()

    for frame in range(source_start, source_end + 1):
        sampled_frames.append(frame)
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        source_eval = source_rig.evaluated_get(bpy.context.evaluated_depsgraph_get())
        source_pose_world = {}
        source_delta_world = {}
        source_delta_bone_local = {}
        for source_name in mapped.values():
            pose_bone = source_eval.pose.bones.get(source_name)
            if not pose_bone:
                continue
            current = source_eval.matrix_world @ pose_bone.matrix
            rest = source_rest_world[source_name]
            source_pose_world[source_name] = current
            source_delta_world[source_name] = current.to_quaternion() @ rest.to_quaternion().inverted()
            # Finger channels must be transferred in the bone's own parent
            # space. Comparing armature-space rest/current rotations also
            # includes all animated wrist and palm rotations, which applies
            # those rotations again after the target hand has already moved.
            source_bone = source_rig.data.bones[source_name]
            source_parent = source_bone.parent
            source_parent_pose = source_eval.pose.bones.get(source_parent.name) if source_parent else None
            pose_local = source_parent_pose.matrix.inverted_safe() @ pose_bone.matrix if source_parent_pose else pose_bone.matrix.copy()
            rest_local = source_parent.matrix_local.inverted_safe() @ source_bone.matrix_local if source_parent else source_bone.matrix_local.copy()
            source_delta_bone_local[source_name] = (rest_local.inverted_safe() @ pose_local).to_quaternion()

        arm_goals = {}
        arm_targets = {}
        source_palm_axes = {}
        for side, (_, source_names) in hand_landmarks.items():
            source_palm_axes[side] = palm_axes(*(
                source_bone_head_world(source_eval, source_names[part])
                for part in ("hand", "index1", "middle1", "pinky1")
            ))
        for side, upper, forearm, hand, upper_source, forearm_source, hand_source in arm_chains:
            arm_goals[upper] = (
                forearm, hand,
                source_bone_head_world(source_eval, upper_source),
                source_bone_head_world(source_eval, forearm_source),
                source_bone_head_world(source_eval, hand_source),
                source_pose_world[torso_anchor_source].translation.copy()
                if torso_anchor_source in source_pose_world else source_bone_head_world(source_eval, upper_source),
            )

        target_pose_armature = {}
        for bone in target_bones:
            name = bone.name
            parent_pose = target_pose_armature.get(bone.parent.name) if bone.parent else None
            rest_local = target_rest_local[name]
            base_pose = parent_pose @ rest_local if parent_pose else bone.matrix_local.copy()
            source_name = mapped.get(name)
            if source_name and source_name in source_delta_world:
                rest_world = target_rest_world[name]
                base_name = identity(source_name, source_is_mixamo)[0]
                finger = re.match(r"^(thumb|index|middle|ring|pinky)\d*$", base_name)
                if base_name == "hand" or finger:
                    # Keep wrist and finger rotations local to their posed
                    # parent, but account for each rig's rest bone roll.
                    # The left wrist's raw local Y/Z channels are mirrored
                    # between these Mixamo rigs, as are some thumb channels.
                    alignment = target_rest_world[name].to_quaternion().inverted() @ source_rest_world[source_name].to_quaternion()
                    delta = alignment @ source_delta_bone_local[source_name] @ alignment.inverted()
                    desired_armature_rotation = base_pose.to_quaternion() @ delta
                    if finger:
                        side = identity(source_name, source_is_mixamo)[1]
                        landmark = hand_landmarks.get(side)
                        source_axes = source_palm_axes.get(side)
                        if landmark and source_axes:
                            target_names = landmark[0]
                            hand_name = target_names["hand"]
                            hand_pose = target_pose_armature.get(hand_name)
                            if hand_pose:
                                hand_rest_inverse = target_rig.data.bones[hand_name].matrix_local.inverted_safe()
                                target_points = [hand_pose @ (hand_rest_inverse @ target_rig.data.bones[target_names[part]].head_local)
                                                 for part in ("hand", "index1", "middle1", "pinky1")]
                                target_axes = palm_axes(*target_points)
                                if target_axes:
                                    source_direction = (source_eval.matrix_world.to_3x3() @ source_eval.pose.bones[source_name].vector).normalized()
                                    direction = sum((target_axes[i] * source_direction.dot(source_axes[i]) for i in range(3)), Vector((0.0, 0.0, 0.0)))
                                    if direction.length > 1e-6:
                                        desired_armature_rotation = align_pose_bone_axis(base_pose, bone, direction)
                else:
                    desired_world_rotation = source_delta_world[source_name] @ rest_world.to_quaternion()
                if base_name != "hand" and not finger:
                    desired_armature_rotation = target_object_rotation.inverted() @ desired_world_rotation
                desired_position = base_pose.translation.copy()
                if name in arm_goals:
                    forearm_name, hand_name, source_root, source_elbow, source_hand, source_chest = arm_goals[name]
                    root = base_pose.translation.copy()
                    world_to_armature_rotation = target_world_to_armature.to_3x3()
                    upper_length = target_rig.data.bones[name].length
                    forearm_length = target_rig.data.bones[forearm_name].length
                    # Anchor the source hand and elbow to the chest pose. This
                    # preserves left/right spacing when the target shoulders
                    # are narrower than the motion source. Blend back toward
                    # shoulder-relative goals only as much as needed to keep
                    # each two-bone arm within its reachable length.
                    goal = root + world_to_armature_rotation @ ((source_hand - source_root) * root_scale)
                    pole = root + world_to_armature_rotation @ ((source_elbow - source_root) * root_scale)
                    chest_pose = target_pose_armature.get(torso_anchor_target) if torso_anchor_target else None
                    if chest_pose:
                        chest = chest_pose.translation.copy()
                        chest_goal = chest + world_to_armature_rotation @ ((source_hand - source_chest) * root_scale)
                        chest_pole = chest + world_to_armature_rotation @ ((source_elbow - source_chest) * root_scale)
                        max_reach = max(upper_length + forearm_length - 1e-5, 1e-5)
                        if (chest_goal - root).length > max_reach and (goal - root).length <= max_reach:
                            low, high = 0.0, 1.0
                            for _ in range(18):
                                weight = (low + high) * 0.5
                                blended = goal.lerp(chest_goal, weight)
                                if (blended - root).length <= max_reach:
                                    low = weight
                                else:
                                    high = weight
                            chest_goal = goal.lerp(chest_goal, low)
                            chest_pole = pole.lerp(chest_pole, low)
                        goal, pole = chest_goal, chest_pole
                    reach = goal - root
                    distance = max(reach.length, 1e-6)
                    reach_direction = reach / distance
                    maximum = max_reach
                    minimum = abs(upper_length - forearm_length) + 1e-5
                    clamped_distance = min(max(distance, minimum), maximum)
                    goal = root + reach_direction * clamped_distance
                    pole_direction = pole - root
                    pole_direction -= reach_direction * pole_direction.dot(reach_direction)
                    if pole_direction.length < 1e-6:
                        pole_direction = Vector((0.0, 0.0, 1.0))
                        pole_direction -= reach_direction * pole_direction.dot(reach_direction)
                    pole_direction.normalize()
                    along = (upper_length * upper_length - forearm_length * forearm_length + clamped_distance * clamped_distance) / (2.0 * clamped_distance)
                    height = max(upper_length * upper_length - along * along, 0.0) ** 0.5
                    elbow = root + reach_direction * along + pole_direction * height
                    desired_armature_rotation = align_pose_bone_axis(base_pose, target_rig.data.bones[name], elbow - root)
                    arm_targets[forearm_name] = (hand_name, goal, elbow)
                if name in arm_targets:
                    hand_name, goal, elbow = arm_targets[name]
                    desired_armature_rotation = align_pose_bone_axis(base_pose, target_rig.data.bones[name], goal - elbow)
                if identity(source_name, source_is_mixamo)[0] in {"root", "pelvis"}:
                    source_delta = source_pose_world[source_name].translation - source_rest_world[source_name].translation
                    desired_position += target_world_to_armature.to_3x3() @ (source_delta * root_scale)
                pose_armature = Matrix.LocRotScale(desired_position, desired_armature_rotation, base_pose.to_scale())
                parent_pose_inverse = parent_pose.inverted_safe() if parent_pose else Matrix.Identity(4)
                basis = rest_local.inverted_safe() @ parent_pose_inverse @ pose_armature
                rotation = basis.to_quaternion()
                previous_rotation = previous_rotations.get(name)
                if previous_rotation and previous_rotation.dot(rotation) < 0.0:
                    rotation.negate()
                previous_rotations[name] = rotation.copy()
                for axis in range(4):
                    curve_values.setdefault((name, "rotation_quaternion", axis), []).append(rotation[axis])
                if identity(source_name, source_is_mixamo)[0] in {"root", "pelvis"}:
                    location = basis.to_translation()
                    for axis in range(3):
                        curve_values.setdefault((name, "location", axis), []).append(location[axis])
            else:
                pose_armature = base_pose
            target_pose_armature[name] = pose_armature

    for (bone_name, property_name, axis), values in curve_values.items():
        pose_bone = target_rig.pose.bones[bone_name]
        data_path = pose_bone.path_from_id(property_name)
        curve = channelbag.fcurves.new(data_path=data_path, index=axis, group_name=bone_name)
        curve.keyframe_points.add(len(sampled_frames))
        coordinates = [component for point in zip(sampled_frames, values) for component in point]
        curve.keyframe_points.foreach_set("co", coordinates)
        for keyframe in curve.keyframe_points:
            keyframe.interpolation = "LINEAR"
        curve.update()

    scene.frame_set(source_start)
    bpy.context.view_layer.update()
    return bool(action_fcurves(action))


def export_rig_variants(manifest, render_gif=False, export_playback_glb=True, export_source_fbx=False):
    missing = []
    produced = []
    template = manifest.get("templateFile")
    targets = list(manifest.get("targets", []))
    # Use Mixamo as the default preview source when present, since it is the
    # studio's primary retarget input. Fall back to the next available rig.
    targets.sort(key=lambda target: (0 if target.get("key", "").lower() == "mixamo" else 1, target.get("key", "")))
    gif_done = False
    blend_saved = False
    for target in targets:
        if not template or not Path(template).is_file():
            missing.append(target["label"] + " export needs the uploaded Blender scene template")
            continue
        rig_files = files_in(target["inputDirectory"], SUPPORTED)
        if not rig_files:
            missing.append(target["label"] + " animation/rig file in its rig-input folder")
            continue
        bpy.ops.wm.open_mainfile(filepath=str(template))
        scene = bpy.context.scene
        hdri = manifest.get("hdriFile")
        if hdri and Path(hdri).is_file():
            apply_hdri(scene, hdri)
        tune_preview_lighting(scene)
        template_objects = set(scene.objects)
        character_rig = choose_character_rig(template_objects)
        if not character_rig:
            missing.append(target["label"] + " export needs an armature on the character in the Blender scene")
            continue
        before_objects = set(scene.objects)
        before_actions = set(bpy.data.actions)
        for asset in rig_files:
            before_asset_objects = set(scene.objects)
            import_asset(asset)
            asset_objects = [obj for obj in scene.objects if obj not in before_asset_objects]
            if export_source_fbx:
                input_directory = Path(target["inputDirectory"]).resolve()
                source_output_directory = target.get("sourceOutputDirectory", str(input_directory.parent / "rig-output"))
                final_source_output = target.get("finalSourceOutputDirectory") or str(Path(manifest["paths"].get("finalProduct", input_directory.parents[2] / "09-final-product")) / ("general-animations" if target.get("key") == "general" else input_directory.parent.name))
                sanitized, final_copy = export_sanitized_source(asset, asset_objects, source_output_directory, final_source_output)
                produced.append(str(sanitized))
                if final_copy:
                    produced.append(str(final_copy))
        source_armatures = [obj for obj in scene.objects if obj.type == "ARMATURE" and obj not in before_objects]
        new_actions = [action for action in bpy.data.actions if action not in before_actions]
        source_action = max(new_actions, key=action_curve_count, default=None)
        if not source_action:
            source_action = next((action_for_rig(rig) for rig in source_armatures if action_for_rig(rig)), None)
        source_rig = next((rig for rig in source_armatures if rig.animation_data and rig.animation_data.action == source_action), source_armatures[0] if source_armatures else None)
        if not source_rig or not source_action:
            missing.append(target["label"] + " animation action and armature in its rig-input file")
            continue
        scene.frame_start = round(source_action.frame_range[0])
        scene.frame_end = round(source_action.frame_range[1])
        character_rig.animation_data_create()
        character_rig.animation_data.action = None
        shared_map = manifest.get("mixamoRetargetMapFile")
        local_map = Path(target["inputDirectory"]) / "retarget-map.json"
        map_file = Path(shared_map) if target.get("key") == "mixamo" and shared_map and Path(shared_map).is_file() else local_map
        if not retarget_to_rig(source_rig, character_rig, map_file, scene):
            missing.append(target["label"] + " retarget failed; add retarget-map.json if rig bone names differ from the scene character")
            continue
        # Keep the source body and rig in the saved working scene, but hide
        # them from renders; the approved scene character is the render target.
        hide_imported_rig_from_render(scene, before_objects)
        subjects = character_export_objects(template_objects, character_rig, [])
        if not subjects:
            missing.append(target["label"] + " scene character mesh for GLB export")
            continue
        if render_gif and not gif_done:
            gif, warning = render_preview(manifest, scene)
            if gif:
                produced.append(gif)
                gif_done = True
            if warning:
                missing.append(warning)
        if export_playback_glb:
            # The canonical playback download uses this retargeted character.
            playback_name = Path(manifest["paths"].get("blendFile", manifest["animation"]["title"] + ".blend")).stem + "_playback"
            playback = export_glb(subjects, manifest["paths"]["glb"], playback_name)
            if playback:
                produced.append(str(playback))
        if (render_gif or export_playback_glb) and not blend_saved:
            blend_path = Path(manifest["paths"]["blendFile"])
            blend_path.parent.mkdir(parents=True, exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
            blend_saved = True
    return produced, missing, gif_done


def export_source_animation_files(manifest):
    """Export each source rig animation to its own head-removed FBX outputs."""
    produced, missing = [], []
    paths = manifest["paths"]
    jobs = []
    for target in manifest.get("targets", []):
        input_directory = Path(target["inputDirectory"]).resolve()
        source_output = target.get("sourceOutputDirectory", str(input_directory.parent / "rig-output"))
        final_output = target.get("finalSourceOutputDirectory")
        if not final_output:
            final_root = Path(paths.get("finalProduct", input_directory.parents[2] / "09-final-product"))
            final_folder = "general-animations" if target.get("key") == "general" else input_directory.parent.name
            final_output = str(final_root / final_folder)
        assets = files_in(input_directory, SUPPORTED)
        if not assets:
            missing.append(target.get("label", target.get("key", "Rig")) + " animation/rig file in its rig-input folder")
        jobs.extend((asset, source_output, final_output) for asset in assets)

    motion_directory = Path(paths["motionSource"]).resolve()
    motion_assets = files_in(motion_directory, SUPPORTED)
    if motion_assets:
        final_root = Path(paths.get("finalProduct", motion_directory.parent / "09-final-product"))
        jobs.extend((asset, paths.get("motionSourceOutput", str(motion_directory / "rig-output")), str(final_root / "general-animations")) for asset in motion_assets)

    for asset, source_output, final_output in jobs:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        before_objects = set(bpy.context.scene.objects)
        import_asset(asset)
        imported_objects = [obj for obj in bpy.context.scene.objects if obj not in before_objects]
        sanitized, final_copy = export_sanitized_source(asset, imported_objects, source_output, final_output)
        produced.append(str(sanitized))
        if final_copy:
            produced.append(str(final_copy))
    if not jobs:
        missing.append("No source animation files were found in the rig-input or 02-motion-source folders.")
    return produced, missing


def render_preview(manifest, scene):
    frames_folder = Path(manifest["paths"]["renderFrames"])
    gif_folder = Path(manifest["paths"]["preview"])
    frames_folder.mkdir(parents=True, exist_ok=True)
    render_settings = manifest.get("renderSettings", {})
    width = max(120, min(int(render_settings.get("gifWidth", os.environ.get("BLENDER_PREVIEW_RESOLUTION", "480"))), 1920))
    height = max(120, min(int(render_settings.get("gifHeight", width)), 1920))
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.render.use_persistent_data = True
    start, end = scene.frame_start, scene.frame_end
    if end <= start:
        end = start + 23
        scene.frame_end = end
    source_fps = max(float(scene.render.fps) / max(float(scene.render.fps_base), 1e-6), 1e-6)
    preview_fps = 12
    source_duration = (end - start) / source_fps
    # Every preview spans the complete source action. Sampling evenly also
    # includes its last pose, while GIF frame delays set the exact duration.
    total = max(2, round(source_duration * preview_fps))
    sample_step = (end - start) / max(total - 1, 1)
    frames_folder.mkdir(parents=True, exist_ok=True)
    for previous in frames_folder.glob("frame_*.png"):
        previous.unlink()
    for index in range(total):
        frame_position = min(end, start + sample_step * index)
        frame = int(frame_position)
        scene.frame_set(frame, subframe=frame_position - frame)
        scene.render.filepath = str(frames_folder / ("frame_%04d.png" % index))
        bpy.ops.render.render(write_still=True)
    if total < 2:
        return None, "No frames were rendered."
    output = gif_folder / (Path(manifest["paths"].get("blendFile", manifest["animation"]["title"] + ".blend")).stem + "_preview.gif")
    encoder = Path(__file__).with_name("encode_gif.cjs")
    node = os.environ.get("NODE_EXECUTABLE", "node")
    try:
        encoded = subprocess.run([node, str(encoder), str(frames_folder), str(output), str(total), str(preview_fps), str(round(source_duration * 1000)), "5242880"], check=True, capture_output=True, text=True, timeout=1800)
        result = json.loads(encoded.stdout)
        warning = None
        if result.get("sizeBytes", 0) > 5 * 1024 * 1024:
            warning = "GIF is %.1f MB at %d×%d; palette reduction could not reach the 5 MB target at the selected resolution." % (result["sizeBytes"] / (1024 * 1024), result.get("width", width), result.get("height", height))
        return str(output), warning
    except Exception as error:
        details = getattr(error, "stderr", "") or str(error)
        return None, "PNG frames rendered; GIF conversion failed. Verify sharp is installed with npm install: " + details[-1200:]


def manifest_source_files(manifest):
    sources = []
    template = manifest.get("templateFile")
    if template and Path(template).is_file():
        sources.append({"role": "Blender scene and character", "path": str(Path(template).resolve())})
    hdri = manifest.get("hdriFile")
    if hdri and Path(hdri).is_file():
        sources.append({"role": "Render environment HDRI", "path": str(Path(hdri).resolve())})
    shared_map = manifest.get("mixamoRetargetMapFile")
    if shared_map and Path(shared_map).is_file():
        sources.append({"role": "Shared Mixamo bone map", "path": str(Path(shared_map).resolve())})
    for asset in files_in(manifest["paths"]["motionSource"], SUPPORTED):
        sources.append({"role": "Captured motion source", "path": str(asset.resolve())})
    for target in manifest.get("targets", []):
        for asset in files_in(target["inputDirectory"], SUPPORTED):
            sources.append({"role": target["label"] + " rig animation", "path": str(asset.resolve())})
    return sources


def run(manifest_path):
    manifest_path = Path(manifest_path).resolve()
    manifest = load_json(manifest_path)
    project_path = manifest_path.parent / "project.json"
    project = load_json(project_path)
    job_action = manifest.get("jobAction", "all")
    project.update(status="running", updatedAt=__import__("datetime").datetime.now().astimezone().isoformat(), currentAction=job_action if job_action in {"glb", "gif", "fbx"} else None, lastError=None, sourceFiles=manifest_source_files(manifest))
    save_json(project_path, project)
    previous_outputs = list(project.get("outputs", []))
    outputs, missing = [], []
    try:
        if job_action == "fbx":
            outputs, missing = export_source_animation_files(manifest)
            status = "complete" if outputs and not missing else "partial" if outputs else "failed"
            completed = set(project.get("completedActions", []))
            if any(Path(output).suffix.lower() == ".fbx" and Path(output).is_file() for output in outputs):
                completed.add("fbx")
            last_failed = project.get("lastFailedAction")
            project.update(status=status, currentAction=None, lastFailedAction=None if last_failed == job_action else last_failed, completedActions=sorted(completed), updatedAt=__import__("datetime").datetime.now().astimezone().isoformat(), outputs=list(dict.fromkeys(outputs + previous_outputs)), missingInputs=missing)
            save_json(project_path, project)
            return
        # Keep the last successful preview/playback files until replacements
        # are produced. Failed jobs must not erase the current deliverables.
        basename = Path(manifest["paths"].get("blendFile", manifest["animation"]["title"] + ".blend")).stem
        template = manifest.get("templateFile")
        final_root = Path(manifest["paths"].get("finalProduct", manifest_path.parent / "09-final-product"))
        legacy_variant_folders = {
            "mixamo": ("mixamo",),
            "unreal": ("unreal-engine",),
            "general": ("general-animations", "general", "generic"),
        }
        for target in manifest.get("targets", []):
            key = target.get("key", "").lower()
            basename_variant = basename + "_" + key + ".glb"
            input_parent = Path(target["inputDirectory"]).parent
            obsolete_paths = [input_parent / "output" / basename_variant, final_root / "glb" / basename_variant]
            obsolete_paths.extend(final_root / folder / basename_variant for folder in legacy_variant_folders.get(key, ()))
            configured_output = target.get("outputDirectory")
            if configured_output:
                obsolete_paths.append(Path(configured_output) / basename_variant)
            for obsolete in {path.resolve() for path in obsolete_paths}:
                obsolete.unlink(missing_ok=True)
        if template and Path(template).is_file():
            bpy.ops.wm.open_mainfile(filepath=str(template))
        scene = bpy.context.scene
        hdri = manifest.get("hdriFile")
        if hdri:
            if Path(hdri).is_file():
                if not apply_hdri(scene, hdri):
                    missing.append("The uploaded HDRI was not applied because the Blender scene has no connected Environment Texture node. Its World setup was left unchanged.")
            else:
                missing.append("Configured HDRI file is missing: " + str(hdri))
        template_objects = set(scene.objects)
        character_rig = choose_character_rig(template_objects)
        import_motion_sources = job_action == "all"
        imported, motion_armatures, motion_action, sanitized_motion_outputs = import_motion_inputs(manifest, export_sanitized=import_motion_sources)
        outputs.extend(sanitized_motion_outputs)
        character_baked = False
        if character_rig and motion_action:
            scene.frame_start = round(motion_action.frame_range[0])
            scene.frame_end = round(motion_action.frame_range[1])
            character_rig.animation_data_create()
            character_rig.animation_data.action = None
            source_rig = next((rig for rig in motion_armatures if rig.animation_data and rig.animation_data.action == motion_action), motion_armatures[0] if motion_armatures else None)
            if source_rig:
                shared_map = manifest.get("mixamoRetargetMapFile")
                local_map = Path(manifest["paths"]["motionSource"]) / "retarget-map.json"
                source_to_character = Path(shared_map) if shared_map and Path(shared_map).is_file() else local_map
                if not retarget_to_rig(source_rig, character_rig, source_to_character, scene):
                    missing.append("The scene character could not be retargeted. Add 02-motion-source/retarget-map.json if the source and character bone names differ.")
                else:
                    character_baked = True
        hide_imported_rig_from_render(scene, template_objects)
        active_action = action_for_rig(character_rig) if character_rig else None
        if not active_action:
            active_action = motion_action
        if not character_rig and not any(obj.type == "MESH" for obj in template_objects) and not motion_armatures:
            missing.append("No character was found in the uploaded Blender scene or the motion source.")
        has_rig_animation = any(files_in(target["inputDirectory"], SUPPORTED) for target in manifest.get("targets", []))
        if not motion_action and not active_action and not has_rig_animation:
            missing.append("No motion action found in the scene or 02-motion-source.")
        # Product exports must come from the approved character in the scene
        # template. Never fall back to the imported source rig or its meshes.
        subjects = character_export_objects(template_objects, character_rig, [])
        if subjects:
            ensure_camera_and_light(scene)
            tune_preview_lighting(scene)
            scene.render.image_settings.file_format = "PNG"
            scene.render.image_settings.color_mode = "RGB"
            scene.render.resolution_percentage = 100
            scene.frame_start = round(active_action.frame_range[0]) if active_action else 1
            scene.frame_end = round(active_action.frame_range[1]) if active_action else 24
            if character_baked and job_action in {"glb", "all"}:
                glb = export_glb(subjects, manifest["paths"]["glb"], basename + "_playback")
                if glb:
                    outputs.append(str(glb))
            blend_path = Path(manifest["paths"].get("blendFile", Path(manifest["paths"]["blenderProject"]) / (manifest["animation"]["id"] + ".blend")))
            bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
            outputs.append(str(blend_path))
            if character_baked and job_action in {"gif", "all"}:
                gif, warning = render_preview(manifest, scene)
                if gif:
                    outputs.append(gif)
                if warning:
                    missing.append(warning)
            if not character_baked and job_action in {"gif", "glb", "all"}:
                rig_outputs, rig_missing, rig_gif_done = export_rig_variants(
                    manifest,
                    render_gif=job_action in {"gif", "all"},
                    export_playback_glb=job_action in {"glb", "all"},
                    export_source_fbx=False,
                )
                outputs.extend(rig_outputs)
                missing.extend(rig_missing)
        video_files = files_in(manifest["paths"]["captureVideo"], VIDEO)
        if not video_files:
            missing.append("raw capture video (optional; place it in 01-capture-video)")
        status = "complete" if outputs and not missing else "partial" if outputs else "failed"
        completed = set(project.get("completedActions", []))
        for action, extension in (("glb", ".glb"), ("gif", ".gif"), ("fbx", ".fbx")):
            if job_action in {action, "all"} and any(Path(output).suffix.lower() == extension and Path(output).is_file() for output in outputs):
                completed.add(action)
        last_failed = project.get("lastFailedAction")
        project.update(status=status, currentAction=None, lastFailedAction=None if last_failed == job_action else last_failed, completedActions=sorted(completed), updatedAt=__import__("datetime").datetime.now().astimezone().isoformat(), outputs=list(dict.fromkeys(outputs + previous_outputs)), missingInputs=missing)
        save_json(project_path, project)
    except Exception as error:
        completed = set(project.get("completedActions", []))
        if job_action in {"glb", "gif", "fbx"}:
            completed.discard(job_action)
        project.update(status="failed", currentAction=None, lastFailedAction=job_action if job_action in {"glb", "gif", "fbx"} else None, completedActions=sorted(completed), updatedAt=__import__("datetime").datetime.now().astimezone().isoformat(), outputs=outputs or previous_outputs, lastError=str(error), missingInputs=missing)
        save_json(project_path, project)
        log_path = Path(manifest["paths"]["logs"]) / "blender-error.log"
        log_path.write_text(traceback.format_exc(), encoding="utf-8")
        raise


def main():
    args = sys.argv
    manifest = args[args.index("--") + 1] if "--" in args and len(args) > args.index("--") + 1 else None
    if not manifest:
        raise SystemExit("Expected a production manifest path after --")
    run(manifest)


if __name__ == "__main__":
    main()
