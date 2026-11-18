# bg_fengxian_niche

- Category: backgrounds
- Size: 768×576 (RGBA, hard alpha)
- Colors used: 17 from InkGongbi48 (asset budget 48)
- Animation: none
- Design notes:
  - 构图：拱形大龛（外框 + 内壁双层拱），中央为卢舍那大佛，两侧二弟子/二菩萨，外缘二天王/力士，龛壁满布浅龛与风化。
  - 大佛：以 `images/lushena_head.jpg`（CC0，Gary Todd）为比例与明暗依据，裁切头部至下摆（crop 500,280→2200,2760），LANCZOS 降采样到 245×357，经 3×3 中值去噪后量化到 12 级暖石色阶；螺髻按 5px 交错行手绘 2–3px 卷发弧，发际线用双线勾出。面部保留照片的五官结构（低垂眼睑、鼻梁、唇角），不描整圈黑边。
  - 下摆：照片裁切底部用低频正弦侵蚀成锯齿状破边，并在其下绘制风化岩台（2×2 色块 + 层理 + 裂隙），避免出现直切横线；岩台与底部石台连成一体。
  - 背光：双层刻线圆环 + 火焰纹齿，环内为暗壁，环外逐渐过渡到龛壁。
  - 胁侍：弟子（光头、素袈裟）与菩萨（三瓣宝冠、朱砂帔帛），3 色阶衣纹 + 头光双环；外缘天王作举臂姿态，整体明度低于主尊。
  - 龛壁：低频噪声 + 竖向凿痕 + 浅龛（内置低对比坐佛剪影），特征密度受控，无白色椒盐噪点。
  - 框：双层金边 + 云纹角 + 方形梁孔，内缘左上受光、右下压暗。
  - 光源：左上暖光；所有颜色来自 spec_lock.md。
- Variants: 无。生成脚本 `scripts/hero.py`（依赖 `scripts/photo_buddha.py`、`scripts/gen_lib.py`）。
