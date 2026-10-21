# Character stats and CPU tactics, copied from js/characters.js (the
# sprite drawing there is replaced by 3D models).
class_name Characters
extends RefCounted

const ALL := {
	"octopus": {
		"id": "octopus",
		"name": "Octopus",
		"blurb": "Lives deep behind the baseline. Long tentacles, a flat backhand, and stamina for days.",
		"height": 1.98,
		"speed": 5.0,          # top running speed, m/s
		"reach": 1.9,          # lateral reach from the body
		"overheadZ": 2.45,     # balls above this are smashed
		"maxZ": 3.25,          # highest ball he can touch
		"pace": {"fh": 34.0, "bh": 35.0},       # speed caps, m/s
		"paceMin": 24.0,                         # slowest rally ball
		"spin": {"fh": 0.42, "bh": 0.34},       # spin caps
		"serve": 58.0,
		"window": {"fh": 0.075, "bh": 0.10},    # timing windows, seconds
		"drain": 0.5,          # stamina per metre run
		"capDrain": 0.03,      # hard-cap loss per metre run
		"home": 13.4,          # rally depth (distance from the net)
		"returnDepth": 14.2,
		# Steady pressure: deep, heavy, safe balls worked into your weaker wing.
		"tactics": {
			"pace": [0.6, 0.8], "safe": 0.75, "slice": 0.08, "weakWing": 0.35, "openCourt": 0.4,
			"approach": 0.0, "serveVolley": 0.0, "lob": 0.35, "fhPref": -0.05, "late": 0.05,
			"drop": 0.03, "angle": 0.08, "serveWide": 0.25, "cross": 0.85,
			"patterns": ["pressure", "pressure", "sideToSide"], "attack": 0.6, "err": 0.9,
		},
		"colors": {"main": Color("#8f5bff"), "glow": Color("#28f0d6"), "dark": Color("#2a1257"), "accent": Color("#ff3fa4")},
	},
	"philosopher": {
		"id": "philosopher",
		"name": "Philosopher",
		"blurb": "Heavy topspin forehand, one-handed backhand, and quick feet. Thinks before every point.",
		"height": 1.93,
		"speed": 5.4,
		"reach": 1.8,
		"overheadZ": 2.35,
		"maxZ": 3.1,
		"pace": {"fh": 38.0, "bh": 32.0},
		"paceMin": 19.0,
		"spin": {"fh": 0.85, "bh": 0.65},
		"serve": 56.0,
		"window": {"fh": 0.10, "bh": 0.065},
		"drain": 0.6,
		"capDrain": 0.036,
		"home": 12.7,
		"returnDepth": 13.3,
		# Aggressive and creative: big forehands, early winners, net rushing, touch.
		"tactics": {
			"pace": [0.55, 0.9], "safe": 0.85, "slice": 0.12, "weakWing": 0.3, "openCourt": 0.6,
			"approach": 0.7, "serveVolley": 0.3, "lob": 0.15, "fhPref": 0.08, "late": 0.0,
			"drop": 0.2, "angle": 0.3, "serveWide": 0.5, "cross": 0.75,
			"patterns": ["behind", "sideToSide", "pressure"], "attack": 1.4, "err": 0.8,
		},
		"colors": {"main": Color("#ece6ff"), "glow": Color("#ffc23d"), "dark": Color("#3a2f63"), "accent": Color("#3fd2ff")},
	},
}

# The menu's levels; see CT.CPU_LEVELS in js/game.js.
const LEVELS := {
	"chill": {"timeScale": 0.75, "err": 1.9, "react": 0.36, "cover": 0.1, "speed": 0.8, "pace": 0.75, "depth": 0.75, "attack": 0.0, "smart": 0.15},
	"club": {"timeScale": 0.88, "err": 1.3, "react": 0.26, "cover": 0.2, "speed": 0.9, "pace": 0.86, "depth": 0.88, "attack": 0.15, "smart": 0.55},
	"pro": {"timeScale": 1.0, "err": 0.85, "react": 0.14, "cover": 0.38, "speed": 1.0, "pace": 1.0, "depth": 1.0, "attack": 0.3, "smart": 1.0},
}


static func level_opts(level: String) -> Dictionary:
	var L: Dictionary = LEVELS[level]
	return {"timeScale": L.timeScale, "cpuErr": L.err, "cpuReact": L.react, "cpuCover": L.cover, "cpuSpeed": L.speed,
		"cpuPace": L.pace, "cpuDepth": L.depth, "cpuAttack": L.attack, "cpuSmart": L.smart}
