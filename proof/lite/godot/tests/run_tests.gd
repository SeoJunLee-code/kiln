extends SceneTree
## The whole test suite. Exits 0 only when every check passes and the engine
## reported no error and no warning.
##   godot --headless --path game --script res://tests/run_tests.gd
##
## Game scripts are loaded at run time, after the logger is installed, so that
## problems found while loading them are counted too.


class Collector extends Logger:
	var problems: PackedStringArray = []

	func _log_error(function: String, file: String, line: int, code: String, rationale: String,
			_editor_notify: bool, _error_type: int, _backtraces: Array[ScriptBacktrace]) -> void:
		problems.append("%s:%d %s: %s %s" % [file, line, function, code, rationale])


const MIN_SIZES: Array[Dictionary] = [
	{"width": 9, "height": 7, "gems": 3, "guards": 0, "crates": 0},
	{"width": 11, "height": 9, "gems": 4, "guards": 2, "crates": 0},
	{"width": 13, "height": 9, "gems": 4, "guards": 2, "crates": 2},
]
const KEYS: Dictionary[String, Key] = {"U": KEY_UP, "D": KEY_DOWN, "L": KEY_LEFT, "R": KEY_RIGHT}
## The one gem of level 3 that lies behind a crate.
const CRATE_GEM: Vector2i = Vector2i(11, 1)

var _collector: Collector = Collector.new()
var _levels: Array
var _state_script: GDScript
var _recordings: GDScript
var _scene: PackedScene
var _checks: int = 0
var _failures: int = 0
var _started: bool = false


func _initialize() -> void:
	OS.add_logger(_collector)


func _process(_delta: float) -> bool:
	if _started:
		# Only reached when a script error aborted the run below.
		printerr("FAIL: the test run was aborted")
		quit(1)
		return true
	_started = true
	_run()
	return false


func _run() -> void:
	var levels_script: GDScript = load("res://src/levels.gd")
	_levels = levels_script.get_script_constant_map()["LEVELS"]
	_state_script = load("res://src/level_state.gd")
	_recordings = load("res://tests/recordings.gd")
	_scene = load("res://main.tscn")

	_test_sizes()
	_test_a_winnable()
	_test_b_door_holds()
	_test_c_guards_bite()
	_test_d_crate_matters()
	_test_timing_required()
	_test_rules_and_controls()
	_test_e_lite_and_clean()
	_test_f_one_folder()

	for problem: String in _collector.problems:
		printerr("ENGINE: ", problem)
	_check(_collector.problems.is_empty(), "the engine reported no error or warning during the run")
	print("%d checks, %d failed" % [_checks, _failures])
	quit(0 if _failures == 0 and _checks > 0 else 1)


# --- helpers -----------------------------------------------------------------

func _check(passed: bool, what: String) -> void:
	_checks += 1
	if passed:
		print("  ok   ", what)
	else:
		_failures += 1
		printerr("  FAIL ", what)


func _new_game(level: int = 0) -> Node:
	var game: Node = _scene.instantiate()
	game.set("auto_tick", false)
	root.add_child(game)
	if level != 0:
		game.call("start_level", level)
	return game


func _key(code: Key, pressed: bool) -> void:
	var event: InputEventKey = InputEventKey.new()
	event.keycode = code
	event.pressed = pressed
	root.push_input(event)


## One tick of the real game, driven through real key events.
func _play_tick(game: Node, move: String) -> void:
	if move != ".":
		_key(KEYS[move], true)
	game.call("tick")
	if move != ".":
		_key(KEYS[move], false)


func _play(game: Node, recording: String) -> void:
	for move: String in recording:
		_play_tick(game, move)


func _wins() -> Array:
	return _recordings.get_script_constant_map()["WINS"]


func _state_of(game: Node) -> RefCounted:
	return game.get("state")


func _fresh_state(data: Dictionary) -> RefCounted:
	var state: RefCounted = _state_script.new()
	state.call("setup", data)
	return state


