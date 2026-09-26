# Live2D 许可要点（自查清单）

> 依据：Live2D Open Software License（Cubism SDK / Components，含官方示例）、
> CubismWebSamples 的 LICENSE.md、Cubism SDK Release License 页面。
> 条款原文以官网为准；以下是给工程用的要点，不构成法律意见。

## 1. 会不会收费

| 你的情况 | 是否需要付费授权 |
| --- | --- |
| 个人、学习者、小团队开发与内部演示 | ❌ 不需要 |
| 年营收 **< 1000 万日元**（约 50 万人民币）的主体 | ❌ 不需要 |
| 年营收 **≥ 1000 万日元**的主体使用 Cubism SDK/Components | ✅ 需签署 **Cubism SDK Release License** |
| 应用/内容作为业务主要要素，且由该应用产生的年销售额 **> 2000 万日元** | ✅ 需签署 **Publication License Agreement** |

官方条款：<https://www.live2d.com/en/download/cubism-sdk/release-license/>

## 2. 现在这样用合法吗

**开发和内部演示阶段：合法、免费。** 但有四条硬性限制必须守住：

| 条款 | 内容 | 对本项目的含义 |
| --- | --- | --- |
| §5.5 No Diversion of Sample Material | 官方提供的 **Sample Material 只能用于"内部评估与培训"** | ⚠️ **`Hiyori` 等官方示例模型不能随产品对外发布**，正式上线前必须替换 |
| §5.1 No Modifications | 不得修改 Software，不得删除其中的许可声明 | 不要改动 `live2dcubismcore.global.js`，随附的 `RedistributableFiles.txt` 要保留 |
| §5.6 No Combination with Incompatible License | 不得让"可被第三方修改的源码许可"（如 GPL）覆盖到 SDK 源码部分 | 我们只分发官方的**可再分发代码**（Core 的 .js），未分发 SDK 源码；GPL-3.0 派生代码（Fay 部分）与 Live2D 组件是相互独立的文件 |
| §5.4 No Service Bureau | 不得把 Software 以"服务局"形式提供给未获授权的第三方 | 若将来把平台做成对外 SaaS，需先确认发布授权 |

## 3. 对外发布前要做的事

1. **替换模型**：把 `frontend/assets/live2d/model/` 里的官方示例换成合规模型，三种来源：
   - 自己用 Cubism Editor 制作（注意 Editor FREE/PRO 各自的使用条件）
   - 购买/委托制作，合同中明确**商用、修改、再分发**权利（委托时把
     `docs/参考-Live2D模型制作要求（简化版）（来自Fay）.md` 一起发给对方）
   - 使用明确允许商用的自由素材（逐条读许可，别只看"免费"）
2. **保留声明**：`licenses/` 下的许可文件、`frontend/vendor/live2d/` 的许可与
   `RedistributableFiles.txt` 一并保留；界面保留 "Powered by Live2D" 署名。
3. **判断门槛**：对照第 1 节营收门槛，确认是否需要签 Release License。
4. **商标**：Live2D 名称与 Logo 是商标，展示方式参考官方 Trademarks and Showcase Guide；
   不要暗示与 Live2D Inc. 有官方合作。
5. **模型不要入库**：`.gitignore` 已忽略 `frontend/assets/live2d/model/*`，
   避免把他人的模型文件带进你的公开仓库。

## 4. 本项目其它组件的许可（同样要保留）

| 组件 | 许可 | 义务 |
| --- | --- | --- |
| Fay 派生代码（`frontend/js/fay/*`、`backend/app/services/fay_human.py`） | GPL-3.0 | 分发时保持 GPL-3.0 并提供源码，见 `licenses/Fay-GPL-3.0.txt` |
| pixi.js / pixi-live2d-display | MIT | 保留版权与许可声明 |
| three.js | MIT | 同上 |
| LKH-3.0.14 | 作者声明的学术/科研用途 | 仅本机编译、由后端子进程调用；源码与二进制均不入库 |
