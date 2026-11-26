extends SceneTree
## Developer tool: prints a shortest winning input for every level, and the project's
## GDScript warning settings. Paste the inputs into tests/recordings.gd after editing a level.
##   godot --headless --path game --script res://tools/solve.gd

const Levels: GDScript = preload("res://src/levels.gd")
const LevelState: GDScript = preload("res://src/level_state.gd")

## Waiting comes first, so a pause is written as "." and not as a walk into a wall.
const MOVES: Dictionary[String, Vector2i] = {
	".": Vector2i.ZERO,
	"U": Vector2i.UP,
	"D": Vector2i.DOWN,
	"L": Vector2i.LEFT,
	"R": Vector2i.RIGHT,
}


func _initialize() -> void:
	for index: int in Levels.LEVELS.size():
		print("LEVEL %d: %s" % [index + 1, _solve(Levels.LEVELS[index])])
	for property: Dictionary in ProjectSettings.get_property_list():
		var key: String = property["name"]
		if key.begins_with("debug/gdscript/warnings/"):
			print("%s=%s" % [key, ProjectSettings.get_setting(key)])
	quit()


func _solve(data: Dictionary) -> String:
	var start: LevelState = LevelState.new()
	start.setup(data)
	var cycle: int = start.guard_cycle()
	var queue: Array[LevelState] = [start]
	var inputs: PackedStringArray = [""]
	var seen: Dictionary[Array, bool] = {}
	var head: int = 0
	while head < queue.size():
		var state: LevelState = queue[head]
		for move: String in MOVES:
			var next: LevelState = state.duplicate_state()
			var result: LevelState.Result = next.step(MOVES[move])
			if result == LevelState.Result.EXITED:
				return inputs[head] + move
			if result == LevelState.Result.CAUGHT:
				continue
			var key: Array = [next.player, next.gems.keys(), _sorted(next.crates.keys()), next.ticks % cycle]
			if not seen.has(key):
				seen[key] = true
				queue.append(next)
				inputs.append(inputs[head] + move)
		queue[head] = null
		head += 1
	return "NO SOLUTION"


func _sorted(cells: Array) -> Array:
	cells.sort()
	return cells
