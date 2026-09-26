# 第三方组件与许可

本项目自行编写部分尚未选定开源协议（作者稍后确定）。以下为随项目分发或被调用的第三方组件，
请按各自条款使用；迁移自 GPL-3.0 项目的派生代码继续保持 GPL-3.0。

| 组件 | 用途 | 许可 | 说明 |
| --- | --- | --- | --- |
| **Fay**（[xszyou/Fay](https://github.com/xszyou/Fay)） | 数字人驱动约定（`Topic=human` 消息结构、通用动作语义、Live2D 模型要求） | **GPL-3.0** | 完整许可证见 `licenses/Fay-GPL-3.0.txt`（Fay 源码目录可删除，但请保留该许可证文件）；本项目 `frontend/js/fay/*`、`backend/app/services/fay_human.py` 为其派生实现，派生部分同样以 GPL-3.0 分发 |
| Live2D Cubism Core | 浏览器端解析 Cubism 5 模型 | Live2D Proprietary Software License | `frontend/vendor/live2d/live2dcubismcore.global.js`，属官方 Redistributable Code，条款见同目录 `RedistributableFiles.txt` |
| pixi-live2d-display 0.4.0 | Live2D 渲染 | MIT | `frontend/vendor/live2d/cubism4.min.js` + `LICENSE.pixi-live2d-display` |
| PixiJS 6.5.10 | 2D 渲染引擎 | MIT | `frontend/vendor/live2d/pixi.min.js` |
| three.js 0.185.1 | 沙盘/幕布渲染 | MIT | `frontend/vendor/three/`（由 `tools/vendor_frontend.py` 抓取） |
| **LKH-3.0.14**（Keld Helsgaun） | 巡游路线求解 | 作者分发的学术/研究用途代码 | 仅由后端通过子进程调用本机编译出的可执行文件；源码与二进制均不随本项目源码分发，需自行 `make -C LKH-3.0.14` 编译。商用请与作者确认授权 |
| 中国省级边界数据（dataV/阿里云 GeoJSON） | 沙盘轮廓 | 由数据源提供 | 已抽稀为 `frontend/js/data/china-outline.js`，仅用于示意 |
| 地图山脊走向（手工勾勒） | 浮雕地形 | 本项目自制 | `frontend/js/data/ranges.js`，非测绘数据 |
| Live2D 官方示例模型（Hiyori，随 CubismWebSamples 分发） | 开箱可用的**开发/演示**形象 | Live2D Open Software License §5.5：**仅限内部评估与培训** | 位于 `frontend/assets/live2d/model/`；**对外发布前必须替换**，详见 `licenses/Live2D-许可要点.md` |
| 其它 Live2D 模型文件 | 数字人形象 | **由模型作者决定** | 请勿提交来源不明或限制再分发的模型；`.gitignore` 默认忽略 `frontend/assets/live2d/model/*` |
