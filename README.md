# CulturalLeader · 文旅地图数字人平台

立体浮雕沙盘式的文旅地图舞台：中国地图是一块可以环绕观看的浅浮雕沙盘，山脉真实隆起、
国境实描边，城市光点贴在真实经纬度上；点击城市后地标从沙盘上升起，数字人讲解并支持语音问答。
场景光照由天文算法按真实时刻驱动，晨昏线会真的扫过中国版图。

## 快速开始

```bash
conda activate leader
pip install -r requirements.txt          # 官方源慢可加 -i https://mirrors.aliyun.com/pypi/simple/
python tools/vendor_frontend.py          # 一次性：把 three / three-vrm 拉到 frontend/vendor
./run.sh                                 # http://127.0.0.1:8000/
```

端口被占用时 `run.sh` 会提示占用进程并自动改用下一个空闲端口；`PORT=9000 ./run.sh` 可指定端口。
后台在 <http://127.0.0.1:8000/admin>，默认令牌 `dev-token`（改 `.env` 里的 `ADMIN_TOKEN`）。

## 巡游路线（LKH-3.0.14）

点击左上角「路线规划」进入多选模式：点城市加入或移除，选好后点「求解最优路线」，
后端会把选中城市写成 TSPLIB GEO 实例并调用**本地 LKH-3.0.14** 求最短巡回，
结果以金色航线画在地图上（带流动光点），并按顺序给城市编号，数字人播报总里程与顺序。

- 求解器位置：`LKH-3.0.14/LKH`，若不存在会自动退回内置「最近邻 + 2-opt」并在界面标注。
- 重新编译：`make -C LKH-3.0.14`（需要 gcc/make，已在本机编译通过）。
- 距离口径：LKH 用 TSPLIB GEO（先纬度后经度），显示里程用 haversine，两者已交叉校验
  （五城示例：LKH 5044 km vs haversine 5036 km，误差 0.2%）。

## 操作方式

| 操作 | 效果 |
| --- | --- |
| 左键拖动 | 环绕旋转（俯仰限制在接近垂直与接近水平之间，不会转到地平面以下） |
| 滚轮 / 双指捏合 | 缩放（2.2 – 11 个世界单位） |
| 右键拖动 | 平移，范围限制在沙盘附近 |
| 悬停光点 | 光点放大，城市名浮动 |
| 点击光点 | 相机飞向该城市，地标从地图上升起，数字人开始讲解 |
| 右上时刻牌 | 展开时间滑块做日照演示，`回到实时` 恢复跟随 |
| 左上「路线规划」 | 进入多选模式，点城市加入/移除，求解 LKH 最优巡回 |

URL 覆盖：`?t=2026-09-23T06:30` 或 `?t=06:30`，`?live=0` 关闭实时跟随。

## 舞台构成

```
浮雕沙盘（y 轴向上）   340×196 高度场：10 条主脊真实隆起，山脊明暗随时段变化
国境描边               2.6px 实描边 + 6px 冷色外发光，省界一并绘出
城市光点               贴在浮雕表面，正对相机，按所在地真实昼夜独立亮灭
壁画地台               敦煌风格程序化壁画：紧贴沙盘的矩形纹样边框（联珠/卷草/忍冬 +
                       四角藻井），外圈莲花、云气与飘带；中央按沙盘轮廓掏空
                       （实测沙盘两侧暖色壁画像素占比 89%）
地面光池               中心墨色光池 + 墨云纹理（加色混合），随时段与经度改变色调
天穹                   大球渐变背景，任何视角都不会出现纯黑
幕布（z=-13.5）        120×66 的两片对开水墨绸幕，幕上有远山剪影，夜间浮出星点
空气层                 760 颗缓慢上浮的尘埃微粒，夜间更暖更亮
地标                   点击城市后从沙盘该点升起，含瓦垄/砖纹/窗棂/彩画额枋等程序化细节
                       天坛（三层汉白玉台+栏杆+十二柱+三层琉璃檐+宝顶）、
                       东方明珠（三撑柱+三球经纬环+幕墙窗格）、
                       广州塔（双曲塔身+24 根斜肋+8 道环+观景台）、
                       钟楼（砖砌台基+斗栱+彩画额枋+四角攒尖+脊兽）、
                       熊猫塔（线脚塔身+五个球舱+环廊）
数字人（Live2D）       独立透明画布常驻右下：Cubism 5 模型 + 音频包络驱动口型
                       （ParamMouthOpenY）/ 自动眨眼 / 视线跟随 / Idle 与 TapBody 动作
                       未放模型时显示接入引导卡片（迁移自 Fay，详见专门文档）
画面收边               径向暗角 + 顶部压暗，让沙盘成为视觉中心
```

参数集中在 `frontend/js/config.js`（沙盘跨度、隆起高度、相机限制、幕布尺寸），
山脊走向在 `frontend/js/data/ranges.js`，地标几何在 `frontend/js/landmarks.js`。

## 真实日照（实测数据）

浏览器实测（无头 Firefox，隐藏界面后按真实经纬度取样）：

| 取样点 | 06:30 | 12:00 | 23:00 | 06:30 色温 |
| --- | --- | --- | --- | --- |
| 南京附近 118.8E,32.1N | 48.2 | 36.9 | 10.6 | 暖 +6.4 |
| 天山北麓 87.6E,43.8N | 11.1 | 37.8 | 9.7 | 冷 −8.0 |

