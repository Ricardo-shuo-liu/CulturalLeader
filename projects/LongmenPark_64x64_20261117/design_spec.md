# Longmen Park - Design Spec

> Human-readable design narrative. Machine-readable contract: spec_lock.md.

## I. Project Information

| Item | Value |
| ---- | ----- |
| **Project Name** | Longmen Park（龙门石窟 · 伊水公园） |
| **Canvas Size** | 角色 64×64；画面基准 960×576；瓦片 64×64 |
| **Asset Count** | 44（角色逐帧 14、瓦片 3、道具 10、UI 7、特效 4、背景 6） |
| **Art Style** | 水墨工笔像素（强轮廓、3 色调、选择性抖动、硬边） |
| **Target Platform** | Web Canvas 2D（HTML5，PNG 资产，`imageSmoothingEnabled = false`） |
| **Color Palette** | InkGongbi48（48 色自定义调色板） |
| **Created Date** | 2026-11-17 |

---

## II. Canvas Specification

| Property | Value |
| -------- | ----- |
| **Base sprite size** | 64×64 |
| **Tile size** | 64×64 |
| **Background size** | 见资产清单（最大 3776×576） |
| **Transparency** | Alpha channel (RGBA) |

---

## III. Color Palette

### Palette Name: InkGongbi48

| Index | HEX | Role |
| ----- | --- | ---- |
| 0 | #00000000 | Transparent |
| 1 | #0e0f12 | 墨黑（轮廓） |
| 2 | #1a1c20 | 深墨 |
| 3 | #26282b | 墨灰 |
| 4 | #33322f | 暖墨 |
| 5 | #403b34 | 深岩褐 |
| 6 | #4a4038 | 岩褐暗 |
| 7 | #5a4c3e | 岩褐 |
| 8 | #6b5947 | 岩褐中 |
| 9 | #7d6852 | 岩褐亮 |
| 10 | #91785e | 赭石暗 |
| 11 | #a68a68 | 赭石 |
| 12 | #bda077 | 赭石亮 |
| 13 | #d4ba90 | 土金 |
| 14 | #e8d2ae | 沙金 |
| 15 | #f2e5c8 | 米白 |
| 16 | #24352c | 墨绿深 |
| 17 | #2e4636 | 墨绿 |
| 18 | #3a5742 | 石绿暗 |
| 19 | #48694e | 石绿 |
| 20 | #5b7f5c | 石绿亮 |
| 21 | #73966e | 草绿 |
| 22 | #8fae82 | 草绿亮 |
| 23 | #aac49a | 苔绿 |
| 24 | #1b2f38 | 水深 |
| 25 | #254452 | 水暗 |
| 26 | #315866 | 水 |
| 27 | #3f6e7a | 水亮 |
| 28 | #54848c | 湖青 |
| 29 | #6d9ba0 | 水灰 |
| 30 | #8bb4b0 | 波光灰 |
| 31 | #3d3350 | 暮紫深 |
| 32 | #54405c | 暮紫 |
| 33 | #744f5e | 暮紫褐 |
| 34 | #96655f | 晚霞赭 |
| 35 | #b87a62 | 晚霞橙暗 |
| 36 | #d18f67 | 晚霞橙 |
| 37 | #e6a96f | 夕阳橙 |
| 38 | #f4c27e | 夕阳金 |
| 39 | #ffd9a0 | 夕照 |
| 40 | #fff0cc | 夕照高光 |
| 41 | #e8c49c | 肤色 |
| 42 | #c99a72 | 肤色暗 |
| 43 | #3f6a8a | 靛蓝（外套） |
| 44 | #2e4d66 | 靛蓝暗 |
| 45 | #b5503f | 朱砂（围巾/印章） |
| 46 | #8f3a30 | 朱砂暗 |
| 47 | #7a5436 | 背包棕 |
| 48 | #2c3a4a | 深裤 |

### Palette Usage Rules

- 所有像素颜色必须来自上述调色板
- 每个精灵最多 24 色（不含透明）
- 光源方向：左上（夕阳从画面左上方投射暖光）

---

## IV. Art Style Definition

| Property | Value |
| -------- | ----- |
| **Sub-style** | Outlined + Cel-shaded |
| **Outline color** | #0e0f12（角色/道具）；背景使用 #1a1c20 内轮廓 |
| **Shading depth** | 3-tone |
| **Dithering** | Selective（天空、水面、远景薄雾用 2×2 Bayer 抖动） |
| **Light direction** | Top-left |

---

## V. Asset List

### Characters

| Asset | Size | Colors | Animation | Description | Priority |
| ----- | ---- | ------ | --------- | ----------- | -------- |
| player_idle_0..3 | 64×64 | 16 | idle 4f | 靛蓝外套、朱砂围巾、棕色旅行包的旅人，待机呼吸 | high |
| player_walk_0..5 | 64×64 | 16 | walk 6f | 左右行走循环，围巾与背包随步伐摆动 | high |
| player_interact_0..3 | 64×64 | 16 | interact 4f | 抬手眺望/触碰碑刻的交互动作 | high |