# --- tests -------------------------------------------------------------------

func _test_sizes() -> void:
	print("Minimum size")
	_check(_levels.size() == 3, "there are three levels")
	for index: int in _levels.size():
		var state: RefCounted = _fresh_state(_levels[index])
		var minimum: Dictionary = MIN_SIZES[index]
		var size: Vector2i = state.get("size")
		var gems: Dictionary = state.get("gems")
		var crates: Dictionary = state.get("crates")
		var guards: Array = state.get("guard_paths")
		var rows: Array = _levels[index]["map"]
		var rectangular: bool = rows.all(func(row: String) -> bool: return row.length() == size.x)
		_check(rectangular and size.x >= minimum["width"] and size.y >= minimum["height"]
				and gems.size() >= minimum["gems"] and guards.size() >= minimum["guards"]
				and crates.size() >= minimum["crates"] and "".join(rows).count("E") == 1,
				"level %d meets the minimum size and has one door" % (index + 1))
		if index == 0:
			_check(guards.is_empty(), "level 1 has no guards")


func _test_a_winnable() -> void:
	print("A. Winnable")
	for index: int in _levels.size():
		var game: Node = _new_game(index)
		var recording: String = _wins()[index]
		_play(game, recording.left(-1))
		var state: RefCounted = _state_of(game)
		var gems: Dictionary = state.get("gems")
		_check(gems.is_empty() and game.get("level_index") == index and game.get("times_caught") == 0,
				"level %d: every gem collected, not caught" % (index + 1))
		_play(game, recording.right(1))
		var left: bool = game.get("won") if index == 2 else game.get("level_index") == index + 1
		_check(left and game.get("times_caught") == 0, "level %d: exit taken" % (index + 1))
		game.free()

	var full: Node = _new_game()
	var title: Label = full.get_node("LevelName")
	var message: Label = full.get_node("Message")
	for index: int in _levels.size():
		_check(title.is_visible_in_tree() and title.text == "Level %d" % (index + 1)
				and not message.visible, "the screen shows 'Level %d'" % (index + 1))
		_play(full, _wins()[index])
	_check(full.get("won") and message.is_visible_in_tree() and message.text == "You win"
			and not title.visible, "from launch to the end screen showing 'You win'")
	full.free()


func _test_b_door_holds() -> void:
	print("B. The door holds")
	var game: Node = _new_game()
	_play(game, _recordings.get_script_constant_map()["LEVEL_1_TO_CLOSED_DOOR"])
	var state: RefCounted = _state_of(game)
	var player: Vector2i = state.get("player")
	var door: Vector2i = state.get("exit_cell")
	var gems: Dictionary = state.get("gems")
	_check(gems.size() == 1, "one gem is still missing")
	_check(player == door + Vector2i.UP, "the player stands in front of the door")
	_play(game, "DDDDD")
	_check(game.get("level_index") == 0 and state == _state_of(game)
			and state.get("player") == player, "the closed door blocks and the level is not left")
	game.free()


func _test_c_guards_bite() -> void:
	print("C. Guards bite")
	var approach: String = _recordings.get_script_constant_map()["LEVEL_2_GEM_THEN_GAP"]
	var start: RefCounted = _fresh_state(_levels[1])
	var gap: Vector2i = Vector2i(4, 4)

	# The guard walks into the player, who stands in its lane.
	var game: Node = _new_game(1)
	_play(game, approach)
	var gems: Dictionary = _state_of(game).get("gems")
	_check(gems.size() == 3 and game.get("times_caught") == 0, "a gem is held before the touch")
	_play(game, "R")
	for _i: int in 60:
		if game.get("times_caught") > 0:
			break
		_play_tick(game, ".")
	_check_restarted(game, start, "guard walks into player")
	game.free()

	# The player walks into the guard.
	game = _new_game(1)
	_play(game, approach)
	for _i: int in 60:
		if _state_of(game).call("guard_position", 0) == gap:
			break
		_play_tick(game, ".")
	_check(_state_of(game).call("guard_position", 0) == gap and game.get("times_caught") == 0,
			"the guard is next to the player")
	_play(game, "R")
	_check_restarted(game, start, "player walks into guard")
	game.free()


