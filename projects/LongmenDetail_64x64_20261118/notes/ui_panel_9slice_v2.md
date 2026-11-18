# ui_panel_9slice_v2

- Category: ui
- Size: 64×64
- Colors used: 7 from InkGongbi48 (asset budget 12)
- Animation: none
- Design notes:
  - 深墨九宫格面板：16px 边角固定，中线可拉伸；中心为纯 INK2，避免拉伸纹理畸变。
  - 双线金边：外线 OCHRE_D、内线 OCHRE，中间以 INK3 分隔；最外 3px INK 硬边。
  - 四角云纹卷云：8–15px 范围内三层同心圆弧（OCHRE_D/OCHRE/OCHRE_L），不跨入拉伸边。
  - 金边上有少量 2×2 磨损点，保持对称、不抢内容。
  - 用法：DOM `border-image: url(...) 16 fill stretch`。
- Variants: 无。
