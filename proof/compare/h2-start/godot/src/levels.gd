extends RefCounted
## Level data.
## Map legend: '#' wall, '.' floor, 'P' player start, 'G' gem, 'E' exit door, 'C' crate.
## A guard is [from, to]: it starts on `from` and walks to `to` and back forever.

const LEVELS: Array[Dictionary] = [
	{
		"name": "Level 1",
		"map": [
			"#########",
			"#P..#..G#",
			"#.#.#.#.#",
			"#.#G..#.#",
			"#.###.#.#",
			"#G....#E#",
			"#########",
		],
		"guards": [],
	},
	{
		"name": "Level 2",
		"map": [
			"###########",
			"#P.#.G.#.G#",
			"#..#...#..#",
			"#..#...#..#",
			"#.........#",
			"#..#...#..#",
			"#..#...#..#",
			"#G.#.E.#.G#",
			"###########",
		],
		"guards": [
			[Vector2i(4, 1), Vector2i(4, 1)],
			[Vector2i(6, 7), Vector2i(6, 1)],
		],
	},
	{
		"name": "Level 3",
		"map": [
			"#############",
			"#P.#...G.#.G#",
			"#..#.....#..#",
			"#..C.....C..#",
			"#..#.....#..#",
			"#G.#.....#..#",
			"#........#..#",
			"#..#G....#.E#",
			"#############",
		],
		"guards": [
			[Vector2i(6, 7), Vector2i(6, 1)],
			[Vector2i(8, 1), Vector2i(8, 7)],
		],
	},
]
