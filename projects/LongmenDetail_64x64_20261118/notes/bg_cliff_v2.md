# bg_cliff_v2

- Category: backgrounds
- Size: 2112×576 (RGBA, hard alpha)
- Colors used: 12 from InkGongbi48 (asset budget 32)
- Animation: none
- Design notes:
  - 西山崖壁远景层，用于 0.5 倍视差；旧版符号化大佛已移除，主尊交给独立的 `bg_fengxian_niche`。
  - 崖体：2D 低频值噪声经 4 级色阶 posterize 成大面积岩面，叠加竖向扶壁与深色裂隙，避免整屏横向条带。
  - 层理：24 条起伏层理线，线宽 1–2px，带断口；层理下方 3–5px 抖动阴影、上方 1px 受光檐口，形成岩层厚度。
  - 裂隙：150 条短随机游走裂纹 + 220 条竖向节理，密度受控。
  - 佛龛：5 组「万佛洞」式密集小龛（4–8px，网格抖动排布）、10 组中型龛（8–26px）与 6 个大窟（46–64px，深腔 + 坐佛剪影 + 破口龛沿）；龛腔按深度分 3 档，上沿受光、下沿投影。
  - 苔痕：崖顶灌木与垂草、层理檐口苔斑、龛沿苔点；只在暗色交界处生长。
  - 崖顶轮廓量化成 5px 岩块台阶，并加 1px 暗边。
  - 光源：左上；所有颜色来自 spec_lock.md。
- Variants: 无。生成脚本 `scripts/cliff.py`。
