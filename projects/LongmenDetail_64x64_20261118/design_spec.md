# LongmenDetail - Design Spec

> Human-readable design narrative. Machine-readable contract: spec_lock.md.

## I. Project Information

| Item | Value |
| ---- | ----- |
| **Project Name** | LongmenDetail（龙门石窟 · 奉先寺精修包） |
| **Canvas Size** | 基准 64×64；视口 960×540；大佛龛 768×576 |
| **Asset Count** | 17 个逻辑素材 / 18 个 PNG（核心 15 / 16 + 崖壁与堤岸升级 2） |
| **Art Style** | Dense Detail + 选择性描边；水墨工笔像素 |
| **Target Platform** | Web Canvas 2D + DOM UI overlay |
| **Color Palette** | InkGongbi48（48 色，沿用 v1，不新增） |
| **Created Date** | 2026-11-18 |

---

## II. Canvas Specification

| Property | Value |
| -------- | ----- |
| **Base sprite size** | 64×64 |
| **Tile size** | 64×64 |
| **Viewport** | 960×540 |
| **Hero background** | 768×576（奉先寺大佛龛） |
| **Background overrides** | 2112×576（崖壁 v2）、3200×576（堤岸 v2） |
| **UI overrides** | 64×64 面板；32×32 图标；24×24 工具图标；32×56 marker；32×32 印章；640×192 卡片横幅 |
| **Transparency** | Alpha channel (RGBA)，仅全透明或全不透明 |

---

## III. Color Palette

### Palette Name: InkGongbi48

沿用 v1 `projects/LongmenPark_64x64_20261117/spec_lock.md`，不新增颜色。完整 48 色见本文件 `spec_lock.md`。

| Role | HEX |
| ---- | --- |
| 墨 / 轮廓 | #0e0f12, #1a1c20, #26282b, #33322f |
| 岩褐 / 赭石 | #403b34, #4a4038, #5a4c3e, #6b5947, #7d6852, #91785e, #a68a68, #bda077, #d4ba90, #e8d2ae, #f2e5c8 |
| 墨绿 / 石绿 | #24352c, #2e4636, #3a5742, #48694e, #5b7f5c, #73966e, #8fae82, #aac49a |
| 水色 | #1b2f38, #254452, #315866, #3f6e7a, #54848c, #6d9ba0, #8bb4b0 |
| 暮紫 / 晚霞 | #3d3350, #54405c, #744f5e, #96655f, #b87a62, #d18f67, #e6a96f, #f4c27e, #ffd9a0, #fff0cc |
| 肤色 | #e8c49c, #c99a72 |
| 靛蓝 / 朱砂 / 棕 / 深裤 | #3f6a8a, #2e4d66, #b5503f, #8f3a30, #7a5436, #2c3a4a |

### Palette Usage Rules

- 所有像素颜色必须来自上述 48 色。
- 大佛龛最多 48 色；UI 面板 8–16 色；图标 6–8 色；marker 12–16 色。
- 光源：左上夕阳暖光；参考图只用于比例、结构与明暗，不引入照片原色。
- 缺失的中间调优先用 2×2 Bayer 抖动，不扩色板。

---

## IV. Art Style Definition

| Property | Value |
| -------- | ----- |
| **Sub-style** | Dense Detail + 选择性描边 |
| **Outline color** | 背景内轮廓 #1a1c20；UI #0e0f12 |
| **Shading depth** | 3-tone（大佛可借色阶做到 4 层明暗） |
| **Dithering** | Selective（云、雾、石面过渡、背光衰减） |
| **Light direction** | Top-left |
| **Pixel cluster** | 2×2 / 3×3 有意色块，禁止椒盐噪点 |
| **Hero face** | 大佛脸部约 90–120px 高，五官、耳垂、螺髻可读 |

大佛不使用整圈黑描边：以局部暗边、石块转折和背光层次塑形，保持石像的柔和与体积感。 UI 与 marker 使用清晰轮廓，保证在 1x/2x 缩放下都可读。

---

## V. Asset List

### Backgrounds

| Asset | Size | Colors | Animation | Description | Priority |
| ----- | ---- | ------ | --------- | ----------- | -------- |
| bg_fengxian_niche | 768×576 | 48 | none | 奉先寺大佛龛：卢舍那大佛、背光、二弟子/二菩萨/天王/力士、龛壁风化与景深 | high |
| bg_cliff_v2 | 2112×576 | 32 | none | 西山崖壁 v2：层理、裂隙、苔痕、深浅不一的佛龛；移除旧符号化大佛，避免与新龛叠加 | high |
| bg_promenade_v2 | 3200×576 | 24 | none | 伊水东岸堤岸 v2：不规则石板、错缝、苔藓、栏杆基座；去掉横向条带与重复圆点 | high |

