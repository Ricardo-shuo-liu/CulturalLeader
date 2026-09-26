# Cubism 5 资源获取指南（Live2D 模型从哪来）

项目里数字人用的是 **Live2D Cubism** 模型（`.moc3` + `model3.json`），
不是 3D 模型（VRM/glTF），也不是序列帧图片。下面按"最省事 → 最费事"排列。

## A. 直接用官方示例模型（已帮你装好一个）

项目里已经放好官方示例 **Hiyori**（4.7 MB），开箱即用、口型已实测可动：

```
frontend/assets/live2d/model/Hiyori.model3.json  ← config.json 已指向它
```

换其它官方示例（如 `Haru`、`Mao`、`Natori`、`Rice`、`Wanko`）：

```bash
python tools/fetch_live2d_sample.py --name Haru
python tools/check_live2d_model.py
```

脚本会自动从 Live2D 官方 `CubismWebSamples` 仓库按 `model3.json` 的引用关系精确下载，
并改写 `config.json` 指向新模型。也可以直接去官网下载页取：

- 示例数据下载页：<https://www.live2d.com/download/sample-data/>
- Cubism SDK for Web（含 Samples/Resources）：<https://www.live2d.com/download/cubism-sdk/>

> ⚠️ **重要限制**：官方示例模型（Hiyori 等）属 "Sample Material"，
> 按 Live2D Open Software License **§5.5 只能用于内部评估与培训**，
> **不能随产品对外发布**。开发、演示、内部验收都没问题；
> 正式上线前必须换成自己制作或购买/委托的模型（见下面 B、C 两节）。
> 详见 `licenses/Live2D-许可要点.md`。

官方示例的优点是免费、参数规范（`LipSync`/`EyeBlink` 分组齐全、`Idle`+`TapBody` 动作组齐全），
用来验证链路最合适；缺点是形象通用，且按许可不能对外发布。

## B. 用 Cubism Editor 自己做

1. 下载 **Live2D Cubism Editor**（<https://www.live2d.com/download/cubism-editor/>）。
   - **FREE 版**：免费，可导出，但功能与商用条件受限
   - **PRO 版**：42 天免费试用，功能完整
2. 画好分层立绘（PSD，部件分层：头发/眼睛/嘴/身体/衣服…）
3. 在 Editor 里做参数与动作，务必满足：

| 必需项 | 要求 |
| --- | --- |
| Cubism 版本 | Cubism 5 |
| 导出格式 | `.moc3` + `model3.json`（Version 3） |
| 口型参数 | `ParamMouthOpenY`（0 闭嘴 ~ 1 张嘴），并在 model3.json 的 Groups 里声明 `LipSync` |
| 眨眼参数 | `ParamEyeLOpen` / `ParamEyeROpen`，Groups 里声明 `EyeBlink` |
| 头部/身体 | `ParamAngleX/Y/Z`、`ParamBodyAngleX`、`ParamEyeBallX/Y` |
| 动作组 | `Idle`（待机循环，至少 1 个）、`TapBody`（说话/互动动作） |
| 贴图 | 2048×2048，张数不限 |

4. 导出整个目录，按下面"放进项目"三步走。

细节与常见坑见 `docs/参考-Live2D模型制作要求（来自Fay）.md`。

## C. 购买或委托制作

- 平台：**Booth**（日本，Live2D 模型最多）、**淘宝/闲鱼**、B 站画师接单
- 委托时**直接把 `docs/参考-Live2D模型制作要求-简化版（来自Fay）.md` 发给对方**，
  里面写清了必需参数、动作组和"不要给 `ParamMouthOpenY` 打关键帧"这类硬性约束，
  能省掉大量返工
- 价格参考：半身可动模型通常在数百到数千元；全身体、精细表情动作更贵
- 拿到后**先跑 `python tools/check_live2d_model.py`**，不通过就让对方改

## D. 版本兼容性（很重要）

| 你拿到的模型 | 能否直接用 |
| --- | --- |
| Cubism 3 / 4 / 5 导出的 `.moc3`（model3.json v3） | ✅ 可以，本项目就是这条路径 |
| Cubism 2.1 的 `.moc`（旧格式） | ⚠️ 需另接 Cubism 2.1 运行时（`pixi-live2d-display` 的 cubism2 构建），要用告诉我，我加 |
| VRM / glTF 3D 模型 | ❌ 不是一类东西，本项目已不支持（旧实现已删除） |
| 序列帧 GIF / 图片 | ❌ 只能当静态头像，不能做口型 |

## E. 授权要点（务必看）

模型和代码是**两套授权**，必须分别确认：

1. **Live2D 运行时**（Cubism Core 等）：属 Live2D Cubism Components，
   适用 **Live2D Open Software License**；
   **企业年营收 ≥ 1000 万日元（约 50 万人民币）时，必须另外签署 Cubism SDK Release License（发布授权）**。
   条款见 <https://www.live2d.com/en/download/cubism-sdk/release-license/>
2. **模型本身**：官方示例模型**仅限内部评估与培训**（§5.5），发布前必须替换；
   第三方/委托制作的模型，授权由**作者**决定（是否可商用、是否可二次分发、是否可修改）。
   仓库默认不提交模型文件（见 `.gitignore`），避免把别人的模型带进你的公开仓库。
3. 本项目里迁移自 Fay 的数字人驱动代码是 **GPL-3.0**，见 `licenses/Fay-GPL-3.0.txt`。

## F. 放进项目（三步）

```bash
# 1. 模型目录（把 Cubism 导出的整个目录内容拷进来）
frontend/assets/live2d/model/

# 2. 指向它：编辑 frontend/assets/live2d/config.json
#    "model": "model/你的模型.model3.json"

# 3. 校验后刷新页面
python tools/check_live2d_model.py
```

校验通过后强制刷新页面（Ctrl+Shift+R），右下角就会显示形象；说话时嘴会随语音开合（口型由音频包络驱动）。

模型尺寸不用你操心：程序会按模型自身的包围盒自动缩放到画布高度的 92% 并底部居中，
`config.json` 里的 `scale` 只是在此基础上的相对倍数（1.0 就是刚好适配）。
