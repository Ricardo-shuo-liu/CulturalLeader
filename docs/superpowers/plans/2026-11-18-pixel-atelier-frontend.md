# 像素造境前端与洛阳入画 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在主界面加入「造境」入口与全屏画室（SSE 进度、预览、下载），打开洛阳时加入「入画」卡与浮层，并进入龙门 demo；同时整理主界面按钮与响应式布局。

**Architecture:** 新 `frontend/js/atelier.js` 负责画室状态与 SSE；`index.html` 增加画室、入画浮层、demo iframe 与入口按钮；`frontend/css/atelier.css` 沿用现有纸/墨/金/朱砂 tokens；`main.js` 只做接线与洛阳路由，`ui.js` 负责面板内入画卡显隐。

**Tech Stack:** 原生 ES modules、fetch ReadableStream、DOM/CSS、现有 FastAPI 静态服务、Chrome CDP 验收。

**Spec:** `docs/superpowers/specs/2026-11-18-pixel-atelier-design.md`

## Global Constraints

- 视觉 tokens 只用现有 `--paper`、`--ink`、`--gold`、`--seal`、`--hairline` 等；不引入霓虹或新配色体系。
- 造境入口与导航并排，保持印章风格；城市面板头部按钮不换行。
- 画室全屏浮层，不遮挡或改变地图相机/Live2D 位置。
- 洛阳入画只在用户显式打开洛阳时触发；本会话只自动弹一次；其他城市不显示入画卡。
- demo 使用同源 iframe `/demo/longmen_park.html`；关闭时清空 `src`，停止游戏循环。
- 提示词最多 200 字；生成中禁用按钮；错误可重试。
- 1440×900 与 390×844 均无横向溢出；Esc/关闭可用。
- 不自动 commit；只有用户明确要求时才提交。

## Review Focus

1. **生成失败/网络中断**：画室出现可读错误并恢复「生成」按钮，不留下半透明 loading。测试在 Task 2 的浏览器断言。
2. **SSE 事件顺序/重复事件**：步骤不会回退，done 后预览与三个下载链接都可用。测试在 Task 2。
3. **窄屏/移动端**：画室、洛阳浮层、面板头部不横向溢出，按钮不换行。测试在 Task 4。
4. **iframe 关闭**：关闭 demo 后 `src` 为空；再次打开能重新加载。测试在 Task 3。
5. **非洛阳城市**：打开北京/西安时 `#panel-luoyang` 必须隐藏，入画浮层不出现。测试在 Task 3。

---

## DOM Contract

所有任务共用以下 ID，不得改名：

- 画室：`#atelier`、`#atelier-close`、`#atelier-open`、`#atelier-open-drawer`、`#atelier-prompt`、`#atelier-examples`、`#atelier-generate`、`#atelier-chat`、`#atelier-steps`（每项 `li[data-step]`）、`#atelier-sources`、`#atelier-error`、`#atelier-empty`、`#atelier-image`、`#atelier-loading`、`#atelier-meta`、`#atelier-actions`、`#atelier-download-scene`、`#atelier-download-postcard`、`#atelier-download-zip`、`#atelier-again`、`#atelier-refine-row`、`#atelier-refine`、`#atelier-refine-go`
- 洛阳：`#panel-luoyang`、`#panel-luoyang-enter`、`#luoyang-intro`、`#li-enter`、`#li-stay`、`#li-close`、`#li-silent`、`#pixel-stage`、`#pixel-stage-frame`、`#pixel-stage-close`、`#pixel-stage-new`
- 面板：`#panel`、`#panel-close`、`#panel-millennium`、`#panel-plan`、`#panel-summary`

## File Structure

```
frontend/index.html          + 造境按钮 / 画室 / 洛阳入画卡 / 入画浮层 / demo 浮层 / CSS link
frontend/css/atelier.css     + 全部新样式与面板头部修正
frontend/js/atelier.js       + createAtelier / SSE / 进度 / 预览 / 下载
frontend/js/main.js          + import、入口接线、洛阳入画、iframe 控制
frontend/js/ui.js            + setLuoyangEntry(city)
tools/qa_atelier.js          + CDP 验收脚本（Task 4）
```

---

### Task 1: 画室外壳、入口按钮与面板头部整理

