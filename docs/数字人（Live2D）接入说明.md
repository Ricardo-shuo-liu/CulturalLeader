# 数字人（Live2D）接入说明

本项目的数字人已迁移为 **Fay 风格**：服务端只说"通用动作语义"，形象由前端 Live2D 渲染，
口型由音频包络实时驱动。迁移自 Fay 的两份约定：

- `docs/参考-Live2D模型制作要求（来自Fay）.md` —— 模型必须包含的参数、动作组与分组声明（可直接发给建模师）
- `docs/参考-Live2D模型制作要求-简化版（来自Fay）.md` —— 外包制作时的最小可用版
- Fay 的《标准动作改造说明》—— 服务端只下发 `Action{code,behavior,affect}`，前端映射到具体动作

当前加载链路（顺序不可变，见 `frontend/index.html`）：

```
frontend/vendor/live2d/pixi.min.js                 PixiJS 6.5.10（MIT）
frontend/vendor/live2d/live2dcubismcore.global.js  Live2D Cubism Core（官方许可）
frontend/vendor/live2d/cubism4.min.js              pixi-live2d-display 0.4.0（MIT）
frontend/js/fay/fay_live2d.js                      本项目数字人客户端（Fay 约定迁移）
```

## 一、如何传入形象（3 步）

### 第 1 步：放入模型目录

把 Cubism 5 导出的**整个目录**（不要只拷 model3.json）放到：

```
frontend/assets/live2d/model/
├── 你的模型.model3.json
├── 你的模型.moc3
├── 你的模型.2048/texture_00.png …
├── motions/*.motion3.json
├── physics3.json / pose3.json（可选）
```

### 第 2 步：在配置里指向它

编辑 `frontend/assets/live2d/config.json`：

```json
{
  "enabled": true,
  "model": "model/你的模型.model3.json",
  "scale": 1.0,
  "anchor": [0.5, 1.0],
  "position": [0, 0]
}
```

`model` 是相对于 `frontend/assets/live2d/` 的路径。

### 第 3 步：校验模型

```bash
python tools/check_live2d_model.py
```

会逐项检查：model3 版本、.moc3 与贴图是否齐全、`LipSync`/`EyeBlink` 分组、
`Idle`/`TapBody` 动作组、以及**动作里是否误设了 `ParamMouthOpenY` 关键帧**（会和实时口型冲突）。

重新打开页面即可看到形象；没放模型时右下角会显示同样的操作提示，不会报错。

## 二、模型必须满足的要求（来自 Fay）

| 项目 | 要求 |
| --- | --- |
| Cubism 版本 | Cubism 5（SDK for Web 5-r.x 导出的 moc3） |
| model3.json 版本 | Version 3 |
| 贴图尺寸 | 2048×2048，张数不限 |
| 交付 | .moc3、贴图、motion3.json、physics3.json、（可选）pose3.json |

必需参数（请在 Cubism 编辑器里保留默认命名）：

| 参数 ID | 用途 |
| --- | --- |
| `ParamMouthOpenY` | 口型开合（0 闭嘴 ~ 1 最大），**最关键** |
| `ParamEyeLOpen` / `ParamEyeROpen` | 自动眨眼 |
| `ParamAngleX` / `ParamAngleY` / `ParamAngleZ` | 头部左右/上下/倾斜（呼吸 + 视线跟随） |
| `ParamBodyAngleX` | 身体摇摆 |
| `ParamEyeBallX` / `ParamEyeBallY` | 眼球跟随鼠标 |

model3.json 里必须声明分组（Groups）：

```json
{ "Target": "Parameter", "Name": "LipSync",  "Ids": ["ParamMouthOpenY"] },
{ "Target": "Parameter", "Name": "EyeBlink", "Ids": ["ParamEyeLOpen", "ParamEyeROpen"] }
```

动作组：

| 动作组 | 用途 |
| --- | --- |
| `Idle` | 待机循环（至少 1 个） |
| `TapBody` | 说话/互动动作，程序按配置调用 |

**重要**：动作与表情里不要给 `ParamMouthOpenY` 打关键帧，该参数由程序独占。

## 三、配置项说明（frontend/assets/live2d/config.json）

