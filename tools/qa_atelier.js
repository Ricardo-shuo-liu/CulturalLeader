#!/usr/bin/env node
/**
 * 像素造境 / 洛阳入画 的 CDP 验收脚本。
 *
 * 前置：
 *   MOCK_MODE=on ATELIER_DIR=/tmp/cl-atelier-qa \
 *     /path/to/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8001
 *   google-chrome --headless=new --no-sandbox --hide-scrollbars \
 *     --window-size=1440,900 --remote-debugging-port=9223 --user-data-dir=/tmp/cl-qa-profile \
 *     --use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader about:blank
 *
 * 运行：node tools/qa_atelier.js
 * 可用环境变量：QA_BASE_URL（默认 http://127.0.0.1:8001）、QA_CDP_PORT（默认 9223）
 */

const http = require('http');

const BASE = process.env.QA_BASE_URL || 'http://127.0.0.1:8001';
const CDP_PORT = Number(process.env.QA_CDP_PORT || 9223);
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const failures = [];
const consoleIssues = [];
const networkIssues = [];

function getJson(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: CDP_PORT, path }, (response) => {
        let data = '';
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) failures.push(message);
}

async function main() {
  const targets = await getJson('/json');
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('没有可用的 Chrome page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => (ws.onopen = resolve));

  let id = 0;
  const pending = new Map();
  const requestUrls = new Map();

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
      return;
    }
    if (message.method === 'Network.requestWillBeSent') {
      requestUrls.set(message.params.requestId, message.params.request.url);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleIssues.push('EXCEPTION ' + JSON.stringify(message.params.exceptionDetails).slice(0, 240));
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      const text = message.params.entry.text || '';
      if (!/favicon|ERR_FILE_NOT_FOUND|ERR_ABORTED/.test(text)) consoleIssues.push('LOG ' + text.slice(0, 240));
    }
    if (message.method === 'Network.responseReceived') {
      const { response } = message.params;
      if (response.status >= 400 && !/favicon/.test(response.url)) {
        networkIssues.push(`${response.status} ${response.url}`);
      }
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const callId = ++id;
      pending.set(callId, { resolve, reject });
      ws.send(JSON.stringify({ id: callId, method, params }));
    });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return result.result ? result.result.value : undefined;
  };

  const shot = async (name) => {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync(`/tmp/${name}.png`, Buffer.from(result.data, 'base64'));
  };

  const click = async (selector) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)})?.click(); undefined`);
  };

  const waitFor = async (expression, timeout = 12000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await evaluate(expression)) return true;
      await sleep(200);
    }
    return false;
  };

  const navigate = async (suffix = '') => {
    await send('Page.navigate', { url: `${BASE}/?intro=0&live=0&qa=${Date.now()}${suffix}` });
    await sleep(5000);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { ...DESKTOP, deviceScaleFactor: 1, mobile: false });

  await navigate('&mode=desktop');
  assert(await evaluate('document.body.scrollWidth <= window.innerWidth + 1'), '桌面主界面出现横向滚动');
  assert(await evaluate('!!document.querySelector("#nav-toggle") && !!document.querySelector("#atelier-open")'), '主界面入口按钮缺失');
  assert(await evaluate('document.querySelector("#atelier").classList.contains("hidden")'), '造境浮层初始应隐藏');
  assert((await evaluate('getComputedStyle(document.querySelector(".panel-head-actions")).flexWrap')) === 'nowrap', '城市面板头按钮没有 nowrap');
  await shot('qa_desktop_home');

  await click('#atelier-open');
  await sleep(250);
  assert(await evaluate('!document.querySelector("#atelier").classList.contains("hidden")'), '造境浮层没有打开');
  assert((await evaluate('document.activeElement?.id')) === 'atelier-prompt', '打开画室后输入框没有聚焦');
  await evaluate(
    'document.querySelector("#atelier-prompt").value="洛阳龙门石窟，黄昏，伊水与崖壁大佛"; document.querySelector("#atelier-generate").click(); undefined',
  );
  const generated = await waitFor('!window.__atelier.debug().busy && !!window.__atelier.debug().lastResult', 15000);
  assert(generated, '造境在 15 秒内没有完成');
  assert(
    (await evaluate('[...document.querySelectorAll("#atelier-steps li[data-state=done]")].length')) >= 6,
    '造境步骤未全部完成',
  );
  const imageReady = await waitFor(
    '(()=>{const i=document.querySelector("#atelier-image");return !i.classList.contains("hidden")&&i.complete&&i.naturalWidth>0})()',
    6000,
  );
  assert(imageReady, '造境预览图未加载');
  assert(
    await evaluate(
      '["scene","postcard","zip"].every(k=>{const a=document.querySelector(`#atelier-download-${k}`);return a&&a.getAttribute("href")?.startsWith("/api/atelier/files/")})',
    ),
    '造境下载链接缺失',
  );
  await shot('qa_desktop_atelier');
  await click('#atelier-close');
  await sleep(200);

  await evaluate('sessionStorage.removeItem("cl.luoyangIntro"); __cl.openCity("luoyang"); undefined');
  await sleep(1300);
  assert(await evaluate('!document.querySelector("#panel-luoyang").classList.contains("hidden")'), '洛阳入画卡没有显示');
  assert(await evaluate('!document.querySelector("#luoyang-intro").classList.contains("hidden")'), '洛阳入画浮层没有出现');
  assert(
    (await evaluate('document.querySelector("#panel-millennium").getBoundingClientRect().height')) < 36,
    '面板头按钮发生换行',
  );
  await shot('qa_desktop_luoyang');

  await click('#li-enter');
  await sleep(2800);
  assert(await evaluate('!document.querySelector("#pixel-stage").classList.contains("hidden")'), 'demo 浮层没有打开');
  assert(
    (await evaluate('document.querySelector("#pixel-stage-frame").getAttribute("src")')) === '/demo/longmen_park.html',
    'demo iframe 地址不正确',
  );
  assert(
    await evaluate('!!document.querySelector("#pixel-stage-frame").contentDocument?.querySelector("#game")'),
    'demo iframe 没有加载出游戏画布',
  );
  await shot('qa_desktop_demo');
  await click('#pixel-stage-close');
  await sleep(300);
  assert(await evaluate('document.querySelector("#pixel-stage").classList.contains("hidden")'), 'demo 浮层没有关闭');
  assert(
    await evaluate('!document.querySelector("#pixel-stage-frame").getAttribute("src")'),
    '关闭 demo 后 iframe src 没有清空',
  );

  await evaluate('__cl.closeCity(); __cl.openCity("beijing"); undefined');
  await sleep(1100);
  assert(await evaluate('document.querySelector("#panel").classList.contains("show")'), '北京城市面板没有打开');
  assert((await evaluate('document.querySelector("#panel-name").textContent')) === '北京', '北京面板标题不正确');
  assert(await evaluate('document.querySelector("#panel-luoyang").classList.contains("hidden")'), '北京面板出现了洛阳入画卡');
  assert(await evaluate('document.querySelector("#luoyang-intro").classList.contains("hidden")'), '北京页面出现了洛阳入画浮层');
  const chatOk = await evaluate(
    `(async()=>{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({city_slug:'beijing',message:'你好'})});const t=await r.text();return r.ok&&t.includes('event: done')})()`,
  );
  assert(chatOk, '现有城市对话 SSE 接口异常');
  await click('#nav-toggle');
  await sleep(350);
  assert(await evaluate('document.querySelector("#drawer").classList.contains("open")'), '导航抽屉没有打开');
  await click('#atelier-open-drawer');
  await sleep(250);
  assert(await evaluate('!document.querySelector("#atelier").classList.contains("hidden")'), '抽屉里的造境入口没有打开画室');
  await click('#atelier-close');
  await click('#panel-close');
  await sleep(300);
  assert(!(await evaluate('document.querySelector("#panel").classList.contains("show")')), '关闭城市后面板没有隐藏');

  await send('Emulation.setDeviceMetricsOverride', { ...MOBILE, deviceScaleFactor: 1, mobile: true });
  await navigate('&mode=mobile');
  assert(await evaluate('document.body.scrollWidth <= 390 + 1'), '移动端主界面出现横向滚动');
  await click('#atelier-open');
  await sleep(250);
  assert(
    (await evaluate('document.querySelector(".atelier-shell").getBoundingClientRect().width')) <= 390 + 1,
    '移动端画室超宽',
  );
  await shot('qa_mobile_atelier');
  await click('#atelier-close');
  await evaluate('sessionStorage.removeItem("cl.luoyangIntro"); __cl.openCity("luoyang"); undefined');
  await sleep(1200);
  assert(
    (await evaluate('document.querySelector(".li-card").getBoundingClientRect().width')) <= 390 + 1,
    '移动端入画卡超宽',
  );
  await shot('qa_mobile_luoyang');
  await send('Emulation.clearDeviceMetricsOverride');

  if (consoleIssues.length) failures.push(`控制台异常：${consoleIssues.join(' | ')}`);
  if (networkIssues.length) failures.push(`网络 4xx/5xx：${networkIssues.join(' | ')}`);

  ws.close();
  if (failures.length) {
    console.error('QA FAILED');
    failures.forEach((message) => console.error(`- ${message}`));
    process.exit(1);
  }
  console.log('QA PASSED');
}

main().catch((error) => {
  console.error('QA ERROR', error);
  process.exit(2);
});
