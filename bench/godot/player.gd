extends CharacterBody2D

@export var speed := 128.0


func _physics_process(_delta: float) -> void:
	var dir := Vector2(
		Input.get_axis("ui_left", "ui_right"),
		Input.get_axis("ui_up", "ui_down"),
	)
	velocity = dir * speed
	move_and_slide()