| 字段 | 说明 |
| --- | --- |
| `enabled` | false 时关闭数字人（只显示提示卡） |
| `model` | model3.json 相对路径 |
| `scale` | **相对倍数：1.0 = 自动按画布高度适配**（模型自身像素尺寸很大，程序会先算好适配比例，再乘这个倍数） |
| `position` | 在"底部居中"基础上的微调，单位像素，`[x, y]` |
| `anchor` | 兼容字段（模型的变换原点本来就是底边中心，一般不用改） |
| `lipSync.groupId` | 口型分组名，默认 `LipSync` |
| `lipSync.parameter` | 口型参数，默认 `ParamMouthOpenY` |
| `lipSync.volume` | 口型幅度系数，觉得嘴张太大/太小就调它 |
| `lipSync.minOpen` / `maxOpen` | 张口区间映射（默认 0~1） |
| `eyeBlink.groupId` | 眨眼分组名，默认 `EyeBlink` |
| `motions.idle` | 待机动作 `{group,index}` |
| `motions.speak` | 说话时播放的动作，`index: null` 表示随机 |
| `motions.greet` | 打招呼动作 |
| `expressions` | 表情名映射（`happy` / `neutral`，留空表示不用） |
| `actions` | **通用动作语义 → 动作/表情** 的映射表，键是服务端下发的 `code` 或 `behavior` |
| `night.brightness` / `saturation` | 夜间调光（按沙盘昼夜自动应用） |

服务端下发的动作语义形如：

```json
{ "code": "guidance.invite", "behavior": "invite", "affect": "warm" }
```

默认映射（可在 `actions` 里覆盖）：`greeting → greet/happy`、`guidance.invite → speak/happy`、
`speak.explain → speak/neutral`。换模型时只改映射表，不用动服务端。

## 四、功能是怎么驱动的

| 功能 | 驱动来源 |
| --- | --- |
| 口型 | 音频包络（TTS 或浏览器语音的实时音量）→ `ParamMouthOpenY`，每帧平滑 |
| 说话动作 | 开始播报时播放 `motions.speak`，播报结束回到 `Idle` |
| 眨眼 | 由 SDK 读取 `EyeBlink` 分组自动完成 |
| 视线跟随 | 鼠标移动 → `model.focus(x, y)` |
| 通用动作语义 | 后端 SSE 的 `event: human`（Fay 的 `Topic=human` 结构）→ `actions` 映射 |
| 夜间调光 | 沙盘的太阳高度角 → 容器 CSS 亮度/饱和度 |

后端消息格式（与 Fay 一致，见 `backend/app/services/fay_human.py`）：

```json
{
  "Topic": "human",
  "Data": {
    "Key": "audio", "Text": "这边请", "Index": 0,
    "HttpValue": "/api/tts?text=...&index=0",
    "IsFirst": 1, "IsEnd": 0, "Lips": [],
    "Sentiment": null,
    "Action": { "code": "guidance.invite", "behavior": "invite", "affect": "warm" }
  }
}
```

配置了 `OPENAI_API_KEY` 时 `HttpValue` 是可直接播放的音频地址（Fay 的用法）；
未配置时为空，前端改用浏览器语音合成，口型仍由音量包络驱动。

## 五、常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 右下角一直显示"还没有放入 Live2D 形象" | 模型路径不对，或目录里没有 model3.json |
| 提示"Live2D 模型加载失败" | 多半是贴图或 .moc3 缺失；跑 `tools/check_live2d_model.py` |
| 形象加载了但嘴不动 | 模型缺少 `LipSync` 分组或 `ParamMouthOpenY`；或动作里对该参数打了关键帧 |
| 不眨眼 | 缺少 `EyeBlink` 分组；校验脚本会给出 WARN |
| 说话时没有动作 | 缺少 `TapBody` 动作组，或 `config.json` 的 `motions.speak` 指错 |
| 形象过大/过小、位置不对 | 调 `scale`（1.0=自适应高度）与 `position`（像素微调） |
| 右下角看不到形象，但日志里贴图是 200 | 先强制刷新（Ctrl+Shift+R）清浏览器缓存；再运行 `python tools/check_live2d_model.py`。程序会自动把模型按画布高度适配并底部居中 |
| 口型幅度不合适 | 调 `lipSync.volume`（或 `minOpen`/`maxOpen`） |
| 完全不想用数字人 | `config.json` 里 `enabled: false` |

## 六、许可

- 本目录的数字人驱动逻辑迁移自 **Fay**（GPL-3.0），派生部分继续遵循 GPL-3.0，见 `Fay/LICENSE`。
- `pixi.min.js`（MIT）、`cubism4.min.js`（MIT）许可见 `frontend/vendor/live2d/`。
- `live2dcubismcore.global.js` 为 Live2D 官方 Core，属"Redistributable Code"，
  使用需遵守 Live2D 的许可条款（见 `frontend/vendor/live2d/RedistributableFiles.txt`）。
- **模型本身**的授权由模型作者决定（Live2D 官方示例模型也有各自使用条款），请单独确认。
