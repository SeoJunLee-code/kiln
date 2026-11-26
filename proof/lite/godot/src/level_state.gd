extends RefCounted
## The rules of one level, advanced in fixed ticks. No nodes, no drawing, no clock,
## so the same input always gives the same result.

enum Result { NONE, CAUGHT, EXITED }

## A guard moves one cell every this many ticks; the player may move every tick.
const GUARD_PERIOD: int = 2

var level_name: String = ""
var size: Vector2i = Vector2i.ZERO
var walls: Dictionary[Vector2i, bool] = {}
var gems: Dictionary[Vector2i, bool] = {}
var crates: Dictionary[Vector2i, bool] = {}
## Each entry is the list of cells of one guard's straight path.
var guard_paths: Array[Array] = []
var player: Vector2i = Vector2i.ZERO
var exit_cell: Vector2i = Vector2i.ZERO
var gems_total: int = 0
var ticks: int = 0


func setup(data: Dictionary) -> void:
	level_name = data["name"]
	var rows: Array = data["map"]
	var first_row: String = rows[0]
	size = Vector2i(first_row.length(), rows.size())
	walls.clear()
	gems.clear()
	crates.clear()
	guard_paths.clear()
	ticks = 0
	for y: int in size.y:
		var row: String = rows[y]
		for x: int in size.x:
			var cell: Vector2i = Vector2i(x, y)
			match row[x]:
				"#":
					walls[cell] = true
				"P":
					player = cell
				"G":
					gems[cell] = true
				"C":
					crates[cell] = true
				"E":
					exit_cell = cell
	gems_total = gems.size()
	var guards: Array = data["guards"]
	for guard: Array in guards:
		var from: Vector2i = guard[0]
		var to: Vector2i = guard[1]
		var step_dir: Vector2i = (to - from).sign()
		var path: Array[Vector2i] = [from]
		while path[-1] != to:
			path.append(path[-1] + step_dir)
		guard_paths.append(path)


func duplicate_state() -> RefCounted:
	var script: GDScript = get_script()
	var copy: RefCounted = script.new()
	copy.set("level_name", level_name)
	copy.set("size", size)
	copy.set("walls", walls)
	copy.set("gems", gems.duplicate())
	copy.set("crates", crates.duplicate())
	copy.set("guard_paths", guard_paths.duplicate())
	copy.set("player", player)
	copy.set("exit_cell", exit_cell)
	copy.set("gems_total", gems_total)
	copy.set("ticks", ticks)
	return copy


func door_open() -> bool:
	return gems.is_empty()


func guard_position(index: int) -> Vector2i:
	var path: Array = guard_paths[index]
	var last: int = path.size() - 1
	if last == 0:
		return path[0]
	@warning_ignore("integer_division")
	var phase: int = (ticks / GUARD_PERIOD) % (last * 2)
	return path[phase if phase <= last else last * 2 - phase]


## Number of ticks after which every guard is back where it started.
func guard_cycle() -> int:
	var cycle: int = 1
	for path: Array in guard_paths:
		var own: int = maxi(1, (path.size() - 1) * 2)
		var a: int = cycle
		var b: int = own
		while b != 0:
			var rest: int = a % b
			a = b
			b = rest
		@warning_ignore("integer_division")
		cycle = cycle / a * own
	return cycle * GUARD_PERIOD


## One tick: the player moves (or stands still), then the guards move.
## `direction` is Vector2i.ZERO or one of the four unit vectors.
func step(direction: Vector2i) -> Result:
	if direction != Vector2i.ZERO:
		_move_player(direction)
		if player == exit_cell:
			return Result.EXITED
		if _touches_guard():
			return Result.CAUGHT
	ticks += 1
	if _touches_guard():
		return Result.CAUGHT
	return Result.NONE


func _move_player(direction: Vector2i) -> void:
	var target: Vector2i = player + direction
	if walls.has(target):
		return
	if target == exit_cell and not door_open():
		return
	if crates.has(target):
		var beyond: Vector2i = target + direction
		if not _crate_may_enter(beyond):
			return
		crates.erase(target)
		crates[beyond] = true
	player = target
	gems.erase(player)


## Crates stop at walls, crates, gems, the door and guard lanes.
func _crate_may_enter(cell: Vector2i) -> bool:
	if walls.has(cell) or crates.has(cell) or gems.has(cell) or cell == exit_cell:
		return false
	for path: Array in guard_paths:
		if path.has(cell):
			return false
	return true


func _touches_guard() -> bool:
	for index: int in guard_paths.size():
		if guard_position(index) == player:
			return true
	return false