### UI

| Asset | Size | Colors | Animation | Description | Priority |
| ----- | ---- | ------ | --------- | ----------- | -------- |
| ui_marker_spot | 32×56 | 16 | idle 2f @ 2fps | 未访观景点石灯/经幢 marker，暖光核心，1px 浮动 | high |
| ui_marker_spot_done | 32×56 | 16 | none | 已访 marker：朱砂印 + 熄灭石灯 | high |
| ui_panel_9slice_v2 | 64×64 | 12 | none | 深墨九宫格面板，双线金边、云纹角 | high |
| ui_icon_spot_bridge | 32×32 | 8 | none | 龙门桥图标 | high |
| ui_icon_spot_buddha | 32×32 | 8 | none | 卢舍那大佛图标 | high |
| ui_icon_spot_cave | 32×32 | 8 | none | 万佛洞图标 | high |
| ui_icon_spot_temple | 32×32 | 8 | none | 香山寺图标 | high |
| ui_icon_spot_garden | 32×32 | 8 | none | 白园图标 | high |
| ui_stamp_v2 | 32×32 | 6 | none | 朱砂印章（打卡/标题） | high |
| ui_icon_close | 24×24 | 6 | none | 关闭 | medium |
| ui_icon_check | 24×24 | 6 | none | 已访勾选 | medium |
| ui_icon_arrow | 24×24 | 6 | none | 展开/方向箭头 | medium |
| ui_icon_compass | 24×24 | 6 | none | 游历罗盘 | medium |
| ui_card_banner | 640×192 | 16 | none | 通用水墨山水横幅，用于景点卡片顶部 | high |

---

## VI. Animation Specification

| Asset | Animation | Frames | FPS | Loop | Notes |
| ----- | --------- | ------ | --- | ---- | ----- |
| ui_marker_spot | idle | 2 | 2 | Yes | 1px 上下浮动 + 暖光呼吸 |
| ui_marker_spot_done | — | 1 | — | — | 静态 |

本批次无角色动画；面板展开、卡片淡入由 DOM/CSS 以整数像素位移完成，不新增帧。

---

## VII. Technical Constraints

- 禁止抗锯齿、渐变填充、部分透明（1–254 alpha）、调色板外颜色、亚像素渲染。
- 所有像素硬边；1x 整数像素对齐；2x/3x 显示时保持像素块。
- 背景与 UI 的边缘颜色与内部色阶连续，禁止 1px 黑框导致拼接感。
- 石面纹理使用低频噪声与 2×2/3×3 色块，特征密度 ≤ 1%，禁止白色椒盐噪点。
- 参考图只作绘制依据，不直接嵌入游戏；最终 PNG 必须量化到 InkGongbi48。
- UI 不允许用运行时 `fillRect` 几何图形作为最终面板/marker；必须使用生成的 PNG 九宫格与图标。

---

## VIII. Platform Export Notes

| Platform | Special Requirements |
| -------- | -------------------- |
| Web Canvas 2D | PNG（RGBA）；禁用 imageSmoothing；世界层 960×540；整数像素 |
| DOM UI overlay | `border-image` 九宫格；像素字体子集（Fusion Pixel / Zpix）+ 系统兜底；整数像素位移 |
| 素材接入 | 校验通过后复制到 `frontend/demo/assets-v2/`，Demo 增加 `README` 说明与 `CREDITS.md` |

### Reference & Licensing

Step 5 从 Wikimedia Commons 等公开授权来源获取两张参考图：

- 奉先寺大佛龛全景（用于龛体、胁侍、背光与崖壁比例）
- 卢舍那大佛头部特写（用于面容、螺髻、耳垂、衣纹）

记录作者、许可、原始 URL 到 `images/CREDITS.md`；只作造型参考，不嵌入游戏。

### UI Layout Direction

- 顶部左侧：标题块 + 朱砂印；顶部右侧：5 个景点图标作为进度，已访点亮。
- 右侧：可展开的「游历」抽屉，列出 5 个景点与打卡状态。
- 底部中央：仅靠近景点时出现的情境提示（`E · 查看`），不再常驻底部说明条。
- 景点卡片：卷轴式九宫格面板 + 顶部水墨横幅 + 图标勋章 + 标题/副标题 + 描述 + 打卡印章 + 收起提示。
- 移除现有左下「旅行日志」面板与底部常驻操作提示；操作说明收进可展开帮助层。
