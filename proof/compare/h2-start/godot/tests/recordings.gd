extends RefCounted
## Recorded inputs, one character per game tick:
## U D L R = that arrow key is pressed during the tick, . = no key.

## Each wins its level from a fresh start.
const WINS: Array[String] = [
	"DDDDUUUURRDDRRUURRDDDD",
	".DDDDDDUUURRRUUURDDDRRRUUURDDDDDDUUULLLDDDL",
	"..DDDDDRRRDUUUUUURRRDDRRRUURDDDDLDDR",
]

## Level 1: takes two of the three gems, goes to the door and keeps pushing at it.
const LEVEL_1_TO_CLOSED_DOOR: String = "RRDDRRUURRDDDDDD"

## Level 2: takes the gem below the start, goes to the gap in the first guard's lane
## and stands in the lane's way.
const LEVEL_2_GEM_THEN_GAP: String = "DDDDDDUUURR"
