# Makes the Godot-exported glTF files among the examples (examples/godot/, examples/bend.glb) with Godot's exporter, so that the reader is
# tried on files another tool wrote. Everything in them is built here from formulas: no
# art is imported, so they are under this repository's licence.
#
#   godot --headless --path scripts/godot --script export.gd -- OUTDIR
#
# props.gltf  a node tree with rotation, uneven and mirrored scale, indexed primitives,
#             a PBR material with a texture, as .gltf + .bin + .png
# bend.glb    a skinned bar on two bones and a spinning flag, with two animations
extends SceneTree

func _init() -> void:
	var out: String = OS.get_cmdline_user_args()[0]
	_save(_props(), out.path_join("props.gltf"))
	_save(_bend(), out.path_join("bend.glb"))
	quit()

func _save(scene: Node3D, path: String) -> void:
	root.add_child(scene)
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_scene(scene, state)
	if err == OK:
		err = doc.write_to_filesystem(state, path)
	if err != OK:
		push_error("export of %s failed: %d" % [path, err])
	root.remove_child(scene)
	scene.free()

func _material(color: Color, metallic: float, roughness: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.metallic = metallic
	m.roughness = roughness
	return m

func _checker() -> ImageTexture:
	var img := Image.create_empty(8, 8, false, Image.FORMAT_RGBA8)
	for y in 8:
		for x in 8:
			img.set_pixel(x, y, Color8(230, 200, 90) if (x / 2 + y / 2) % 2 == 0 else Color8(60, 70, 110))
	return ImageTexture.create_from_image(img)

func _mesh_node(label: String, mesh: Mesh, material: Material, parent: Node, owner_node: Node) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.name = label
	node.mesh = mesh
	node.material_override = null
	if mesh is PrimitiveMesh:
		mesh.material = material
	parent.add_child(node)
	node.owner = owner_node
	return node

func _props() -> Node3D:
	var scene := Node3D.new()
	scene.name = "Props"
	var textured := _material(Color.WHITE, 0.0, 0.8)
	textured.albedo_texture = _checker()
	var base := _mesh_node("Base", BoxMesh.new(), textured, scene, scene)
	base.scale = Vector3(2.0, 0.5, 1.0)
	var ball := SphereMesh.new()
	ball.radius = 0.4
	ball.height = 0.8
	ball.radial_segments = 12
	ball.rings = 6
	var top := _mesh_node("Ball", ball, _material(Color(0.8, 0.2, 0.15), 0.9, 0.3), base, scene)
	top.position = Vector3(0.25, 1.4, 0.0)
	top.scale = Vector3(0.5, 2.0, 1.0)
	var post := CylinderMesh.new()
	post.top_radius = 0.0
	post.bottom_radius = 0.25
	post.height = 1.0
	post.radial_segments = 8
	var spike := _mesh_node("Spike", post, _material(Color(0.2, 0.6, 0.3), 0.0, 0.5), scene, scene)
	spike.position = Vector3(-0.7, 0.75, 0.0)
	spike.rotation = Vector3(0.0, 0.0, 0.5)
	spike.scale = Vector3(-1.0, 1.0, 1.0)
	return scene

# A square bar from y = 0 to y = 2 in four slices. The lower bone holds the bottom, the
# upper one (at y = 1) the top, and the middle slice is shared half and half.
func _bar() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.set_skin_weight_count(SurfaceTool.SKIN_4_WEIGHTS)
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var corners := [Vector2(-0.15, -0.15), Vector2(0.15, -0.15), Vector2(0.15, 0.15), Vector2(-0.15, 0.15)]
	var levels := 4
	var vertex := func(level: int, c: int) -> void:
		var y := level * 0.5
		var upper := clampf(y - 0.5, 0.0, 1.0)
		var p: Vector2 = corners[c % 4]
		st.set_bones(PackedInt32Array([0, 1, 0, 0]))
		st.set_weights(PackedFloat32Array([1.0 - upper, upper, 0.0, 0.0]))
		st.set_uv(Vector2(c / 4.0, y / 2.0))
		st.add_vertex(Vector3(p.x, y, p.y))
	for level in levels:
		for side in 4:
			# Godot's front faces are clockwise.
			for v in [[level, side], [level + 1, side], [level, side + 1], [level, side + 1], [level + 1, side], [level + 1, side + 1]]:
				vertex.call(v[0], v[1])
	for side in [[levels, [0, 2, 1, 0, 3, 2]], [0, [0, 1, 2, 0, 2, 3]]]:
		for c in side[1]:
			vertex.call(side[0], c)
	st.generate_normals()
	st.index()
	var mesh := st.commit()
	mesh.surface_set_material(0, _material(Color(0.25, 0.45, 0.9), 0.1, 0.6))
	return mesh

func _bend() -> Node3D:
	var scene := Node3D.new()
	scene.name = "Bend"
	var skeleton := Skeleton3D.new()
	skeleton.name = "Rig"
	scene.add_child(skeleton)
	skeleton.owner = scene
	var low := skeleton.add_bone("low")
	var high := skeleton.add_bone("high")
	skeleton.set_bone_parent(high, low)
	skeleton.set_bone_rest(low, Transform3D.IDENTITY)
	skeleton.set_bone_rest(high, Transform3D(Basis.IDENTITY, Vector3(0, 1, 0)))
	skeleton.reset_bone_poses()
	var body := MeshInstance3D.new()
	body.name = "Bar"
	body.mesh = _bar()
	skeleton.add_child(body)
	body.owner = scene
	var skin := Skin.new()
	skin.add_bind(low, Transform3D.IDENTITY)
	skin.add_bind(high, Transform3D(Basis.IDENTITY, Vector3(0, -1, 0)))
	body.skin = skin
	body.skeleton = NodePath("..")
	var flag := MeshInstance3D.new()
	flag.name = "Flag"
	var cloth := BoxMesh.new()
	cloth.size = Vector3(0.6, 0.3, 0.05)
	cloth.material = _material(Color(0.9, 0.5, 0.1), 0.0, 0.7)
	flag.mesh = cloth
	flag.position = Vector3(0.9, 0.5, 0.0)
	scene.add_child(flag)
	flag.owner = scene

	var player := AnimationPlayer.new()
	player.name = "Anim"
	scene.add_child(player)
	player.owner = scene
	var library := AnimationLibrary.new()
	var bend := Animation.new()
	bend.length = 1.0
	bend.loop_mode = Animation.LOOP_LINEAR
	var turn := bend.add_track(Animation.TYPE_ROTATION_3D)
	bend.track_set_path(turn, NodePath("Rig:high"))
	for key in [[0.0, 0.0], [0.25, 1.2], [0.75, -1.2], [1.0, 0.0]]:
		bend.rotation_track_insert_key(turn, key[0], Quaternion(Vector3(0, 0, 1), key[1]))
	library.add_animation("bend", bend)
	var wave := Animation.new()
	wave.length = 2.0
	var move := wave.add_track(Animation.TYPE_POSITION_3D)
	wave.track_set_path(move, NodePath("Flag"))
	wave.position_track_insert_key(move, 0.0, Vector3(0.9, 0.5, 0.0))
	wave.position_track_insert_key(move, 1.0, Vector3(0.9, 1.7, 0.0))
	wave.position_track_insert_key(move, 2.0, Vector3(0.9, 0.5, 0.0))
	library.add_animation("wave", wave)
	player.add_animation_library("", library)
	return scene