func _check_restarted(game: Node, start: RefCounted, how: String) -> void:
	var state: RefCounted = _state_of(game)
	_check(game.get("times_caught") == 1 and game.get("level_index") == 1
			and state.get("player") == start.get("player") and state.get("gems") == start.get("gems")
			and state.get("ticks") == 0, how + ": level 2 starts again with every gem back")


func _test_d_crate_matters() -> void:
	print("D. The crate matters")
	# Search every position reachable without moving a crate, using the real rules.
	# Guards are removed, which can only make more places reachable.
	var data: Dictionary = _levels[2].duplicate()
	data["guards"] = []
	var first: RefCounted = _fresh_state(data)
	var crates: Dictionary = first.get("crates")
	var queue: Array[RefCounted] = [first]
	var visited: Dictionary = {first.get("player"): true}
	var head: int = 0
	while head < queue.size():
		for direction: Vector2i in [Vector2i.UP, Vector2i.DOWN, Vector2i.LEFT, Vector2i.RIGHT]:
			var next: RefCounted = queue[head].call("duplicate_state")
			next.call("step", direction)
			var cell: Vector2i = next.get("player")
			if next.get("crates") == crates and not visited.has(cell):
				visited[cell] = true
				queue.append(next)
		head += 1
	var gems: Dictionary = first.get("gems")
	var unreachable: Array = gems.keys().filter(
			func(gem: Vector2i) -> bool: return not visited.has(gem))
	_check(unreachable == [CRATE_GEM],
			"without pushing, exactly the gem at %s is out of reach: %s" % [CRATE_GEM, unreachable])

	var game: Node = _new_game(2)
	var recording: String = _wins()[2]
	var pushed: bool = false
	var collected_after_push: bool = false
	for move: String in recording.left(-1):
		var state: RefCounted = _state_of(game)
		var before: Dictionary = state.get("crates").duplicate()
		_play_tick(game, move)
		pushed = pushed or state.get("crates") != before
		var left: Dictionary = state.get("gems")
		collected_after_push = collected_after_push or (pushed and not left.has(CRATE_GEM))
	_check(collected_after_push, "the winning input pushes a crate and then collects that gem")
	game.free()


func _test_timing_required() -> void:
	print("Guards cross the winning route")
	for index: int in [1, 2]:
		var game: Node = _new_game(index)
		var guard_cells: Dictionary = {}
		var paths: Array = _state_of(game).get("guard_paths")
		for path: Array in paths:
			for cell: Vector2i in path:
				guard_cells[cell] = true
		var crossed: bool = false
		var recording: String = _wins()[index]
		for move: String in recording.left(-1):
			_play_tick(game, move)
			crossed = crossed or guard_cells.has(_state_of(game).get("player"))
		_check(crossed, "level %d: the winning route crosses a guard's path" % (index + 1))
		game.free()

		game = _new_game(index)
		for move: String in recording.replace(".", ""):
			_play_tick(game, move)
			if game.get("times_caught") > 0:
				break
		_check(game.get("times_caught") == 1,
				"level %d: the same route without its pauses is caught" % (index + 1))
		game.free()