即 06:30 时东部已被金色晨光照亮、西部仍在夜色中；正午两地都亮，夜间都暗。
地图区域另有 7100+ 高亮轮廓像素与 11000+ 强边缘像素，国境线与山脉层次都清晰可辨。

## 目录

```
backend/app        FastAPI（城市/对话/语音/后台）+ SQLite
backend/tests      pytest：接口、后台鉴权、Mock 降级
frontend/js        舞台渲染、浮雕地形、天文日照、地标、语音
frontend/js/fay    Fay 风格数字人（Live2D 加载/口型/动作/动作语义映射）
frontend/assets/live2d  Live2D 模型与 config.json
docs/              文档（含 Live2D 接入说明）
THIRD_PARTY_LICENSES.md  第三方组件与许可
frontend/vendor    本地 ESM 依赖（tools/vendor_frontend.py 生成，离线可用）
tools              依赖抓取、轮廓数据、各类校验脚本
```

## 校验

```bash
./tools/check_all.sh                                    # 后端 24 项 + 前端 17 项 + 语法
python tools/check_live2d_model.py                      # Live2D 模型是否满足接入要求
python tools/fetch_cities_cn.py                         # 重新生成全国城市清单（可选）
python tools/check_map.py                               # 腾讯位置服务 Key 自检（类型/配额/接口可用性）
./run.sh &                                              # 另开一个终端
python tools/browser_check.py                           # 沙盘/数字人/路线端到端
python tools/browser_check_planner.py                   # 行程工作台端到端
python tools/analyze_shots.py                           # 截图像素统计
```

`browser_check.py` 用系统自带 Firefox（无头）验证 WebGL 启动、页面零错误、相机可旋转可缩放、
点击城市后地标升起、讲解气泡有内容，以及**路线规划**（选五城 → LKH 求解 → 结果与地图航线）；
`analyze_shots.py` 用真实经纬度采样点比较不同时刻的明暗与色温，并检查国境描边、
壁画可见性、极端视角纯黑占比与航线金色像素。

Node 未安装时可用便携版：`.tools/node/bin/node`（`check_all.sh` 会自动识别）。

## 无 Key 降级

不配置 `OPENAI_API_KEY` 时自动进入 Mock 模式：讲解词来自本地知识库，语音走浏览器
`SpeechSynthesis`，语音识别走浏览器 `SpeechRecognition`（不可用时退回文字输入）。
配置 `.env` 后即可切换到真实大模型与语音。

## 行程路径规划（沙盘 + 腾讯位置服务 + LKH-TSPTW）

左上角「☰ 导航」打开侧边抽屉，功能都在里面；沙盘按时视野自动切换标注——全国尺度只显示
**重点城市**（约 33 个），缩进到**省级范围会自动显示该省的城市**（例：飞入洛阳后显示 17 城并带名字）。
点城市进入行程工作台：用**腾讯位置服务**的真实地图与通勤时长逐日编排，
LKH-3.0.14 的 TSPTW 按开放时间与固定预约做单日最优排序，支持地图长按拖拽调序、
附近餐厅与小店推荐、按天配色 polyline、导出导入 JSON。
只有腾讯 WebServiceAPI Key 也能完整使用：后端算真实通勤时长，城内地图用**离线矢量底图**
（区县边界 + 滚轮缩放 + 拖拽平移 + 里程标注）。没有 Key 时降级为直线估算并标注。

- 使用与配置：[docs/行程路径规划使用说明.md](docs/行程路径规划使用说明.md)
- 后端：`backend/app/services/tencent_map.py`（缓存/限流/配额/降级）、`trip_optimizer.py`（TSPTW）、`trip_store.py`（本地 JSON）
- 接口：`/api/geo/cities`、`/api/trips*`、`/api/poi/*`、`/api/map/status|selftest`、`/api/config`

## 数字人（Live2D，迁移自 Fay）

数字人采用 **Fay 风格的驱动约定**：服务端只说通用动作语义，前端用 Live2D 渲染，
口型由音频包络实时驱动。迁移自 Fay 的《Live2D模型制作要求》与《标准动作改造说明》。

项目里已内置官方示例模型 **Hiyori**（开箱即用，口型已实测可动）。换模型的 3 步：

1. 把 Cubism 5 导出的整个目录放进 `frontend/assets/live2d/model/`（含 .moc3 与贴图）
2. 在 `frontend/assets/live2d/config.json` 里把 `model` 指向 `model/你的模型.model3.json`
3. 校验：`python tools/check_live2d_model.py`

换官方示例模型一条命令搞定：`python tools/fetch_live2d_sample.py --name Haru`。
**模型从哪来、怎么自制/委托、授权怎么算**，见
**[docs/Cubism5资源获取指南.md](docs/Cubism5资源获取指南.md)**。

详细配置项（缩放/锚点、口型参数、Idle 与 TapBody 动作组、动作语义映射、夜间调光）
与常见问题见 **[docs/数字人（Live2D）接入说明.md](docs/数字人（Live2D）接入说明.md)**。

Live2D 运行时（PixiJS / Cubism Core / pixi-live2d-display）已在 `frontend/vendor/live2d/`，
缺失时可用 `python tools/vendor_live2d.py` 重新抓取。
