# A player's state during a match (createPlayer in js/game.js).
class_name TennisPlayer
extends RefCounted


# Where the ball crossed this player's contact plane.
class Cross:
	var t := 0.0
	var x := 0.0
	var y := 0.0
	var z := 0.0
	var ball: Ball
	var px := 0.0
	var py := 0.0
	var has_px := true     # false for a predicted crossing (the player is where they are)
	var bounced := false


# A spot the CPU (or automove) plans to meet the ball at (cpuPlan).
class Cand:
	var t := 0.0
	var x := 0.0
	var y := 0.0
	var z := 0.0
	var slack := 0.0
	var q := 0.0
	var wing := "fh"


var side := 0
var fwd := 1.0
var ch: Dictionary
var x := 0.0
var y := 0.0
var tx := 0.0
var ty := 0.0
var stamina := 100.0
var cap := 100.0
var run := 0.0
var streak := 0
var swing := -1.0
var swing_wing := "fh"
var moving := false
var anim := 0.0
var prev_rel = null        # float or null
var cross: Cross = null
var pending = null         # {t, input[, err]} or null
var plan: Cand = null
var v := 0.0
var dir_x := 0.0
var dir_y := 0.0
var react_until := 0.0
var speed_f := 1.0
var at_net := false
var net_spot = null        # [x, y] or null
var pattern = null         # String or null
var shot_n := 0
var last_tx := 0.0
var seen_at_net := false
var leaving := false


func _init(side_: int, ch_: Dictionary) -> void:
	side = side_
	fwd = 1.0 if side == 0 else -1.0
	ch = ch_
	y = -fwd * ch.home
	ty = y
	anim = side * 1.7