**Files:**
- Create: `frontend/css/atelier.css`
- Create: `frontend/js/atelier.js`（先实现 open/close 与示例 chip）
- Modify: `frontend/index.html`
- Modify: `frontend/js/main.js`
- Modify: `frontend/js/ui.js`

**Interfaces:**
- Produces: `createAtelier({ onOpen, onClose }) -> { open, close, isOpen, generate, debug }`
- Produces: `ui.setLuoyangEntry(show: boolean) -> void`
- DOM IDs: `#atelier`, `#atelier-close`, `#atelier-open`, `#atelier-open-drawer`, `#atelier-prompt`, `#atelier-examples`, `#atelier-generate`, `#panel-luoyang`

- [ ] **Step 1: 写浏览器失败断言**

用静态服务打开主界面（后端启动方式见 Task 4），在 DevTools/CDP 执行：

```js
({
  button: !!document.querySelector('#atelier-open'),
  overlay: !!document.querySelector('#atelier'),
  hidden: document.querySelector('#atelier')?.classList.contains('hidden'),
  panelActionsWrap: (() => {
    const box = document.querySelector('.panel-head-actions');
    return box ? getComputedStyle(box).flexWrap : null;
  })(),
})
```

Expected: `button=false`、`overlay=false`；实现后 `hidden=true`、`wrap='nowrap'`。

- [ ] **Step 2: 实现 HTML**

- `head` 的 `theme.css` 之后加 `<link rel="stylesheet" href="/css/atelier.css" />`。
- 在 `#nav-toggle` 后加：

```html
<button id="atelier-open" class="atelier-toggle" type="button" title="一句话生成像素场景">造境</button>
```

- 抽屉「工具」区加：

```html
<button id="atelier-open-drawer" class="drawer-btn primary" type="button">像素造境（一句话生成）</button>
```

- 城市面板 header 后、`#panel-summary` 前加入画卡：

```html
<section id="panel-luoyang" class="panel-luoyang hidden" aria-label="像素龙门">
  <div class="pl-art" aria-hidden="true"></div>
  <div class="pl-copy">
    <span class="pl-kicker">PIXEL LUOYANG</span>
    <strong>龙门石窟 · 伊水公园</strong>
    <p>沿着伊水东岸走一趟，把五处景点盖成一枚朱砂印。</p>
    <button id="panel-luoyang-enter" class="primary" type="button">进入像素龙门</button>
  </div>
</section>
```

- 面板头按钮改为：

```html
<button id="panel-millennium" class="ghost-btn" type="button" title="锁定这座城市，看它两千年的样子">千年</button>
<button id="panel-plan" class="ghost-btn" type="button" title="进入这座城市的流程编辑">规划</button>
<button id="panel-close" class="ghost-btn panel-close" type="button" title="合拢幕布" aria-label="合拢幕布">✕</button>
```

- 在 `#movie-modal` 前后加入画室浮层（结构见设计稿 §5.2；所有 ID 与 Interfaces 一致）。

- [ ] **Step 3: 实现 CSS 骨架**

`atelier.css` 至少包含：

```css
.atelier-toggle {
  position: fixed; left: 158px; top: 26px; z-index: 27;
  padding: 8px 14px 9px; border-radius: 2px;
  border: 1px solid rgba(216, 180, 106, 0.7);
  background: rgba(216, 180, 106, 0.12);
  color: #f0dfc4; font-family: var(--serif); font-size: 14px;
  letter-spacing: 4px; cursor: pointer;
}
.atelier-toggle:hover { background: rgba(216, 180, 106, 0.24); border-color: var(--gold); }
#panel .panel-head-actions { flex-wrap: nowrap; }
#panel .panel-head-actions .ghost-btn { white-space: nowrap; padding: 7px 10px; font-size: 12.5px; }
#panel .panel-close { width: 30px; padding: 6px 0; }
#atelier { position: fixed; inset: 0; z-index: 75; display: grid; place-items: center;
  padding: 4vh 4vw; background: rgba(4, 8, 10, 0.78); backdrop-filter: blur(8px); }
#atelier.hidden { display: none; }
.atelier-shell { width: min(1240px, 94vw); height: min(820px, 90vh); display: flex;
  flex-direction: column; border: 1px solid var(--hairline-strong);
  background: linear-gradient(180deg, rgba(15, 22, 26, 0.98), rgba(10, 16, 20, 0.98));
  border-radius: 4px; box-shadow: var(--shadow-card); overflow: hidden; }
.atelier-body { flex: 1; display: grid; grid-template-columns: 380px 1fr; min-height: 0; }
.atelier-side { padding: 18px 20px; overflow-y: auto; border-right: 1px solid var(--hairline); }
.atelier-preview { padding: 18px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.atelier-frame { aspect-ratio: 16 / 9; border: 1px solid var(--hairline-strong);
  background: #0a1014; display: grid; place-items: center; position: relative; overflow: hidden; }
#atelier-image { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
.panel-luoyang { display: grid; grid-template-columns: 96px 1fr; gap: 12px; padding: 10px;
  border: 1px solid var(--hairline); background: rgba(9, 15, 19, 0.55); }
.panel-luoyang.hidden { display: none; }
.pl-art { background: url('/demo/assets-v2/backgrounds/bg_fengxian_niche.png') center / cover; min-height: 96px; }
```

