from backend.app.services.atelier.scene_spec import build_rule_scene, normalize_scene_spec


def test_rule_scene_luoyang():
    spec = build_rule_scene("洛阳龙门石窟，黄昏，伊水与崖壁大佛", seed=7)
    assert spec.place == "洛阳"
    assert spec.landmark == "龙门石窟"
    assert spec.landmark_type == "cliff_buddha"
    assert spec.time == "dusk"
    assert spec.seed == 7
    assert len(spec.sources) == 0


def test_rule_scene_suzhou_water_town():
    spec = build_rule_scene("苏州水乡，春雨，白墙黛瓦与拱桥", seed=8)
    assert spec.place == "苏州"
    assert spec.landmark_type == "water_town"
    assert spec.weather == "rain"
    assert spec.season == "spring"


def test_rule_scene_xian_gate():
    spec = build_rule_scene("西安城墙，夜色，灯火与飞檐", seed=9)
    assert spec.place == "西安"
    assert spec.landmark_type == "palace_gate"
    assert spec.time == "night"
    assert spec.mood == "bustling"


def test_normalize_unknown_values_falls_back():
    spec = normalize_scene_spec(
        {"title": "远方", "place": "远方", "landmark_type": "unknown", "time": "noon", "props": ["dragon"]},
        prompt="远方",
        seed=1,
        sources=[],
    )
    assert spec.landmark_type == "cliff_buddha"
    assert spec.time == "dusk"
    assert spec.props == []
    assert spec.mood == "serene"
    assert spec.accent_role == "stone"
