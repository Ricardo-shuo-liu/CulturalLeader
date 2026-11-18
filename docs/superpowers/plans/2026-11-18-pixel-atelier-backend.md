# 像素造境后端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `/api/atelier/stream`：一句话 → 联网检索 → 加载像素 Skill → 生成受控 SceneSpec → Pillow 绘制像素场景 → 校验 → 导出 PNG / 明信片 / zip，并通过 SSE 返回真实进度。

**Architecture:** 新包 `backend/app/services/atelier/` 负责协议、色板、搜索、agent、渲染与存储；`backend/app/routers/atelier.py` 只负责 HTTP/SSE 与文件白名单。渲染是确定性 Pillow 绘制，CPU 任务放线程池；LLM 与搜索失败都有规则降级。

**Tech Stack:** FastAPI、Pydantic v2、Pillow、httpx、openai AsyncOpenAI、zipfile。

**Spec:** `docs/superpowers/specs/2026-11-18-pixel-atelier-design.md`

## Global Constraints

- 色板必须是 InkGongbi48，共 48 色，逐字复制 `projects/LongmenDetail_64x64_20261118/spec_lock.md` 的 colors；不得新增或插值颜色。
- 场景逻辑画布 960×540；导出最近邻 2× 为 1920×1080；明信片 2112×1432，内嵌 2× 场景。
- 场景图 alpha 只能是 0 或 255；禁止抗锯齿、渐变、亚像素；明信片不受色板/alpha 校验。
- 一句话提示词最多 200 字；生成一次只产出一个 job。
- 搜索使用中文维基百科 + Wikimedia Commons，超时 4 秒；失败不阻塞生成。
- Job 文件只落在 `data/atelier/<32位hex>/`；允许的文件名仅 `scene.png`、`scene@2x.png`、`postcard.png`、`scene.json`、`scene.zip`；保留最近 50 个 job。
- 不接外部付费图像生成 API；不执行 LLM 生成的代码；不 shell 调用。
- 不自动 commit；只有用户明确要求时才提交。测试与实现留在工作区。
- UI 文案与生成内容使用中文；报告与注释可用中英混合，但面向用户的错误必须是可读中文。

## Review Focus

1. **无地点/未知地标/空提示词之后**：必须仍返回一个可渲染的默认 SceneSpec，而不是 500 或空白图。测试放在 Task 2 与 Task 10。
2. **LLM 返回非法 JSON 或枚举外值**：必须归一化/回退到合法值，且最终场景仍通过色板与 alpha 校验。测试放在 Task 10。
3. **搜索超时或被网络阻断**：生成继续，`sources=[]`，事件标注「站内资料」；不得把异常抛给前端。测试放在 Task 9。
4. **渲染线程异常/进度事件竞争**：SSE 必须发出可读 error，且不留下半成品 job；progress 事件按层推进。测试放在 Task 11。
5. **文件下载路径穿越/非白名单文件名**：一律 404，不暴露目录。测试放在 Task 12。

---

## File Structure

```
backend/app/services/atelier/
  __init__.py
  scene_spec.py          SceneSpec / enums / 规则解析 / 归一化
  palette.py             色板、量化、场景图校验
  skill_loader.py        读取打包的 Skill 契约
  skill_bundle/          SKILL.md / executor-pixel.md / palettes / style.json
  search.py              维基 + Commons 搜索与缓存
  agent.py               LLM 场景 JSON + 规则降级
  renderer.py            draw_scene / to_2x / make_postcard
  storage.py             job 目录、zip、清理
  pipeline.py            SSE 事件流水线
  draw/
    __init__.py
    noise.py             value noise / Bayer / 绘制小工具
    sky.py               天空、日/月、云
    terrain.py           远山/崖壁/平原轮廓
    water.py             河/湖/运河/海岸
    landmarks.py         6 类地标
    props.py             树、船、灯笼、鸟、前景
    weather.py           雾/雨/雪/花瓣、暗角
backend/app/routers/atelier.py
backend/tests/test_atelier_skill.py
backend/tests/test_atelier_spec.py
backend/tests/test_atelier_palette.py
backend/tests/test_atelier_draw.py
backend/tests/test_atelier_renderer.py
backend/tests/test_atelier_search.py
backend/tests/test_atelier_agent.py
backend/tests/test_atelier_pipeline.py
backend/tests/test_atelier_api.py
tools/sync_atelier_skill.py
```

---

### Task 1: Skill bundle、配置与依赖

**Files:**
- Create: `backend/app/services/atelier/__init__.py`
- Create: `backend/app/services/atelier/skill_bundle/SKILL.md`（从 `.claude/skills/pixel-asset-master/SKILL.md` 复制）
- Create: `backend/app/services/atelier/skill_bundle/references/executor-pixel.md`（复制）
- Create: `backend/app/services/atelier/skill_bundle/palettes/ink_gongbi48.json`
- Create: `backend/app/services/atelier/skill_bundle/style.json`
- Create: `backend/app/services/atelier/skill_loader.py`
- Create: `tools/sync_atelier_skill.py`
- Modify: `backend/app/config.py`（在 `rag_dir` 后加 `atelier_dir`、`atelier_max_jobs`、`atelier_search_timeout`）
- Modify: `requirements.txt`（加 `Pillow==11.1.0`）
- Modify: `.gitignore`（加 `data/atelier/`）
- Modify: `Dockerfile`（runtime 阶段 apt 安装 `fonts-noto-cjk`）
- Test: `backend/tests/test_atelier_skill.py`