补齐画室标题、输入、示例 chip、步骤列表、预览、下载按钮、洛阳卡与浮层的样式；移动端在 `@media (max-width: 980px)` 把 `.atelier-body` 改成单列、预览排在上方、浮层高度 `94vh`。

- [ ] **Step 4: 实现 JS 外壳**

`frontend/js/atelier.js`：

```js
export function createAtelier({ onOpen, onClose } = {}) {
  const root = document.getElementById('atelier');
  const prompt = document.getElementById('atelier-prompt');
  const examples = document.getElementById('atelier-examples');
  const state = { open: false, busy: false, lastPrompt: '', lastResult: null };
  function open() { ... }   // 显示、focus、onOpen
  function close() { ... }  // 隐藏、onClose
  function isOpen() { return state.open; }
  async function generate(text, options = {}) { /* Task 2 */ }
  function debug() { return { ...state }; }
  // 示例 chip、关闭按钮、Esc、点击背景关闭
  return { open, close, isOpen, generate, debug };
}
```

- 示例数组：洛阳龙门、苏州水乡、西安城墙、上海外滩；点击填入 textarea。
- 关闭按钮、Esc、点击 `#atelier` 背景关闭；点击 `.atelier-shell` 不关闭。
- `main.js`：`import { createAtelier } from './atelier.js';`；在 `ui` 创建后创建 `const atelier = createAtelier({ onOpen: () => toggleDrawer(false) });`；`window.__atelier = atelier;`；接线 `#atelier-open` 与 `#atelier-open-drawer`。
- `ui.js`：加 `setLuoyangEntry(show)`，在 `showPanel(city)` 中调用 `setLuoyangEntry(city.slug === 'luoyang')`；`hidePanel` 不强制隐藏卡片（面板整体隐藏即可）。

- [ ] **Step 5: 浏览器验证**

打开主界面，执行：

```js
document.querySelector('#atelier-open').click();
JSON.stringify({
  open: !document.querySelector('#atelier').classList.contains('hidden'),
  promptFocused: document.activeElement?.id === 'atelier-prompt',
  wrap: getComputedStyle(document.querySelector('.panel-head-actions')).flexWrap,
})
```

Expected: `open=true`、`promptFocused=true`、`wrap='nowrap'`；截图保存，检查按钮成一排、画室布局完整。

---

### Task 2: 画室 SSE、时间线、预览与下载

**Files:**
- Modify: `frontend/js/atelier.js`
- Modify: `frontend/css/atelier.css`
- Test: 浏览器断言 + 截图

**Interfaces:**
- `generate(prompt: string, { seed?: number, refine?: boolean } = {}) -> Promise<void>`
- 解析后端事件：`stage`、`source`、`progress`、`done`、`error`
- 步骤 key：`intent` / `search` / `skill` / `plan` / `render` / `validate`
- 结果字段：`job_id`、`title`、`subtitle`、`scene`、`postcard`、`zip`、`spec`、`validation`

- [ ] **Step 1: 写失败断言**

在浏览器中打开画室，填入「洛阳龙门石窟，黄昏」，点击生成；监听 `window.__atelier.debug()` 与 DOM。断言：

