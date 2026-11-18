# ui_marker_spot

- Category: ui
- Size: 32×56 ×2 frames
- Colors used: 11–12 from InkGongbi48 (asset budget 16)
- Animation: idle 2 frames @ 2fps loop (`ui_marker_spot_idle_0/1`)
- Design notes:
  - 未访观景点 marker：石灯/经幢造型，底盘—石柱—灯室—翘檐—宝顶五段式。
  - 灯室金框 + 暖光核心，frame 1 整体上移 1px、核心提亮一阶，形成 1px 浮动与灯光呼吸。
  - 石面三色阶（EARTH/EARTH_L/EARTH_D），翘檐两端各 1px OCHRE 高光。
  - 光照左上；所有颜色来自 spec_lock.md。
- Variants: 合并图 `sheets/ui_ui_marker_spot_idle_32x56.png`。
