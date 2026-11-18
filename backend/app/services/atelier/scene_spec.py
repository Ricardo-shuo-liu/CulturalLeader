from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

LandmarkType = Literal[
    "cliff_buddha",
    "pagoda",
    "palace_gate",
    "water_town",
    "mountain_temple",
    "skyline",
]
EnvironmentType = Literal["river_valley", "lake", "canal", "plain", "coast", "urban"]
TimeOfDay = Literal["dawn", "day", "dusk", "night"]
Weather = Literal["clear", "mist", "rain", "snow"]
Season = Literal["spring", "summer", "autumn", "winter"]
Mood = Literal["serene", "majestic", "lonely", "bustling", "dreamy"]
AccentRole = Literal["seal", "gold", "jade", "stone", "ochre"]
Prop = Literal["caves", "pines", "willows", "birds", "boat", "lanterns", "petals", "snow"]

LANDMARK_TYPES = set(LandmarkType.__args__)
ENVIRONMENTS = set(EnvironmentType.__args__)
TIMES = set(TimeOfDay.__args__)
WEATHERS = set(Weather.__args__)
SEASONS = set(Season.__args__)
MOODS = set(Mood.__args__)
ACCENTS = set(AccentRole.__args__)
PROPS = set(Prop.__args__)


class Composition(BaseModel):
    model_config = ConfigDict(extra="ignore")

    horizon: float = Field(default=0.54, ge=0.0, le=1.0)
    landmark_x: float = Field(default=0.62, ge=0.0, le=1.0)
    landmark_scale: float = Field(default=1.0, ge=0.3, le=2.0)
    zoom: float = Field(default=1.0, ge=0.5, le=2.0)