```js
JSON.stringify({
  busy: __atelier.debug().busy,
  steps: [...document.querySelectorAll('#atelier-steps li')].map(li => li.dataset.state),
  image: !document.querySelector('#atelier-image').classList.contains('hidden'),
  links: ['scene','postcard','zip'].map(k => document.querySelector(`#atelier-download-${k}`).getAttribute('href')),
})
```

Expected 实现前：`busy` 不变化、事件缺失；实现后：生成中 `busy=true`，步骤从 `pending/active` 推进到 `done`，完成后图片可见，三个链接都以 `/api/atelier/files/` 开头。

- [ ] **Step 2: 实现 SSE**

- `fetch('/api/atelier/stream', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ prompt, seed }) })`。
- `response.ok` 为 false 时读 `response.json()` 的 `detail`，显示错误并恢复按钮。
- 用 `TextDecoder` + 按 `\n\n` 切块解析 `event:`/`data:`；忽略空块；`JSON.parse(data)`。
- `stage`：`setStep(key, status, detail)`；`status` 为 `active/done/error`；`label` 作为步骤文字；`tool` 显示在 `em`。
- `progress`：更新 `render` 步骤的 `em` 为 `${percent}% · ${detail}`；不倒退（若 percent 小于当前值则忽略）。
- `source`：在 `#atelier-sources` 追加 `<a>`，最多 3 条。
- `done`：设置 `#atelier-image.src`、`#atelier-meta`（标题/副标题/色板/尺寸/校验）、三个下载链接；显示 actions 与 refine 行；`state.lastResult = data`；busy=false；按钮恢复。
- `error`：显示 `#atelier-error`，清 loading，busy=false；步骤当前项标 error。
- 生成中清空旧图片/链接/错误；首次生成前隐藏 actions。
- 增加一行对话式反馈：生成时在 `#atelier-chat` 加用户气泡；`plan` 完成时加助手气泡「好，画一幅『{title}』」。
- 「再画一张」：用 `state.lastPrompt` + 新随机 seed 调 `generate`。
- 「继续润色」：`prompt = `${state.lastPrompt}，${refineText}``，调用 generate；按钮在 busy 时禁用。
- 所有文本用 `textContent`，不拼 HTML。

- [ ] **Step 3: 浏览器验证成功态**

启动 mock 后端（见 Task 4），生成「洛阳龙门石窟，黄昏」；断言：

```js
JSON.stringify({
  busy: __atelier.debug().busy,
  doneSteps: [...document.querySelectorAll('#atelier-steps li[data-state="done"]')].map(li => li.dataset.step),
  imageOk: document.querySelector('#atelier-image').complete && document.querySelector('#atelier-image').naturalWidth > 0,
  scene: document.querySelector('#atelier-download-scene').href,
  postcard: document.querySelector('#atelier-download-postcard').href,
  zip: document.querySelector('#atelier-download-zip').href,
})
```

Expected: `busy=false`，`doneSteps` 含 `intent/search/skill/plan/render/validate`，`imageOk=true`，三个链接都可用。再点击一次下载链接（或 `fetch` HEAD）确认 200。

- [ ] **Step 4: 验证错误态**

临时把 `fetch` 改成返回 500（或在 DevTools 拦截 `/api/atelier/stream`），点击生成；断言 `#atelier-error` 文案非空、`#atelier-generate.disabled === false`、loading 隐藏。

---

### Task 3: 洛阳入画卡、入画浮层与 demo iframe

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/css/atelier.css`
- Modify: `frontend/js/main.js`
- Modify: `frontend/js/ui.js`
- Test: 浏览器断言 + 截图

**Interfaces:**
- DOM IDs：`#panel-luoyang`、`#panel-luoyang-enter`、`#luoyang-intro`、`#li-enter`、`#li-stay`、`#li-close`、`#li-silent`、`#pixel-stage`、`#pixel-stage-frame`、`#pixel-stage-close`、`#pixel-stage-new`
- sessionStorage key：`cl.luoyangIntro`，值 `seen`
- 函数：`maybeShowLuoyangIntro(slug: string)`、`openPixelStage()`、`closePixelStage()`

- [ ] **Step 1: 写失败断言**

在主界面执行：

```js
__cl.openCity('luoyang');
setTimeout(() => {
  console.log(JSON.stringify({
    card: !document.querySelector('#panel-luoyang').classList.contains('hidden'),
    intro: !document.querySelector('#luoyang-intro').classList.contains('hidden'),
  }));
}, 900);
```

