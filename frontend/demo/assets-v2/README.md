# assets-v2 · LongmenDetail 升级包

本目录是 `projects/LongmenDetail_64x64_20261118/` 生成的 v2 素材，已通过
`asset_validator.py` 校验，尺寸与色数均按 `spec_lock.md` 执行。

## 内容

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `backgrounds/bg_cliff_v2.png` | 2112×576 | 西山崖壁视差层（0.5×） |
| `backgrounds/bg_promenade_v2.png` | 3200×576 | 伊水东岸堤岸/步道（1.0×） |
| `backgrounds/bg_fengxian_niche.png` | 768×576 | 奉先寺大佛龛特写场景 |
| `ui/ui_panel_9slice_v2.png` | 64×64 | 九宫格面板（16px 边角） |
| `ui/ui_marker_spot_idle_0/1.png` | 32×56 | 未访景点石灯 marker（2 帧 @2fps） |
| `ui/ui_marker_spot_done.png` | 32×56 | 已访 marker（朱砂印） |
| `ui/ui_icon_spot_*.png` | 32×32 | 5 个景点图标 |
| `ui/ui_stamp_v2.png` | 32×32 | 朱砂印章 |
| `ui/ui_icon_close/check/arrow/compass.png` | 24×24 | 工具图标 |
| `ui/ui_card_banner.png` | 640×192 | 景点卡片水墨横幅 |

## 接入方式

- 世界层背景使用 `assets-v2/backgrounds/bg_cliff_v2.png` 与
  `assets-v2/backgrounds/bg_promenade_v2.png` 替换 v1 同名层。
- 九宫格面板按 `border-image` 方式绘制，边角固定 16px（`panel()` 中 `s = 16`）。
- marker 动画以 2fps 在 `ui_marker_spot_idle_0/1` 之间切换；已访时使用
  `ui_marker_spot_done`，不再播放发光。
- 奉先寺景点进入 `bg_fengxian_niche` 特写场景（768×576，1× 居中、顶部对齐，底部约 36px 由卡片遮挡，保证龛顶完整）。

## 重新生成

```bash
cd projects/LongmenDetail_64x64_20261118/scripts
python3 hero.py        # bg_fengxian_niche
python3 cliff.py       # bg_cliff_v2
python3 promenade.py   # bg_promenade_v2
python3 ui.py          # UI 套件

cd ../../..
python3 .claude/skills/pixel-asset-master/scripts/asset_validator.py projects/LongmenDetail_64x64_20261118
```

## 说明

- 所有 PNG 为 RGBA，alpha 仅 0/255；无抗锯齿、无渐变、无亚像素。
- 颜色全部来自 `InkGongbi48`（项目 `spec_lock.md`）。
- 参考照片仅用于比例与明暗研究，未嵌入游戏；出处见 `CREDITS.md`。