### Tiles

| Asset | Size | Colors | Animation | Description | Priority |
| ----- | ---- | ------ | --------- | ----------- | -------- |
| tile_path_stone | 64×64 | 12 | none | 无缝青石板步道，低频噪点与少量裂痕 | high |
| tile_grass | 64×64 | 10 | none | 无缝草带，柔和明暗、无规则图案 | high |
| tile_stone_wall | 64×64 | 10 | none | 无缝河岸条石，错缝砌筑但避免规则网格 | high |

### Items (Props)

| Asset | Size | Colors | Animation | Description | Priority |
| ----- | ---- | ------ | --------- | ----------- | -------- |
| prop_pine_01 | 128×192 | 14 | none | 松树，3 层不规则树冠 | high |
| prop_willow_01 | 128×192 | 16 | none | 垂柳，圆冠 + 垂枝 | high |
| prop_lamp | 64×128 | 10 | none | 石灯，暖光窗口 | high |
| prop_bench | 64×64 | 8 | none | 木条长椅 | medium |
| prop_sign | 64×64 | 8 | none | 景点指示木牌 | medium |
| prop_bridge | 512×192 | 16 | none | 龙门石拱桥 | high |
| prop_gate | 192×256 | 16 | none | 香山寺牌坊 | medium |
| prop_moon_gate | 128×192 | 14 | none | 白园月洞门 | medium |
| prop_railing | 64×64 | 8 | none | 可平铺石栏杆 | high |
| prop_stone_step | 128×64 | 8 | none | 石阶 | medium |

### UI

| Asset | Size | Colors | Animation | Description | Priority |
| ----- | ---- | ------ | --------- | ----------- | -------- |
| ui_panel_9slice | 48×48 | 8 | none | 深墨面板 + 金线边框（九宫格） | high |
| ui_icon_bridge | 16×16 | 6 | none | 龙门桥图标 | medium |
| ui_icon_buddha | 16×16 | 6 | none | 卢舍那大佛图标 | medium |
| ui_icon_cave | 16×16 | 6 | none | 万佛洞图标 | medium |
| ui_icon_temple | 16×16 | 6 | none | 香山寺图标 | medium |
| ui_icon_garden | 16×16 | 6 | none | 白园图标 | medium |
| ui_stamp | 24×24 | 4 | none | 打卡朱砂印章 | medium |

### Effects

| Asset | Size | Colors | Animation | Description | Priority |
| ----- | ---- | ------ | --------- | ----------- | -------- |
| fx_glow | 64×64 | 6 | none | 暖灯光晕（运行时叠加） | high |
| fx_petal | 8×8 | 4 | none | 花瓣/落叶粒子 | low |
| fx_ripple | 32×16 | 4 | none | 水面涟漪 | medium |
| fx_bird | 16×8 | 3 | none | 飞鸟剪影（两帧由运行时翻转） | low |

### Backgrounds

| Asset | Size | Colors | Animation | Description | Priority |
| ----- | ---- | ------ | --------- | ----------- | -------- |
| bg_sky | 960×576 | 14 | none | 黄昏天空、太阳、云（固定层） | high |
| bg_far_hills | 1280×576 | 8 | none | 远山剪影（视差 0.12） | high |
| bg_cliff | 2112×576 | 24 | none | 西山崖壁、佛龛群、奉先寺大佛（视差 0.5） | high |
| bg_river | 2560×576 | 12 | none | 伊河底色、崖壁倒影、远岸水线（视差 0.7） | high |
| bg_promenade | 3200×576 | 18 | none | 石砌堤岸、石栏杆、石板步道、草带（视差 1.0） | high |
| bg_foreground | 3776×576 | 10 | none | 前景柳枝与草丛画框（视差 1.25） | high |

---

## VI. Animation Specification

| Asset | Animation | Frames | FPS | Loop | Notes |
| ----- | --------- | ------ | --- | ---- | ----- |
| player | idle | 4 | 8 | Yes | 呼吸起伏 1px，围巾微动 |
| player | walk | 6 | 12 | Yes | 完整步态，手臂与背包摆动 |
| player | interact | 4 | 8 | No | 抬手 → 保持 → 放下 |

---

## VII. Technical Constraints

- No anti-aliasing
- No gradient fills (use dithering)
- No partial opacity (fully opaque or transparent only)
- All colors from declared palette
- Consistent light direction across all assets
- Pixel-perfect at declared size (no scaling artifacts)
- Tiles seamless on all four edges
- Terrain noise: low-frequency value noise, feature density ≤ 1%

---

## VIII. Platform Export Notes

| Platform | Special Requirements |
| -------- | ------------------- |
| Web Canvas 2D | PNG（RGBA）；禁用 imageSmoothing；整数像素对齐；精灵图同行同尺寸 |