Expected 实现前：`card=false`、`intro=false`；实现后：`card=true`、首次 `intro=true`。

- [ ] **Step 2: 添加入画浮层与 demo 浮层 HTML**

- `#luoyang-intro` 结构见设计稿 §5.1：`li-art` 用 `/demo/assets-v2/backgrounds/bg_fengxian_niche.png` 做背景；标题、描述、两个按钮、复选框。
- `#pixel-stage`：顶部条 + iframe + 关闭 + 新窗口链接。
- 两个浮层默认 `hidden`；`#pixel-stage` 的 iframe 初始 `src` 为空。

- [ ] **Step 3: 实现 CSS 与交互**

- `#luoyang-intro`：固定全屏，z-index 80，墨色幕布；卡片 max-width 720px；`.li-art` 16:9 背景图，深色渐变；按钮一行。
- `#pixel-stage`：固定 inset 0，z-index 90，背景 #05090c；顶部 48px 工具栏；iframe `width:100%; height:calc(100% - 48px); border:0; background:#08131c;`。
- `body.pixel-mode` 隐藏主页面滚动/选择，避免 iframe 外交互。
- `main.js`：
  - `ui.showPanel(city)` 已经调用 `setLuoyangEntry`。
  - `openCity` 在 `ui.showPanel(city)` 后调用 `maybeShowLuoyangIntro(city.slug)`。
  - `maybeShowLuoyangIntro(slug)`：`slug !== 'luoyang'` 直接返回；`sessionStorage.getItem('cl.luoyangIntro') === 'seen'` 返回；`setTimeout(..., 600)` 显示。
  - 关闭/留在沙盘：隐藏；若 `#li-silent.checked` 则设置 `seen`。
  - 进入：设置 `seen`；隐藏入画浮层；`openPixelStage()`。
  - `openPixelStage`：`document.body.classList.add('pixel-mode')`；`#pixel-stage-frame.src = '/demo/longmen_park.html'`；显示浮层。
  - `closePixelStage`：`iframe.src = 'about:blank'` 再设为空；隐藏；移除 `pixel-mode`。
  - Esc：若 `#pixel-stage` 可见，关闭；否则若 `#luoyang-intro` 可见，隐藏；否则原有逻辑。
  - `#panel-luoyang-enter` 点击 `openPixelStage()`。
- `ui.js` 的 `setLuoyangEntry(show)` 只切换 `#panel-luoyang` 的 `hidden`。

- [ ] **Step 4: 浏览器验证**

断言：

```js
// 0) 清掉上一次 QA 留下的会话标记
sessionStorage.removeItem('cl.luoyangIntro');

// 1) 洛阳
__cl.openCity('luoyang');
setTimeout(() => {
  console.log(JSON.stringify({
    card: !document.querySelector('#panel-luoyang').classList.contains('hidden'),
    intro: !document.querySelector('#luoyang-intro').classList.contains('hidden'),
  }));
  document.querySelector('#li-enter').click();
  setTimeout(() => console.log(JSON.stringify({
    stage: !document.querySelector('#pixel-stage').classList.contains('hidden'),
    src: document.querySelector('#pixel-stage-frame').getAttribute('src'),
  })), 400);
}, 900);

// 2) 关闭
document.querySelector('#pixel-stage-close').click();
JSON.stringify({
  stage: document.querySelector('#pixel-stage').classList.contains('hidden'),
  src: document.querySelector('#pixel-stage-frame').getAttribute('src'),
})

// 3) 非洛阳
__cl.closeCity(); __cl.openCity('beijing');
setTimeout(() => JSON.stringify({
  card: document.querySelector('#panel-luoyang').classList.contains('hidden'),
  intro: document.querySelector('#luoyang-intro').classList.contains('hidden'),
}), 900)
```

Expected: 洛阳 `card=true`、首次 `intro=true`；进入后 `stage=true`、`src='/demo/longmen_park.html'`；关闭后 `stage=true`（hidden）、`src` 为空；北京 `card` hidden、`intro` hidden。

- [ ] **Step 5: 检查 iframe 内容**

在 demo iframe 内确认 `document.querySelector('#game')` 存在、`window.__lm` 可访问；截图检查龙门场景正常加载、无 404（favicon 除外）。

