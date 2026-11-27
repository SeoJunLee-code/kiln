extends Node2D
## The game: level flow, arrow key input, the clock and the drawing.

const Levels: GDScript = preload("res://src/levels.gd")
const LevelState: GDScript = preload("res://src/level_state.gd")

const TICK_SECONDS: float = 0.16
const CELL: int = 48
const HEADER: int = 48
const KEY_DIRECTIONS: Dictionary[Key, Vector2i] = {
	KEY_UP: Vector2i.UP,
	KEY_DOWN: Vector2i.DOWN,
	KEY_LEFT: Vector2i.LEFT,
	KEY_RIGHT: Vector2i.RIGHT,
}

## Tests switch this off and call tick() themselves.
var auto_tick: bool = true
var level_index: int = 0
var state: LevelState
var won: bool = false
## How many times a guard has sent the player back.
var times_caught: int = 0

var _held: Array[Vector2i] = []
var _tapped: Vector2i = Vector2i.ZERO
var _elapsed: float = 0.0

@onready var _title: Label = $LevelName
@onready var _status: Label = $Status
@onready var _message: Label = $Message


func _ready() -> void:
	start_level(0)


func start_level(index: int) -> void:
	level_index = index
	won = false
	state = LevelState.new()
	state.setup(Levels.LEVELS[index])
	_held.clear()
	_tapped = Vector2i.ZERO
	_elapsed = 0.0
	_title.text = state.level_name
	_title.show()
	_message.hide()
	_refresh()


func _unhandled_input(event: InputEvent) -> void:
	var key_event: InputEventKey = event as InputEventKey
	if key_event == null or key_event.echo:
		return
	if key_event.keycode == KEY_R and key_event.pressed and not won:
		start_level(level_index)
		return
	if not KEY_DIRECTIONS.has(key_event.keycode):
		return
	var direction: Vector2i = KEY_DIRECTIONS[key_event.keycode]
	_held.erase(direction)
	if key_event.pressed:
		_held.append(direction)
		# Remembered so that a tap shorter than one tick is not lost.
		_tapped = direction


func _notification(what: int) -> void:
	# Key releases are not delivered to an unfocused window.
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		_held.clear()


func _process(delta: float) -> void:
	if not auto_tick:
		return
	_elapsed = minf(_elapsed + delta, TICK_SECONDS * 2.0)
	if _elapsed >= TICK_SECONDS:
		_elapsed -= TICK_SECONDS
		tick()


## Advances the game by one tick using the arrow keys pressed since the last one.
func tick() -> void:
	if won:
		return
	var direction: Vector2i = _tapped
	if direction == Vector2i.ZERO and not _held.is_empty():
		direction = _held[-1]
	_tapped = Vector2i.ZERO
	match state.step(direction):
		LevelState.Result.CAUGHT:
			times_caught += 1
			start_level(mini(level_index, 1))
		LevelState.Result.EXITED:
			if level_index + 1 < Levels.LEVELS.size():
				start_level(level_index + 1)
			else:
				_show_end_screen()
		_:
			_refresh()


func _show_end_screen() -> void:
	won = true
	_title.hide()
	_status.hide()
	_message.show()
	queue_redraw()


func _refresh() -> void:
	_status.show()
	_status.text = "Gems %d/%d" % [state.gems_total - state.gems.size(), state.gems_total]
	queue_redraw()


func _draw() -> void:
	if won or state == null:
		return
	var board: Vector2 = Vector2(state.size * CELL)
	var origin: Vector2 = Vector2((get_viewport_rect().size.x - board.x) / 2.0, HEADER)
	draw_set_transform(origin)
	draw_rect(Rect2(Vector2.ZERO, board), Color("2b2d3a"))
	for cell: Vector2i in state.walls:
		draw_rect(_cell_rect(cell, 1.0), Color("6b6f85"))
	for path: Array in state.guard_paths:
		var from: Vector2i = path[0]
		var to: Vector2i = path[-1]
		draw_line(_center(from), _center(to), Color(1.0, 0.35, 0.35, 0.3), 4.0)
	var door: Rect2 = _cell_rect(state.exit_cell, 4.0)
	if state.door_open():
		draw_rect(door, Color("57d977"))
		draw_rect(door.grow(-10.0), Color("101116"))
	else:
		draw_rect(door, Color("8a5a2b"))
		draw_circle(door.get_center() + Vector2(10.0, 0.0), 4.0, Color("ffd75e"))
	for cell: Vector2i in state.gems:
		var c: Vector2 = _center(cell)
		draw_colored_polygon(PackedVector2Array([
			c + Vector2(0, -15), c + Vector2(13, 0), c + Vector2(0, 15), c + Vector2(-13, 0),
		]), Color("4fe3ff"))
	for cell: Vector2i in state.crates:
		var box: Rect2 = _cell_rect(cell, 4.0)
		draw_rect(box, Color("c8934a"))
		draw_line(box.position, box.end, Color("7a5426"), 4.0)
		draw_rect(box, Color("7a5426"), false, 4.0)
	for index: int in state.guard_paths.size():
		draw_rect(_cell_rect(state.guard_position(index), 8.0), Color("ff5959"))
	draw_circle(_center(state.player), CELL * 0.34, Color("ffe14d"))


func _cell_rect(cell: Vector2i, margin: float) -> Rect2:
	return Rect2(Vector2(cell * CELL), Vector2(CELL, CELL)).grow(-margin)


func _center(cell: Vector2i) -> Vector2:
	return _cell_rect(cell, 0.0).get_center()
