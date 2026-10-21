# Scoring for one set, with a first-to-7 (win by 2) tiebreak at 6-6.
# Port of js/match.js.
class_name MatchScore
extends RefCounted

var games := [0, 0]
var points := [0, 0]
var tiebreak := false
var tb_first_server := 0
var server := 0
var first_serve := true
var over := false
var winner := -1
var log: Array = []


func _init(first_server: int = 0) -> void:
	server = first_server


func points_played() -> int:
	return points[0] + points[1]


# true when the next serve is from the deuce (right-hand) court
func deuce_side() -> bool:
	return points_played() % 2 == 0


func current_server() -> int:
	if not tiebreak:
		return server
	var n := points_played()
	var block := int(floor((n + 1) / 2.0))
	return tb_first_server if block % 2 == 0 else 1 - tb_first_server


# Award a point. Returns "point" | "game" | "set".
func award_point(w: int) -> String:
	var o := 1 - w
	points[w] += 1
	first_serve = true
	if tiebreak:
		if points[w] >= 7 and points[w] - points[o] >= 2:
			games[w] += 1
			log.append(points.duplicate())
			over = true; winner = w
			return "set"
		return "point"
	if points[w] >= 4 and points[w] - points[o] >= 2:
		games[w] += 1
		points = [0, 0]
		server = 1 - server
		var gw: int = games[w]; var go: int = games[o]
		if gw >= 6 and gw - go >= 2:
			over = true; winner = w
			return "set"
		if gw == 6 and go == 6:
			tiebreak = true; tb_first_server = server
		return "game"
	return "point"


func point_label(side: int) -> String:
	if tiebreak:
		return str(points[side])
	var a: int = points[side]; var b: int = points[1 - side]
	if a >= 3 and b >= 3:
		if a == b:
			return "40"
		return "AD" if a > b else "40"
	return ["0", "15", "30", "40"][a]


func callout() -> String:
	if tiebreak:
		return "Tiebreak"
	if points[0] >= 3 and points[1] >= 3 and points[0] == points[1]:
		return "Deuce"
	return ""


func copy() -> MatchScore:
	var m := MatchScore.new(server)
	m.games = games.duplicate(); m.points = points.duplicate()
	m.tiebreak = tiebreak; m.tb_first_server = tb_first_server
	m.first_serve = first_serve; m.over = over; m.winner = winner; m.log = log.duplicate(true)
	return m
