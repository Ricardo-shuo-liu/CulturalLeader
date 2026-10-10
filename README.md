# CulturalLeader · 文旅地图数字人平台

立体浮雕沙盘式的文旅地图舞台：中国地图是一块可以环绕观看的浅浮雕沙盘，山脉真实隆起、国境实描边，
城市光点贴在真实经纬度上；点击城市后地标从沙盘上升起，数字人讲解并支持语音问答。
场景光照由天文算法按真实时刻驱动，晨昏线会真的扫过中国版图。

在沙盘之上还有三件事：**把旅行排明白**（双击城市进真实地图编排，用 LKH-3.0.14 的 TSPTW 重优化，
组合成整体攻略并可播放推演）、**把别人的攻略抄进来**（链接 / 正文 / 截图解析成计划块）、
**穿越回唐 / 宋 / 明**（底图整体换成该朝示意疆域，看历史地名与浮起的光韵诗字，并与数字人讨论）。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 沙盘与日照 | 340×196 浮雕地形 + 敦煌壁画地台；逐片元按真实经纬度计算昼夜与晨昏线，可拖动时间滑块演示 |
| 城市与地标 | 369 座城市按视野分级标注；38 座城市有程序化 3D 地标，同原型靠专属部件区分 |
| 数字人与语音 | Live2D（迁移自 Fay）+ 云端 TTS / ASR，大模型对话贯穿沙盘、流程编辑与穿越模式 |
| 行程规划 | 双击城市 → 腾讯地图编排点位 → LKH-TSPTW 重优化 → 计划块 → 整体攻略 → 只读分享页 |
| 播放推演 | 旅行者光点按时间表推进，昼夜层与晨昏线随模拟时刻扫过，支持整份攻略多天连播 |
| 攻略导入 | 粘贴链接 / 正文 / 截图，解析出「一城一天」计划块，低置信度点位在地图上手动落位 |
| 穿越系统 | 唐 / 宋 / 明 示意疆域 + 历史地名 + **光韵诗字**（代表诗词浮在写作地上方）+ 朝代人格对话 |

## 快速开始

```bash
conda activate leader
pip install -r requirements.txt          # 官方源慢可加 -i https://mirrors.aliyun.com/pypi/simple/
python tools/vendor_frontend.py          # 一次性：把 three 拉到 frontend/vendor（离线可用）
./run.sh                                 # http://127.0.0.1:8000/
```

- 端口被占用时 `run.sh` 会提示占用进程并自动顺延，`PORT=9000 ./run.sh` 可指定端口；
- 后台在 <http://127.0.0.1:8000/admin>，默认令牌 `dev-token`（改 `.env` 里的 `ADMIN_TOKEN`）；
- `.env` 里配 `OPENAI_API_KEY`（对话）、`TTS_*` / `ASR_*`（语音）、`TENCENT_MAP_*`（地图与通勤时长）；
  全都没配也能跑：城市讲解走本地知识库、城内地图走自建矢量底图、通勤时长标注「估算」。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/01-沙盘与日照](docs/01-沙盘与日照.md) | 舞台构成、操作方式、真实日照实测、城市标注与 3D 地标 |
| [docs/02-行程规划与攻略](docs/02-行程规划与攻略.md) | 巡游 LKH 求解、腾讯 Key、流程编辑、整体攻略、接口与数据 |
| [docs/03-穿越系统](docs/03-穿越系统.md) | 唐 / 宋 / 明：示意疆域、历史地名、光韵诗字、朝代对话 |
| [docs/04-语音与数字人](docs/04-语音与数字人.md) | TTS / ASR 配置、Live2D 换模型、数字人出现的场景 |
| [docs/05-开发与校验](docs/05-开发与校验.md) | 目录结构、环境变量、脚本一览、全量校验、常见问题 |
| [docs/数字人（Live2D）接入说明](docs/数字人（Live2D）接入说明.md) | 模型配置细节与常见问题 |
| [docs/Cubism5资源获取指南](docs/Cubism5资源获取指南.md) | 模型从哪来、怎么自制/委托、授权怎么算 |

## 目录

```
backend/app        FastAPI（城市/对话/语音/流程/攻略/穿越/后台）+ SQLite
backend/app/data   内置数据（城市、地级市、省界、历史朝代：唐/宋/明 疆域与诗词）
backend/tests      pytest：接口、后台鉴权、Mock 降级、穿越数据与对话
frontend/js        舞台渲染、浮雕地形、天文日照、地标、语音
frontend/js/map    城内地图、城市流程、整体攻略、播放推演、穿越模式、诗词光韵
frontend/js/fay    Fay 风格数字人（Live2D 加载/口型/动作）
frontend/assets/live2d  Live2D 模型与 config.json
frontend/vendor    本地 ESM 依赖（离线可用）
docs/              分类文档（本目录）
tools              依赖抓取、轮廓数据、迁移与各类校验脚本
data/              本机数据（flows / guides / imports / tts_cache，不进 git）
```

## 校验

```bash
./tools/check_all.sh                     # 后端 59 项 + 前端 35 项 + 全部 JS 语法
./run.sh &                               # 另开终端启动服务，然后跑浏览器端到端：
python tools/browser_check.py            # 沙盘 / 数字人 / 路线 / 省份点击
python tools/browser_check_flows.py      # 双击城市 → 流程编辑 → 优化 → 攻略 → 分享页
python tools/browser_check_dynasty.py    # 穿越系统：唐/宋/明 底图、光韵诗字、诗词、朝代对话
```

更多脚本（Key 自检、语音自检、旧数据迁移、截图像素统计等）见 [docs/05-开发与校验](docs/05-开发与校验.md)。

## 许可

第三方组件与许可见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) 与 `licenses/`；
Live2D 运行时与示例模型的授权说明见 [docs/Cubism5资源获取指南](docs/Cubism5资源获取指南.md)。