**Interfaces:**
- Produces: `StyleContract`（frozen dataclass，字段 `name: str`、`canvas: tuple[int,int]`、`base_size: int`、`palette: list[str]`、`sub_style: str`、`shading: str`、`dithering: str`、`light_direction: str`、`rules: tuple[str,...]`、`skill_md: str`）
- Produces: `load_style_contract() -> StyleContract`

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_atelier_skill.py
from backend.app.services.atelier.skill_loader import load_style_contract


def test_style_contract_has_ink_gongbi48():
    contract = load_style_contract()
    assert contract.name == "InkGongbi48"
    assert len(contract.palette) == 48
    assert len(set(contract.palette)) == 48
    assert contract.canvas == (960, 540)
    assert contract.base_size == 64
    assert contract.light_direction == "top-left"
    assert "Pixel Asset Master" in contract.skill_md


def test_style_contract_palette_matches_spec_lock():
    contract = load_style_contract()
    assert contract.palette[:4] == ["#0e0f12", "#1a1c20", "#26282b", "#33322f"]
    assert contract.palette[-3:] == ["#b5503f", "#8f3a30", "#7a5436"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_skill.py -v`  
Expected: FAIL，`ModuleNotFoundError: backend.app.services.atelier...`

- [ ] **Step 3: 实现 bundle 与 loader**

- 复制 `SKILL.md` 与 `references/executor-pixel.md` 到 bundle（保留原文）。
- `palettes/ink_gongbi48.json` 结构：

```json
{
  "name": "InkGongbi48",
  "colors": ["#0e0f12", "... 共 48 个，逐字来自 spec_lock.md ..."]
}
```

- `style.json`：

```json
{
  "name": "InkGongbi48",
  "canvas": [960, 540],
  "base_size": 64,
  "sub_style": "Dense Detail + 选择性描边",
  "shading": "3-tone",
  "dithering": "selective",
  "light_direction": "top-left",
  "rules": [
    "alpha only 0 or 255",
    "no anti-aliasing, gradients, or subpixels",
    "2x2 to 3x3 intentional pixel clusters",
    "light from top-left"
  ]
}
```

- `skill_loader.py` 读取 `skill_bundle/SKILL.md` 原文，用 `json.loads` 读两个 JSON，组合成 `StyleContract`（`skill_md` 存原文）；用 `functools.lru_cache(maxsize=1)` 缓存。
- `tools/sync_atelier_skill.py`：从 `.claude/skills/pixel-asset-master/` 复制 `SKILL.md`、`references/executor-pixel.md`；从 `projects/LongmenDetail_64x64_20261118/spec_lock.md` 解析 `colors:` 列表写 `palettes/ink_gongbi48.json`；写 `style.json`。支持 `--check`：只比较，不写入，不一致时退出 1。
- `config.py` 新增：

```python
atelier_dir: str = str(DATA_DIR / "atelier")
atelier_max_jobs: int = 50
atelier_search_timeout: float = 4.0
```

- `requirements.txt` 加 `Pillow==11.1.0`；`.gitignore` 加 `data/atelier/`。
- `Dockerfile` runtime 阶段 `apt-get install -y --no-install-recommends tzdata fonts-noto-cjk`，让明信片题签在容器里也能渲染中文。

- [ ] **Step 4: 运行测试确认通过**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_skill.py -v`  
Expected: 2 passed

---

### Task 2: SceneSpec 与规则解析

**Files:**
- Create: `backend/app/services/atelier/scene_spec.py`
- Test: `backend/tests/test_atelier_spec.py`

**Interfaces:**
- Produces: `SceneSpec`、`Composition`、`SourceRef`、枚举 Literal 类型。
- Produces: `build_rule_scene(prompt: str, *, seed: int, sources: list[SourceRef] | None = None) -> SceneSpec`
- Produces: `normalize_scene_spec(raw: dict, *, prompt: str, seed: int, sources: list[SourceRef]) -> SceneSpec`

- [ ] **Step 1: 写失败测试**

```python
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_spec.py -v`  
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现模型与规则**

- 枚举与字段严格按设计稿 §7.3；`Composition` 用 `Field(ge=0, le=1)` 约束 `horizon`/`landmark_x`，`landmark_scale` 0.3–2.0，`zoom` 0.5–2.0。
- `build_rule_scene`：
  - `RULE_LANDMARKS` 至少包含：洛阳龙门石窟→`cliff_buddha/river_valley`，苏州水乡/园林→`water_town/canal`，西安城墙→`palace_gate/plain`，上海外滩/天际线→`skyline/urban`，杭州西湖→`water_town/lake`，敦煌鸣沙山/莫高窟→`cliff_buddha/plain`，五台山/寺庙→`mountain_temple/river_valley`。
  - 时间关键词：清晨/黎明/日出→dawn；中午/白天→day；黄昏/日落/傍晚→dusk；夜/星/月→night；默认 dusk。
  - 天气：雨→rain；雪→snow；雾/烟→mist；默认 clear。
  - 季节：春→spring；夏→summer；秋→autumn；冬→winter；默认 autumn。
  - 情绪：壮/宏→majestic；孤/寂→lonely；热闹/繁华/灯→bustling；梦幻/仙境→dreamy；默认 serene。
  - 强调色：朱砂/红→seal；金/夕阳→gold；青/玉→jade；赭→ochre；默认 stone。
  - `title=f"{place} · {landmark}"`，`subtitle` 由时间/天气拼成；`caption` 用一句通用描述；`seed`、`prompt`、`created_at`（`datetime.now(timezone.utc).isoformat()`）、`sources` 由调用方/函数填。
- `normalize_scene_spec`：先对 `landmark_type`、`environment`、`time`、`weather`、`season`、`mood`、`accent_role` 做白名单过滤，未知值用默认；`props` 过滤未知值；`Composition` 超界裁剪；再用 `SceneSpec.model_validate`；模型校验失败抛 `ValueError`（由 agent 捕获回退）。

- [ ] **Step 4: 运行测试确认通过**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_spec.py -v`  
Expected: 4 passed

---

### Task 3: 色板加载、量化与场景图校验

**Files:**
- Create: `backend/app/services/atelier/palette.py`
- Test: `backend/tests/test_atelier_palette.py`

**Interfaces:**
- Produces: `load_palette() -> list[str]`
- Produces: `validate_scene_image(img: Image.Image, *, palette: list[str] | None = None) -> ValidationResult`
- Produces: `quantize_to_palette(img: Image.Image, *, palette: list[str] | None = None) -> Image.Image`
- `ValidationResult` dataclass 字段：`ok: bool`、`colors: int`、`alpha_ok: bool`、`size_ok: bool`、`message: str`

- [ ] **Step 1: 写失败测试**

```python
from PIL import Image
from backend.app.services.atelier.palette import load_palette, quantize_to_palette, validate_scene_image


def test_palette_has_48_unique_colors():
    palette = load_palette()
    assert len(palette) == 48
    assert len(set(palette)) == 48


def test_validate_accepts_palette_scene():
    palette = load_palette()
    img = Image.new("RGBA", (960, 540), (0, 0, 0, 0))
    img.putpixel((0, 0), (14, 15, 18, 255))
    result = validate_scene_image(img, palette=palette)
    assert result.ok is True
    assert result.size_ok is True
    assert result.alpha_ok is True


def test_validate_rejects_off_palette_and_semi_alpha():
    palette = load_palette()
    img = Image.new("RGBA", (960, 540), (0, 0, 0, 0))
    img.putpixel((0, 0), (1, 2, 3, 255))
    assert validate_scene_image(img, palette=palette).ok is False
    img.putpixel((0, 0), (14, 15, 18, 128))
    assert validate_scene_image(img, palette=palette).alpha_ok is False


def test_quantize_makes_off_palette_valid():
    palette = load_palette()
    img = Image.new("RGBA", (960, 540), (0, 0, 0, 0))
    img.putpixel((0, 0), (200, 30, 30, 255))
    fixed = quantize_to_palette(img, palette=palette)
    assert validate_scene_image(fixed, palette=palette).ok is True
```

- [ ] **Step 2: 运行测试确认失败**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_palette.py -v`  
Expected: FAIL

- [ ] **Step 3: 实现**

- `load_palette` 读 skill bundle 的 JSON；`lru_cache`。
- 校验：尺寸必须 960×540；遍历像素，alpha 只能是 0/255；非透明像素 RGB 必须在色板集合；统计不同颜色数 ≤48。
- 量化：把每个非透明像素映射到色板最近 RGB（欧氏距离）；保持 alpha 0/255。
- 返回可读 `message`，例如 `"16 colors · alpha 0/255 · 960x540"` 或具体失败原因。

- [ ] **Step 4: 运行测试确认通过**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_palette.py -v`  
Expected: 4 passed

---

### Task 4: 绘制基础（噪声、天空、地形、水）

**Files:**
- Create: `backend/app/services/atelier/draw/__init__.py`
- Create: `backend/app/services/atelier/draw/noise.py`
- Create: `backend/app/services/atelier/draw/sky.py`
- Create: `backend/app/services/atelier/draw/terrain.py`
- Create: `backend/app/services/atelier/draw/water.py`
- Test: `backend/tests/test_atelier_draw.py`

**Interfaces:**
- Produces: `value_noise_1d(length: int, rng: random.Random, scale: int) -> list[float]`（0..1，余弦插值）
- Produces: `bayer4(x: int, y: int) -> int`（0..15）
- Produces: `draw_sky(img: Image.Image, draw: ImageDraw.ImageDraw, spec: SceneSpec, palette: list[str], rng: random.Random) -> None`
- Produces: `draw_terrain(...)`、`draw_water(...)` 同签名

- [ ] **Step 1: 写失败测试**

```python
import random
from PIL import Image, ImageDraw
from backend.app.services.atelier.palette import load_palette, validate_scene_image
from backend.app.services.atelier.scene_spec import build_rule_scene
from backend.app.services.atelier.draw.sky import draw_sky
from backend.app.services.atelier.draw.terrain import draw_terrain
from backend.app.services.atelier.draw.water import draw_water
from backend.app.services.atelier.draw.noise import value_noise_1d, bayer4


def _canvas():
    return Image.new("RGBA", (960, 540), (0, 0, 0, 0))


def test_noise_is_bounded_and_bayer_is_4x4():
    rng = random.Random(1)
    values = value_noise_1d(960, rng, 64)
    assert len(values) == 960
    assert all(0.0 <= v <= 1.0 for v in values)
    assert {bayer4(x, y) for x in range(4) for y in range(4)} == set(range(16))


def test_sky_terrain_water_draw_in_palette():
    palette = load_palette()
    spec = build_rule_scene("洛阳龙门石窟，黄昏", seed=3)
    img = _canvas()
    draw = ImageDraw.Draw(img)
    rng = random.Random(3)
    draw_sky(img, draw, spec, palette, rng)
    draw_terrain(img, draw, spec, palette, rng)
    draw_water(img, draw, spec, palette, rng)
    result = validate_scene_image(img, palette=palette)
    assert result.ok is True
    assert result.colors > 2
```

- [ ] **Step 2: 运行测试确认失败**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_draw.py -v`  
Expected: FAIL

- [ ] **Step 3: 实现**

- 所有绘制函数只从传入 palette 取色；`ImageDraw` 使用整数坐标。
- `draw_sky`：按 `spec.time` 选 4–6 个色阶，按 y 分带；用 `bayer4` 做交界抖动；画云带与日/月色块。
- `draw_terrain`：用 `value_noise_1d` 生成远山轮廓；`environment` 为 `river_valley`/`lake` 时留水面；`urban` 时画远城剪影；近景山体用 2–3 层色阶。
- `draw_water`：当 `environment in {"river_valley","lake","canal","coast"}` 时，从 `spec.composition.horizon*540` 向下画水面；用色带 + 短横高光；不画规则圆点。
- 每个函数至少覆盖画面 5% 像素（测试中的 `colors > 2` 是下限；QA 再检查前景可读性）。

- [ ] **Step 4: 运行测试确认通过**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_draw.py -v`  
Expected: 2 passed

---

### Task 5: 地标模块 A（崖壁大佛、古塔、城门）

**Files:**
- Create: `backend/app/services/atelier/draw/landmarks.py`
- Test: `backend/tests/test_atelier_renderer.py`（先建文件，后续任务继续加）

**Interfaces:**
- Produces: `draw_cliff_buddha(img, draw, spec, palette, rng) -> None`
- Produces: `draw_pagoda(...)`、`draw_palace_gate(...)` 同签名
- Produces: `LANDMARK_DRAWERS: dict[str, Callable]`

- [ ] **Step 1: 写失败测试**

```python
import random
from PIL import Image, ImageDraw
from backend.app.services.atelier.palette import load_palette, validate_scene_image
from backend.app.services.atelier.scene_spec import build_rule_scene
from backend.app.services.atelier.draw.landmarks import LANDMARK_DRAWERS


def _draw_landmark(kind: str):
    palette = load_palette()
    spec = build_rule_scene("洛阳龙门石窟，黄昏", seed=5)
    spec.landmark_type = kind
    img = Image.new("RGBA", (960, 540), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    LANDMARK_DRAWERS[kind](img, draw, spec, palette, random.Random(5))
    return img, palette


def test_cliff_pagoda_gate_render_non_empty_in_palette():
    for kind in ("cliff_buddha", "pagoda", "palace_gate"):
        img, palette = _draw_landmark(kind)
        assert validate_scene_image(img, palette=palette).ok is True
        non_empty = sum(1 for p in img.getdata() if p[3] == 255)
        assert non_empty > 5000, kind
```

- [ ] **Step 2: 运行测试确认失败**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_renderer.py -v`  
Expected: FAIL

- [ ] **Step 3: 实现**

- `landmarks.py` 提供三个绘制函数 + `LANDMARK_DRAWERS` 注册表。
- `cliff_buddha`：崖壁层理 + 至少 8 个佛龛剪影 + 中央坐佛（头光双环、螺髻、面部明暗三阶）+ 台基；主要画面上半部。
- `pagoda`：3–9 层塔（按 `spec.mood`/`landmark_scale` 取 5 层），塔刹、台基、两侧树影。
- `palace_gate`：红墙、城门洞、重檐屋顶、灯笼/广场。
- 只在 palette 中取色；轮廓使用 `#1a1c20`，不用纯黑整圈描边；强调色通过 `spec.accent_role` 在 palette 中取（seal/gold/jade/stone/ochre）。
- 所有函数接受 `spec` 的 `composition.landmark_x`、`landmark_scale`、`mood`，默认居右；`mood` 影响明暗对比与色阶选择。

- [ ] **Step 4: 运行测试确认通过**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_renderer.py -v`  
Expected: 1 passed

---

### Task 6: 地标模块 B（水乡、山寺、天际线）

**Files:**
- Modify: `backend/app/services/atelier/draw/landmarks.py`
- Test: `backend/tests/test_atelier_renderer.py`（追加测试）

**Interfaces:**
- Produces: `draw_water_town(...)`、`draw_mountain_temple(...)`、`draw_skyline(...)`；注册进 `LANDMARK_DRAWERS`

- [ ] **Step 1: 写失败测试**

```python
def test_water_town_mountain_skyline_render_non_empty_in_palette():
    for kind in ("water_town", "mountain_temple", "skyline"):
        img, palette = _draw_landmark(kind)
        assert validate_scene_image(img, palette=palette).ok is True
        non_empty = sum(1 for p in img.getdata() if p[3] == 255)
        assert non_empty > 5000, kind
```

- [ ] **Step 2: 运行测试确认失败**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_renderer.py -v`  
Expected: FAIL for missing keys

- [ ] **Step 3: 实现**

- `water_town`：白墙黛瓦、河道、拱桥、乌篷船、柳树；桥洞至少 1 个拱。
- `mountain_temple`：2–3 层山峦 + 云雾 + 寺庙/小塔 + 松林。
- `skyline`：3–5 座高低不同的塔楼 + 江面/桥 + 稀疏灯光点（palette 暖色，不用霓虹）。
- 全部只从 palette 取色。

- [ ] **Step 4: 运行测试确认通过**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_renderer.py -v`  
Expected: 2 passed

---

### Task 7: 前景、天气与完整场景合成

**Files:**
- Create: `backend/app/services/atelier/draw/props.py`
- Create: `backend/app/services/atelier/draw/weather.py`
- Create: `backend/app/services/atelier/renderer.py`
- Test: `backend/tests/test_atelier_renderer.py`（追加）

**Interfaces:**
- Produces: `draw_props(img, draw, spec, palette, rng) -> None`
- Produces: `draw_weather(img, draw, spec, palette, rng) -> None`
- Produces: `draw_scene(spec: SceneSpec, progress: Callable[[int, str], None] | None = None) -> Image.Image`
- Produces: `to_2x(img: Image.Image) -> Image.Image`

- [ ] **Step 1: 写失败测试**

```python
from backend.app.services.atelier.renderer import draw_scene, to_2x


def test_draw_scene_all_types_are_valid_and_deterministic():
    for kind in ("cliff_buddha", "pagoda", "palace_gate", "water_town", "mountain_temple", "skyline"):
        spec = build_rule_scene("洛阳龙门石窟，黄昏", seed=11)
        spec.landmark_type = kind
        first = draw_scene(spec)
        second = draw_scene(spec)
        assert first.size == (960, 540)
        assert validate_scene_image(first).ok is True
        assert first.tobytes() == second.tobytes(), kind
        assert to_2x(first).size == (1920, 1080)


def test_draw_scene_reports_monotonic_progress():
    spec = build_rule_scene("苏州水乡，春雨", seed=12)
    events = []
    draw_scene(spec, progress=lambda pct, detail: events.append((pct, detail)))
    percents = [pct for pct, _ in events]
    assert percents == sorted(percents)
    assert percents[-1] == 100
    assert all(isinstance(detail, str) and detail for _, detail in events)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_renderer.py -v`  
Expected: FAIL

- [ ] **Step 3: 实现**

- `draw_scene` 顺序：sky → terrain → water → landmark → props → weather → vignette；每层后调用 `progress(percent, detail)`，percent 依次约 5/25/40/60/80/90/96/100。
- 图层叠加在同一个 RGBA 图上；`draw` 对象复用。
- `draw_props` 按 `spec.props` 与 `environment` 画松/柳、鸟、灯笼、船、花瓣；`draw_weather` 按 `weather` 画雾/雨/雪；最后用 palette 暗色做低强度暗角（棋盘/稀疏点，不用渐变）。
- 不透明像素为主；透明只用于画布空白（如果背景层完全覆盖则 alpha 全 255）。
- `to_2x` 用 `Image.Resampling.NEAREST`。

- [ ] **Step 4: 运行测试确认通过**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_renderer.py -v`  
Expected: 4 passed

---

### Task 8: 明信片与 Job 存储

**Files:**
- Create: `backend/app/services/atelier/storage.py`
- Modify: `backend/app/services/atelier/renderer.py`（加 `make_postcard`）
- Test: `backend/tests/test_atelier_renderer.py`（追加明信片测试）
- Test: `backend/tests/test_atelier_pipeline.py`（先建文件，Task 11 继续加）

**Interfaces:**
- Produces: `make_postcard(scene: Image.Image, spec: SceneSpec) -> Image.Image`（2112×1432）
- Produces: `JobArtifacts` dataclass：`job_id: str`、`dir: Path`、`scene: Path`、`scene_2x: Path`、`postcard: Path`、`spec_json: Path`、`zip: Path`
- Produces: `save_job(spec: SceneSpec, scene: Image.Image, scene_2x: Image.Image, postcard: Image.Image) -> JobArtifacts`
- Produces: `cleanup_old_jobs(max_jobs: int) -> int`

- [ ] **Step 1: 写失败测试**

```python
from backend.app.services.atelier.renderer import make_postcard


def test_postcard_is_2112x1432_and_contains_2x_scene():
    spec = build_rule_scene("洛阳龙门石窟，黄昏", seed=21)
    scene = draw_scene(spec)
    card = make_postcard(scene, spec)
    assert card.size == (2112, 1432)
    assert card.getpixel((96, 96)) == scene.getpixel((0, 0))


def test_save_job_writes_files_and_zip(tmp_path, monkeypatch):
    from backend.app.services.atelier import storage
    monkeypatch.setattr("backend.app.services.atelier.storage.ATELIER_DIR", tmp_path)
    spec = build_rule_scene("洛阳龙门石窟，黄昏", seed=22)
    scene = draw_scene(spec)
    artifacts = storage.save_job(spec, scene, to_2x(scene), make_postcard(scene, spec))
    assert artifacts.scene.exists()
    assert artifacts.scene_2x.exists()
    assert artifacts.postcard.exists()
    assert artifacts.spec_json.exists()
    assert artifacts.zip.exists()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_renderer.py -v`  
Expected: FAIL

- [ ] **Step 3: 实现**

- `make_postcard`：2112×1432；`#efe6d2` 纸底；场景贴在 (96,96)；底部 160px 题签；标题/副标题/日期（从 `spec.created_at` 取）用字体搜索列表（Noto Serif CJK SC、Songti SC、系统 serif），找不到字体时跳过文字；朱砂印章用 `#b8443a` 画 80×80 方块 + 简单白色边。明信片不调用 `validate_scene_image`。
- `storage.save_job`：`uuid.uuid4().hex` 作为 job_id；在 `settings.atelier_dir` 下建目录；写 `scene.png`、`scene@2x.png`、`postcard.png`、`scene.json`（`spec.model_dump_json(indent=2)`）、`README.txt`；zip 五个文件；返回 `JobArtifacts`。
- `cleanup_old_jobs`：按目录 mtime 排序，保留最近 N 个，删除其余。
- `storage.py` 模块级 `ATELIER_DIR = Path(get_settings().atelier_dir)`，方便测试 monkeypatch。

- [ ] **Step 4: 运行测试确认通过**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_renderer.py -v`  
Expected: 6 passed

---

### Task 9: 维基 / Commons 搜索

**Files:**
- Create: `backend/app/services/atelier/search.py`
- Test: `backend/tests/test_atelier_search.py`

**Interfaces:**
- Produces: `SearchHit`（frozen dataclass：`title`、`url`、`publisher`、`license`、`summary`）
- Produces: `async search_place(query: str, *, limit: int = 3, timeout: float = 4.0) -> list[SearchHit]`
- Produces: `_parse_wikipedia(payload: dict) -> list[SearchHit]`、`_parse_commons(payload: dict) -> list[SearchHit]`

- [ ] **Step 1: 写失败测试**

```python
import asyncio
from backend.app.services.atelier.search import _parse_wikipedia, search_place


def test_parse_wikipedia_payload():
    payload = {"query": {"pages": {"1": {"title": "龙门石窟", "extract": "龙门石窟位于河南省洛阳市。", "fullurl": "https://zh.wikipedia.org/wiki/龙门石窟"}}}}
    hits = _parse_wikipedia(payload)
    assert hits[0].title == "龙门石窟"
    assert hits[0].publisher == "维基百科"
    assert "洛阳" in hits[0].summary


def test_search_failure_returns_empty(monkeypatch):
    async def boom(*args, **kwargs):
        raise RuntimeError("blocked")
    monkeypatch.setattr("backend.app.services.atelier.search._fetch_json", boom)
    assert asyncio.run(search_place("龙门石窟")) == []
```

- [ ] **Step 2: 运行测试确认失败**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_search.py -v`  
Expected: FAIL

- [ ] **Step 3: 实现**

- `_fetch_json(url, params, timeout)` 用 `httpx.AsyncClient`，`User-Agent: CulturalLeader-Atelier/0.1 (educational demo)`；异常向上抛，`search_place` 捕获并返回 `[]`。
- 中文维基：`action=query&list=search&srsearch={query}&format=json&utf8=1` 取标题，再用 `prop=extracts&exintro=1&explaintext=1&titles=...` 取摘要；URL 用 `https://zh.wikipedia.org/wiki/{quote(title)}`。
- Commons：`action=query&generator=search&gsrsearch={query}&gsrnamespace=6&prop=imageinfo&iiprop=extmetadata|url&format=json`；取 `LicenseShortName`/`Artist`；失败只跳过 Commons。
- 缓存：`Path(get_settings().atelier_dir) / "cache" / "search" / f"{sha1(query)}.json"`；24 小时内直接读；写入时创建目录。
- 返回最多 `limit` 条，去重 URL；摘要截断 400 字。

- [ ] **Step 4: 运行测试确认通过**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_search.py -v`  
Expected: 2 passed

---

### Task 10: Agent（LLM + 规则降级）

**Files:**
- Create: `backend/app/services/atelier/agent.py`
- Test: `backend/tests/test_atelier_agent.py`

**Interfaces:**
- Produces: `async build_scene_spec(prompt: str, *, sources: list[SearchHit], seed: int) -> SceneSpec`
- Produces: `_scene_prompt(prompt: str, sources: list[SearchHit], contract: StyleContract) -> str`
- Consumes: `build_rule_scene`、`normalize_scene_spec`、`load_style_contract`、`SearchHit`

- [ ] **Step 1: 写失败测试**

```python
import asyncio
from backend.app.services.atelier.agent import build_scene_spec
from backend.app.services.atelier.search import SearchHit


def test_mock_mode_uses_rules():
    spec = asyncio.run(build_scene_spec("洛阳龙门石窟，黄昏", sources=[], seed=31))
    assert spec.place == "洛阳"
    assert spec.landmark_type == "cliff_buddha"
    assert spec.seed == 31
    assert spec.created_at


def test_sources_are_preserved():
    source = SearchHit(title="龙门石窟", url="https://example.org", publisher="维基百科", license="CC BY-SA", summary="...")
    spec = asyncio.run(build_scene_spec("洛阳龙门石窟", sources=[source], seed=32))
    assert spec.sources[0].title == "龙门石窟"
    assert spec.sources[0].license == "CC BY-SA"


def _fake_settings():
    return type("S", (), {
        "mock": False,
        "openai_api_key": "test-key",
        "base_url": None,
        "chat_model": "test-model",
    })()


def _fake_client(content: str):
    class FakeClient:
        class chat:
            class completions:
                @staticmethod
                async def create(**kwargs):
                    class Message:
                        pass
                    Message.content = content
                    class Choice:
                        message = Message()
                    class Response:
                        choices = [Choice()]
                    return Response()
    return FakeClient()


def test_invalid_llm_json_falls_back(monkeypatch):
    monkeypatch.setattr("backend.app.services.atelier.agent.get_settings", _fake_settings)
    monkeypatch.setattr("backend.app.services.atelier.agent.AsyncOpenAI", lambda **kwargs: _fake_client("not json"))
    spec = asyncio.run(build_scene_spec("苏州水乡，春雨", sources=[], seed=33))
    assert spec.landmark_type == "water_town"


def test_valid_llm_json_is_normalized(monkeypatch):
    payload = '{"title": "测试", "place": "测试", "landmark_type": "skyline", "time": "night", "weather": "snow"}'
    monkeypatch.setattr("backend.app.services.atelier.agent.get_settings", _fake_settings)
    monkeypatch.setattr("backend.app.services.atelier.agent.AsyncOpenAI", lambda **kwargs: _fake_client(payload))
    spec = asyncio.run(build_scene_spec("测试城市，夜色，雪", sources=[], seed=34))
    assert spec.landmark_type == "skyline"
    assert spec.time == "night"
    assert spec.weather == "snow"
    assert spec.prompt == "测试城市，夜色，雪"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_agent.py -v`  
Expected: FAIL

- [ ] **Step 3: 实现**

- `build_scene_spec`：
  - 若 `get_settings().mock` 或无 key → `build_rule_scene(prompt, seed=seed, sources=_to_source_refs(sources))`。
  - 否则用 `AsyncOpenAI(api_key=..., base_url=...)`，`model=get_settings().chat_model`，`temperature=0.4`，`response_format={"type":"json_object"}`（不支持时捕获 TypeError 去掉该参数重试一次）。
  - system prompt 包含：Skil 契约（palette 名称、画布、风格、规则）、允许的枚举、搜索摘要作为 `<search_context>` 数据块、要求只输出 JSON。
  - 解析 `choices[0].message.content`；`json.loads`；调用 `normalize_scene_spec`；填 `prompt`、`seed`、`created_at`、`sources`；任何异常回退规则。
- `_to_source_refs` 把 `SearchHit` 转 `SourceRef`。
- 规则数据 `RULE_LANDMARKS` 放 `scene_spec.py`，agent 复用 `build_rule_scene`。

- [ ] **Step 4: 运行测试确认通过**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_agent.py -v`  
Expected: 4 passed

---

### Task 11: 流水线与 SSE 事件

**Files:**
- Create: `backend/app/services/atelier/pipeline.py`
- Test: `backend/tests/test_atelier_pipeline.py`

**Interfaces:**
- Produces: `AtelierEvent` dataclass：`event: str`、`data: dict`
- Produces: `async stream_generation(prompt: str, *, seed: int | None = None, session_id: str = "") -> AsyncIterator[AtelierEvent]`
- Consumes: `search_place`、`load_style_contract`、`build_scene_spec`、`draw_scene`、`validate_scene_image`、`quantize_to_palette`、`to_2x`、`make_postcard`、`save_job`、`cleanup_old_jobs`

- [ ] **Step 1: 写失败测试**

```python
import asyncio
from backend.app.services.atelier.pipeline import stream_generation


def _collect(prompt, seed=41):
    async def run():
        return [event async for event in stream_generation(prompt, seed=seed)]
    return asyncio.run(run())


def test_event_sequence_and_files(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.app.services.atelier.storage.ATELIER_DIR", tmp_path)
    events = _collect("洛阳龙门石窟，黄昏")
    event_names = [event.event for event in events]
    assert event_names[0] == "stage"
    assert "source" in event_names or "stage" in event_names
    assert event_names[-1] == "done"
    done = events[-1].data
    assert done["job_id"]
    assert (tmp_path / done["job_id"] / "scene.png").exists()
    assert (tmp_path / done["job_id"] / "scene.zip").exists()
    stages = {event.data["key"]: event.data for event in events if event.event == "stage"}
    assert stages["skill"]["status"] == "done"
    assert stages["validate"]["status"] == "done"


def test_render_error_yields_error_without_job(tmp_path, monkeypatch):
    from backend.app.services.atelier import pipeline
    monkeypatch.setattr("backend.app.services.atelier.storage.ATELIER_DIR", tmp_path)
    monkeypatch.setattr(pipeline, "draw_scene", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    events = _collect("洛阳龙门石窟，黄昏")
    assert events[-1].event == "error"
    assert "boom" in events[-1].data["message"]
    assert list(tmp_path.iterdir()) == []
```

- [ ] **Step 2: 运行测试确认失败**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_pipeline.py -v`  
Expected: FAIL

- [ ] **Step 3: 实现**

- 事件顺序：
  1. `stage intent active` → `search`（用规则先得到 place/landmark 作为查询；`search_place` 失败不抛）→ `source` 事件 → `stage search done`（detail 标明「维基百科」或「站内资料」）。
  2. `stage skill active` → `load_style_contract()` → `stage skill done`（detail `InkGongbi48 · 48 色 · 960×540`）。
  3. `stage plan active` → `build_scene_spec` → `stage plan done`（detail 由 `landmark_type`/`time`/`weather` 拼）。
  4. `stage render active` → 用 `asyncio.Queue` + `loop.call_soon_threadsafe` 接收 `draw_scene` 的 progress；`asyncio.create_task(asyncio.to_thread(...))`；每次 progress 发 `progress` 事件；完成后 `stage render done`。
  5. `stage validate active` → `validate_scene_image`；失败则 `quantize_to_palette` 重试一次；记录结果；仍失败发 `stage validate error` + `error` 事件并 return。
  6. `stage export active` → `to_2x`、`make_postcard`、`save_job`、`cleanup_old_jobs`；`stage export done`。
  7. `done` data：`job_id`、`title`、`subtitle`、`scene`、`postcard`、`zip`、`spec`（`model_dump()`）、`validation`。
- 任何异常：`yield AtelierEvent("error", {"message": "造境失败：..."})`；不保存半成品。
- `seed` 默认 `random.SystemRandom().randint(1, 2**31-1)`；`created_at` 由 agent/规则填。

- [ ] **Step 4: 运行测试确认通过**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_pipeline.py -v`  
Expected: 2 passed

---

### Task 12: API 路由、限流与文件下载

**Files:**
- Create: `backend/app/routers/atelier.py`
- Modify: `backend/app/main.py`（import + `app.include_router(atelier.router)`）
- Test: `backend/tests/test_atelier_api.py`
- Modify: `backend/tests/conftest.py`（设 `ATELIER_DIR` 到临时目录并清理）

**Interfaces:**
- Produces: `POST /api/atelier/stream`、`GET /api/atelier/files/{job_id}/{name}`
- Produces: `AtelierRequest`（`prompt: str = Field(min_length=1, max_length=200)`、`seed: int | None`、`session_id: str | None`）
- Produces: `RateLimiter.allow(key: str, now: float | None = None) -> bool`（6 次 / 60 秒）

- [ ] **Step 1: 写失败测试**

```python
from fastapi.testclient import TestClient
from backend.app.main import app


def test_stream_returns_sse_and_files(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.app.services.atelier.storage.ATELIER_DIR", tmp_path)
    with TestClient(app) as client:
        with client.stream("POST", "/api/atelier/stream", json={"prompt": "洛阳龙门石窟，黄昏", "seed": 51}) as response:
            assert response.status_code == 200
            body = "".join(response.iter_text())
        assert "event: stage" in body
        assert "event: done" in body
        done = [line for line in body.splitlines() if line.startswith("data:") and "job_id" in line][-1]
        import json
        data = json.loads(done[5:])
        assert client.get(data["scene"]).status_code == 200
        assert client.get(data["zip"]).status_code == 200


def test_file_route_rejects_traversal():
    with TestClient(app) as client:
        assert client.get("/api/atelier/files/not-a-job/scene.png").status_code == 404
        assert client.get("/api/atelier/files/" + "0" * 32 + "/../app.db").status_code == 404


def test_prompt_length_validation():
    with TestClient(app) as client:
        assert client.post("/api/atelier/stream", json={"prompt": ""}).status_code == 422
        assert client.post("/api/atelier/stream", json={"prompt": "字" * 201}).status_code == 422
```

- [ ] **Step 2: 运行测试确认失败**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_api.py -v`  
Expected: FAIL，404

- [ ] **Step 3: 实现**

- `routers/atelier.py`：
  - `sse(event, data)` 与 `chat.py` 同格式。
  - `POST /atelier/stream`：校验、限流（`request.client.host`；超限 `HTTPException(429, "造境太频繁，请稍后再试")`）；返回 `StreamingResponse`，headers 同 `chat.py`（`Cache-Control: no-cache`、`X-Accel-Buffering: no`）。
  - 遍历 `stream_generation`，用 `sse` 包装。
  - `GET /atelier/files/{job_id}/{name}`：`job_id` 必须匹配 `^[0-9a-f]{32}$`；`name` 在白名单；`Path(settings.atelier_dir)/job_id/name` 必须 `is_file()`；返回 `FileResponse`。
- `main.py` 加 import 与 include。
- `conftest.py` 加：
  ```python
  os.environ["ATELIER_DIR"] = str(Path(tempfile.gettempdir()) / "culturalleader_test_atelier")
  ```
  并在 fixture 结束时清理该目录。

- [ ] **Step 4: 运行测试确认通过**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests/test_atelier_api.py -v`  
Expected: 3 passed

- [ ] **Step 5: 跑全量后端测试**

Run: `/home/ricaedo/下载/yes/envs/leader/bin/python -m pytest backend/tests -q`  
Expected: 全部通过（原有 + 新增）

---

## 完成标准

- 新增测试全部通过，原有测试无回归。
- `POST /api/atelier/stream` 在 mock 模式下能返回完整 SSE 并产出 5 个文件。
- 六类地标都能出图；场景图通过色板/alpha 校验；明信片 2112×1432。
- 搜索失败、LLM 非法输出、渲染异常都有可读降级。
- 不自动提交；完成后把改动与验证命令交给用户。