func _test_rules_and_controls() -> void:
	print("Rules and controls")
	var corridor: Dictionary = {"name": "t", "map": ["#####", "#PC.#", "#####"], "guards": []}
	var state: RefCounted = _fresh_state(corridor)
	state.call("step", Vector2i.RIGHT)
	state.call("step", Vector2i.RIGHT)
	var crates: Dictionary = state.get("crates")
	_check(state.get("player") == Vector2i(2, 1) and crates.keys() == [Vector2i(3, 1)],
			"a crate is pushed, but not into a wall")

	var game: Node = _new_game()
	_play(game, "U")
	_check(_state_of(game).get("player") == Vector2i(1, 1), "walls stop the player")

	_key(KEY_DOWN, true)
	for _i: int in 3:
		game.call("tick")
	_key(KEY_DOWN, false)
	game.call("tick")
	_check(_state_of(game).get("player") == Vector2i(1, 4), "a held key walks one cell per tick")

	_key(KEY_UP, true)
	_key(KEY_UP, false)
	game.call("tick")
	_check(_state_of(game).get("player") == Vector2i(1, 3), "a tap between two ticks still moves")

	_key(KEY_R, true)
	_key(KEY_R, false)
	_check(_state_of(game).get("player") == Vector2i(1, 1), "R restarts the level")

	game.set("auto_tick", true)
	var seconds: float = game.get_script().get_script_constant_map()["TICK_SECONDS"]
	game.call("_process", seconds)
	game.call("_process", seconds)
	_check(_state_of(game).get("ticks") == 2, "the clock advances the game without input")
	game.free()


func _test_e_lite_and_clean() -> void:
	print("E. Lite, no errors, no warnings")
	_check(ProjectSettings.get_setting("rendering/renderer/rendering_method") == "gl_compatibility",
			"Compatibility renderer")
	var game: Node = _new_game()
	_check(game.find_children("*", "Node3D", true, false).is_empty(), "2D only")
	game.free()

	# A warning level of 1 would only print; every one must be raised to an error (2).
	var lenient: PackedStringArray = []
	for property: Dictionary in ProjectSettings.get_property_list():
		var setting: String = property["name"]
		if setting.begins_with("debug/gdscript/warnings/"):
			var value: Variant = ProjectSettings.get_setting(setting)
			if typeof(value) == TYPE_INT and value == 1:
				lenient.append(setting)
	_check(lenient.is_empty(), "every enabled GDScript warning is treated as an error %s" % lenient)

	var folder: String = ProjectSettings.globalize_path("res://")
	_check_engine_run(["--path", folder, "--import"], "the project imports cleanly")
	_check_engine_run(["--path", folder, "--quit-after", "120"], "the game loads and runs cleanly")
	for file: String in _project_files("res://"):
		if file.ends_with(".gd"):
			_check_engine_run(["--path", folder, "--check-only", "--script", file], "parses cleanly: " + file)
		elif file.ends_with(".tscn"):
			_check(load(file) is PackedScene, "loads: " + file)


func _check_engine_run(arguments: PackedStringArray, what: String) -> void:
	var output: Array = []
	var all_arguments: PackedStringArray = ["--headless"]
	all_arguments.append_array(arguments)
	var code: int = OS.execute(OS.get_executable_path(), all_arguments, output, true)
	var text: String = "".join(output)
	var clean: bool = code == 0 and not text.contains("ERROR") and not text.contains("WARNING")
	_check(clean, what)
	if not clean:
		printerr(text)


func _test_f_one_folder() -> void:
	print("F. One folder")
	var reference: RegEx = RegEx.create_from_string("res://[\\w./-]+\\.\\w+")
	var missing: PackedStringArray = []
	for file: String in _project_files("res://"):
		if file.get_extension() in ["gd", "tscn", "godot"]:
			for found: RegExMatch in reference.search_all(FileAccess.get_file_as_string(file)):
				if not FileAccess.file_exists(found.get_string()):
					missing.append(found.get_string())
	_check(missing.is_empty(), "every file the game refers to is inside the folder %s" % missing)


## Every file of the project, without the engine's own cache folder.
func _project_files(folder: String) -> PackedStringArray:
	var files: PackedStringArray = []
	for name: String in DirAccess.get_files_at(folder):
		files.append(folder.path_join(name))
	for name: String in DirAccess.get_directories_at(folder):
		if not name.begins_with("."):
			files.append_array(_project_files(folder.path_join(name)))
	return files
