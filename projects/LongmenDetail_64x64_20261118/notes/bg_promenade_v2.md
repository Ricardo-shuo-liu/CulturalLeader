# bg_promenade_v2

- Category: backgrounds
- Size: 3200×576 (RGBA, hard alpha)
- Colors used: 15 from InkGongbi48 (asset budget 24)
- Animation: none
- Design notes:
  - 伊水东岸堤岸层，用于 1.0 倍视差（玩家行走面）；去掉旧版横向条带、重复圆点与整块平铺草地。
  - 驳岸：3–4 层错缝石砌，单块 60–150×20–30px，逐块抖动石色与上下沿；水线处加深色湿渍与苔痕。
  - 压顶石：60–140px 长条石，深浅交错，局部缺角与苔藓，避免连续亮边。
  - 步道：Voronoi 不规则石板（种子 108×56 网格抖动），1px 受光/背光倒角形成 2px 石缝；全局 2D 噪声做低频色差，局部磨损划痕与 9 处凹陷石板。
  - 栏杆基座：36–46×20–27px 石础，间距 220–340px 抖动，带凹槽、斜向凿痕与底部苔痕。
  - 草坡：三层绿色噪声 + 2400 笔竖向草叶 + 步道边缘垂草，底部盐肤/土斑，禁止重复瓦片。
  - 光源：左上；所有颜色来自 spec_lock.md。
- Variants: 无。生成脚本 `scripts/promenade.py`。