---

### Task 4: 视觉整理、响应式与整体 QA

**Files:**
- Modify: `frontend/css/atelier.css`
- Create: `tools/qa_atelier.js`
- Modify: `docs/`（如需补充实现说明，可选）

**Interfaces:**
- QA debug：`window.__atelier.debug()`、`window.__cl.openCity`、`window.__cl.closeCity`
- 移动断点：`@media (max-width: 980px)`、`@media (max-width: 640px)`

- [ ] **Step 1: 视觉整理**

- 检查 `#panel .panel-head-actions` 三个按钮在 430px 面板内不换行；`#panel-plan` 文案缩短为「规划」；`#panel-close` 为 30px 方形。
- 左上角 `导航`/`造境` 两个按钮同高（约 36px）、同字体、间距 8–10px；造境为金色描边。
- 造境浮层：标题、输入、步骤、预览、下载在 1440×900 下不滚动出界；步骤文字与 `em` 细节不重叠。
- 洛阳入画卡：96px 封面 + 文案；面板 430px 宽时按钮不溢出。
- 洛阳浮层：卡片居中，按钮一行；390px 宽时卡片宽度 92vw、按钮可换行。
- demo 浮层：顶部工具栏在窄屏不换行，标题可截断；iframe 占满剩余高度。
- 在 `body.intro-mode`、`body.movie-mode` 下隐藏 `.atelier-toggle`；千年/穿越模式可打开画室。
- 统一 focus-visible：`.atelier-toggle:focus-visible`、`.atelier-download:focus-visible`、画室按钮 2px 金色 outline。

- [ ] **Step 2: 创建 CDP QA 脚本**

`tools/qa_atelier.js`（Node 18+，使用内置 `http` 与 `WebSocket`）：
- 连接 `http://127.0.0.1:9223/json` 的 page。
- 导航到 `http://127.0.0.1:8001/?intro=0&live=0`。
- 执行断言：主界面、画室开关、生成完成、洛阳入画、demo iframe、非洛阳隐藏；开始前清空 `sessionStorage.cl.luoyangIntro`。
- 截图保存到 `/tmp/qa_atelier_*.png`。
- 检查 console error（忽略 favicon 404）；退出码非 0 表示失败。
- 脚本里不硬编码用户路径；Chrome 启动命令写在 README/计划里。

- [ ] **Step 3: 启动 mock 后端并跑 QA**

```bash
cd /home/ricaedo/CulturalLeader
MOCK_MODE=on ATELIER_DIR=/tmp/cl-atelier-qa \
  /home/ricaedo/下载/yes/envs/leader/bin/python -m uvicorn backend.app.main:app \
  --host 127.0.0.1 --port 8001
```

另开一个终端：

```bash
google-chrome --headless=new --no-sandbox --hide-scrollbars \
  --window-size=1440,900 --remote-debugging-port=9223 \
  --user-data-dir=/tmp/cl-qa-profile \
  --use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader \
  about:blank
node tools/qa_atelier.js
```

Expected: 退出码 0；截图显示主界面、画室完成态、洛阳入画、demo 场景。

- [ ] **Step 4: 移动端截图**

用 CDP `Emulation.setDeviceMetricsOverride { width:390, height:844, mobile:true }`，重新加载：
- 主界面无横向滚动（`document.body.scrollWidth === 390`）。
- 造境浮层可滚动，预览不溢出。
- 洛阳浮层可关闭，按钮可见。
- 截图保存并人工检查。

- [ ] **Step 5: 回归现有交互**

- 打开北京 → 面板显示、按钮一行、无入画卡。
- 城市面板对话发送 → 现有 SSE 仍工作（mock 下可有本地回答）。
- 关闭城市 → 面板隐藏。
- 打开导航抽屉 → 造境入口在工具区可点。
- 不打开洛阳时页面无 `#luoyang-intro` 可见。
- 控制台无新增 error（favicon 404 除外）。

---

## 完成标准

- 造境按钮与画室可用；生成进度真实；三种下载可用。
- 洛阳入画卡/浮层/demo iframe 正常，且只对洛阳出现。
- 1440×900 与 390×844 无横向溢出；面板头按钮不换行。
- 原有城市、对话、导航交互无回归。
- 不自动提交；完成后把截图、验证命令与改动清单交给用户。
