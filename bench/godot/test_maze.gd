extends GutTest

const MAZE := preload("res://maze.tscn")

var maze: Node2D
var player: CharacterBody2D
var coin_collected := false
var won := false
var touched_inner := false


func before_each() -> void:
	maze = MAZE.instantiate()
	add_child_autofree(maze)
	player = maze.get_node("Player")
	coin_collected = false
	won = false
	touched_inner = false
	maze.get_node("Coin").collected.connect(func(): coin_collected = true)
	maze.get_node("Exit").won.connect(func(): won = true)


func _hold(action: String, frames: int) -> void:
	Input.action_press(action)
	for i in frames:
		await get_tree().physics_frame
		for j in player.get_slide_collision_count():
			if player.get_slide_collision(j).get_collider().name == "Inner":
				touched_inner = true
	Input.action_release(action)


func test_reach_exit_with_coin() -> void:
	await _hold("ui_down", 60)
	assert_gt(player.position.y, 4.9 * 32.0 + 12.8, "player went down")
	await _hold("ui_right", 90)
	await _hold("ui_up", 60)
	await get_tree().physics_frame
	assert_true(coin_collected, "coin collected")
	assert_false(is_instance_valid(maze.get_node_or_null("Coin")), "coin gone")
	assert_true(won, "reached exit")
	assert_false(touched_inner, "never touched inner wall")