class SourceRef(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str
    url: str
    publisher: str = ""
    license: str = ""


class SceneSpec(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str
    subtitle: str = ""
    place: str = "远方"
    landmark: str = ""
    landmark_type: LandmarkType = "cliff_buddha"
    environment: EnvironmentType = "river_valley"
    time: TimeOfDay = "dusk"
    weather: Weather = "clear"
    season: Season = "autumn"
    palette: Literal["InkGongbi48"] = "InkGongbi48"
    mood: Mood = "serene"
    accent_role: AccentRole = "stone"
    composition: Composition = Field(default_factory=Composition)
    props: list[Prop] = Field(default_factory=list)
    caption: str = ""
    seed: int = 0
    created_at: str = ""
    prompt: str = ""
    sources: list[SourceRef] = Field(default_factory=list)


# 关键词 → 地点/地标/场景原型。首版覆盖示例与常见文旅地名。
RULE_PLACES: list[dict] = [
    {
        "keywords": ("洛阳", "龙门"),
        "place": "洛阳",
        "landmark": "龙门石窟",
        "landmark_type": "cliff_buddha",
        "environment": "river_valley",
        "props": ("caves", "pines", "birds"),
    },
    {
        "keywords": ("苏州", "园林", "水乡"),
        "place": "苏州",
        "landmark": "水乡园林",
        "landmark_type": "water_town",
        "environment": "canal",
        "props": ("willows", "boat", "lanterns"),
    },
    {
        "keywords": ("西安", "长安", "城墙"),
        "place": "西安",
        "landmark": "古城墙",
        "landmark_type": "palace_gate",
        "environment": "plain",
        "props": ("lanterns", "willows"),
    },
    {
        "keywords": ("上海", "外滩", "陆家嘴"),
        "place": "上海",
        "landmark": "外滩天际线",
        "landmark_type": "skyline",
        "environment": "urban",
        "props": ("boat", "lanterns", "birds"),
    },
    {
        "keywords": ("杭州", "西湖"),
        "place": "杭州",
        "landmark": "西湖",
        "landmark_type": "water_town",
        "environment": "lake",
        "props": ("willows", "boat", "petals"),
    },
    {
        "keywords": ("敦煌", "莫高窟", "鸣沙山"),
        "place": "敦煌",
        "landmark": "鸣沙山",
        "landmark_type": "cliff_buddha",
        "environment": "plain",
        "props": ("caves", "pines"),
    },
    {
        "keywords": ("五台山", "寺庙", "山寺"),
        "place": "五台山",
        "landmark": "山寺",
        "landmark_type": "mountain_temple",
        "environment": "river_valley",
        "props": ("pines", "birds"),
    },
    {
        "keywords": ("北京", "故宫", "天坛"),
        "place": "北京",
        "landmark": "宫城",
        "landmark_type": "palace_gate",
        "environment": "urban",
        "props": ("lanterns", "birds"),
    },
    {
        "keywords": ("成都", "锦里", "熊猫"),
        "place": "成都",
        "landmark": "锦里",
        "landmark_type": "water_town",
        "environment": "river_valley",
        "props": ("willows", "lanterns"),
    },
    {
        "keywords": ("桂林", "漓江", "山水"),
        "place": "桂林",
        "landmark": "漓江山水",
        "landmark_type": "mountain_temple",
        "environment": "river_valley",
        "props": ("pines", "boat", "birds"),
    },
]

TIME_WORDS = [
    (("清晨", "黎明", "日出", "早晨"), "dawn"),
    (("中午", "白天", "正午"), "day"),
    (("黄昏", "日落", "傍晚", "夕阳"), "dusk"),
    (("夜", "星", "月", "灯"), "night"),
]
WEATHER_WORDS = [
    (("雨",), "rain"),
    (("雪",), "snow"),
    (("雾", "烟", "云海"), "mist"),
]
SEASON_WORDS = [
    (("春", "花"), "spring"),
    (("夏",), "summer"),
    (("秋", "银杏", "红叶"), "autumn"),
    (("冬", "雪"), "winter"),
]
MOOD_WORDS = [
    (("壮", "宏", "磅礴"), "majestic"),
    (("孤", "寂", "空"), "lonely"),
    (("热闹", "繁华", "灯", "烟火"), "bustling"),
    (("梦幻", "仙境", "梦"), "dreamy"),
]
ACCENT_WORDS = [
    (("朱砂", "红"), "seal"),
    (("金", "夕阳", "暖"), "gold"),
    (("青", "玉", "翠"), "jade"),
    (("赭", "土", "岩"), "ochre"),
]

TIME_LABELS = {"dawn": "清晨", "day": "正午", "dusk": "黄昏", "night": "夜色"}
WEATHER_LABELS = {"clear": "晴朗", "mist": "薄雾", "rain": "细雨", "snow": "落雪"}
SEASON_LABELS = {"spring": "春日", "summer": "夏日", "autumn": "秋日", "winter": "冬日"}


def _match_words(text: str, table: list[tuple[tuple[str, ...], str]], default: str) -> str:
    for words, value in table:
        if any(word in text for word in words):
            return value
    return default


def _match_place(text: str) -> dict | None:
    for entry in RULE_PLACES:
        if any(word in text for word in entry["keywords"]):
            return entry
    return None


def build_rule_scene(
    prompt: str,
    *,
    seed: int,
    sources: list[SourceRef] | None = None,
) -> SceneSpec:
    text = (prompt or "").strip()
    matched = _match_place(text)
    if matched is not None:
        place = str(matched["place"])
        landmark = str(matched["landmark"])
        landmark_type = str(matched["landmark_type"])
        environment = str(matched["environment"])
        props = list(matched["props"])
    elif any(word in text for word in ("水乡", "园林", "桥")):
        place, landmark = "江南", "水乡"
        landmark_type, environment, props = "water_town", "canal", ("willows", "boat", "lanterns")
    elif any(word in text for word in ("城墙", "城门", "宫殿")):
        place, landmark = "古城", "城门"
        landmark_type, environment, props = "palace_gate", "plain", ("lanterns",)
    elif any(word in text for word in ("塔", "寺")):
        place, landmark = "远方", "山寺"
        landmark_type, environment, props = "mountain_temple", "river_valley", ("pines",)
    else:
        place, landmark = "远方", "山水"
        landmark_type, environment, props = "cliff_buddha", "river_valley", ("pines",)

    time_value = _match_words(text, TIME_WORDS, "dusk")
    weather = _match_words(text, WEATHER_WORDS, "clear")
    season = _match_words(text, SEASON_WORDS, "autumn")
    mood = _match_words(text, MOOD_WORDS, "serene")
    accent = _match_words(text, ACCENT_WORDS, "stone")
    subtitle = f"{TIME_LABELS[time_value]} · {WEATHER_LABELS[weather]} · {SEASON_LABELS[season]}"
    title = f"{place} · {landmark}" if landmark and landmark != place else place
    caption = f"{place}的{landmark}，{TIME_LABELS[time_value]}里像一页可以走进去的画。"
    return SceneSpec(
        title=title,
        subtitle=subtitle,
        place=place,
        landmark=landmark,
        landmark_type=landmark_type,
        environment=environment,
        time=time_value,
        weather=weather,
        season=season,
        mood=mood,
        accent_role=accent,
        props=props,
        caption=caption,
        seed=seed,
        created_at=datetime.now(timezone.utc).isoformat(),
        prompt=prompt,
        sources=sources or [],
    )


def _allowed(value, allowed: set[str], default: str) -> str:
    return value if isinstance(value, str) and value in allowed else default


def _clamp(value, low: float, high: float, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def normalize_scene_spec(
    raw: dict,
    *,
    prompt: str,
    seed: int,
    sources: list[SourceRef],
) -> SceneSpec:
    if not isinstance(raw, dict):
        raw = {}
    raw_composition = raw.get("composition")
    if not isinstance(raw_composition, dict):
        raw_composition = {}
    composition = {
        "horizon": _clamp(raw_composition.get("horizon"), 0.0, 1.0, 0.54),
        "landmark_x": _clamp(raw_composition.get("landmark_x"), 0.0, 1.0, 0.62),
        "landmark_scale": _clamp(raw_composition.get("landmark_scale"), 0.3, 2.0, 1.0),
        "zoom": _clamp(raw_composition.get("zoom"), 0.5, 2.0, 1.0),
    }
    raw_props = raw.get("props")
    props = []
    if isinstance(raw_props, list):
        for value in raw_props:
            if isinstance(value, str) and value in PROPS and value not in props:
                props.append(value)
    place = str(raw.get("place") or "远方").strip() or "远方"
    landmark = str(raw.get("landmark") or "").strip()
    title = str(raw.get("title") or "").strip()
    if not title:
        title = f"{place} · {landmark}" if landmark and landmark != place else place
    landmark_type = _allowed(raw.get("landmark_type"), LANDMARK_TYPES, "cliff_buddha")
    time_value = _allowed(raw.get("time"), TIMES, "dusk")
    weather = _allowed(raw.get("weather"), WEATHERS, "clear")
    season = _allowed(raw.get("season"), SEASONS, "autumn")
    subtitle = str(raw.get("subtitle") or "").strip()
    if not subtitle:
        subtitle = f"{TIME_LABELS[time_value]} · {WEATHER_LABELS[weather]} · {SEASON_LABELS[season]}"
    return SceneSpec(
        title=title,
        subtitle=subtitle,
        place=place,
        landmark=landmark,
        landmark_type=landmark_type,
        environment=_allowed(raw.get("environment"), ENVIRONMENTS, "river_valley"),
        time=time_value,
        weather=weather,
        season=season,
        palette="InkGongbi48",
        mood=_allowed(raw.get("mood"), MOODS, "serene"),
        accent_role=_allowed(raw.get("accent_role"), ACCENTS, "stone"),
        composition=composition,
        props=props,
        caption=str(raw.get("caption") or "").strip(),
        seed=seed,
        created_at=str(raw.get("created_at") or datetime.now(timezone.utc).isoformat()),
        prompt=prompt,
        sources=sources,
    )
