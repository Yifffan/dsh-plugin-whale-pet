// Offline-only release regression check. Requires CHROME_PATH and a freshly built preview.
// Uses a fresh temporary profile; never attaches to a user's browser or live DSH GUI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const preview = path.join(root, 'preview/index.html');
const chromePath = process.env.CHROME_PATH;
assert.ok(chromePath, 'Set CHROME_PATH to your installed Chromium executable');
assert.ok(fs.existsSync(preview), 'Build the offline preview before running this check');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-release-check-'));
const chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
let socket;
let chromeOutput = '';
chrome.stderr.on('data', chunk => { chromeOutput = (chromeOutput + chunk.toString()).slice(-12000); });
const pending = new Map();
let sequence = 0;
const exceptionEvents = [], consoleErrors = [], networkRequests = [];
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chrome debugger startup timed out')), 15000);
    chrome.once('error', error => { clearTimeout(timer); reject(error); });
    chrome.once('exit', code => { clearTimeout(timer); reject(new Error(`Chrome exited before debugger: ${code}`)); });
    chrome.stderr.on('data', chunk => { output += chunk.toString(); const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptionEvents.push(message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(arg => arg.value ?? arg.description));
    if (message.method === 'Network.requestWillBeSent' && /^(?:https?|wss?):/i.test(message.params.request.url)) networkRequests.push(message.params.request.url);
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => call(method, params, sessionId);
  await page('Runtime.enable'); await page('Page.enable'); await page('Network.enable');
  await page('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] });
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__clipboardCalls = 0; window.__unhandled = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, get() { window.__clipboardCalls++; throw new Error('Formal UI must not access clipboard'); } });
    document.execCommand = () => { window.__clipboardCalls++; throw new Error('Formal UI must not use legacy clipboard commands'); };
    window.addEventListener('unhandledrejection', event => window.__unhandled.push(String(event.reason)));
  ` });
  await page('Emulation.setDeviceMetricsOverride', { width: 1100, height: 850, deviceScaleFactor: 1, mobile: false });
  await page('Page.navigate', { url: pathToFileURL(preview).href });
  const evaluate = async expression => {
    const result = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await evaluate(`new Promise((resolve,reject)=>{let count=0;const ready=()=>{if(window.previewPet) resolve(true);else if(++count>100)reject(new Error('preview missing'));else setTimeout(ready,30)};ready()})`);
  await evaluate(`previewPet.fontsReady`);
  assert.equal((await evaluate(`document.querySelector('.version').textContent`)).trim(), `DSH PLUGIN / ${version}`, 'Preview must match current package version');
  assert.equal(await evaluate(`location.protocol`), 'file:');
  assert.equal(await evaluate(`previewPet.panel.hidden`), true);

  // The preview's external pose controls are not production menu controls.
  const assertFormalMenu = async () => {
    assert.deepEqual(await evaluate(`Array.from(previewPet.root.querySelectorAll('button'), node => node.className)`), ['pet-button', 'close', 'action reset', 'action hide', 'restore']);
    assert.equal(await evaluate(`previewPet.root.querySelectorAll('[class*="diagnostic"],[id*="diagnostic"],[data-action],.test-button,textarea').length`), 0);
    assert.equal(await evaluate(`/diagnostic|telemetry|clipboard|同步诊断|测试/.test(previewPet.panel.textContent)`), false);
    assert.equal(await evaluate(`Object.keys(previewPet).some(key => /diagnostic/i.test(key))`), false);
  };
  await assertFormalMenu();
  const base = { sessionId: 'offline-release', available: true, running: true, pending: false, workingCount: 2 };
  const snapshot = async (value, state) => {
    await evaluate(`previewSet(${JSON.stringify(value)})`);
    assert.equal(await evaluate(`previewPet.pet.dataset.state`), state);
    assert.equal(await evaluate(`previewPet.countOverlay.hasAttribute('hidden')`), state !== 'working');
    assert.ok(await evaluate(`previewPet.button.getAttribute('aria-label').length > 0`));
  };
  await snapshot(base, 'working');
  assert.equal(await evaluate(`previewPet.countText.textContent`), '2');
  await snapshot({ ...base, pending: true }, 'waiting');
  await snapshot({ ...base, workingCount: 1, notice: { id: 'partial-completion', reason: 'completed' } }, 'celebrate');
  // Normal completion while another task is still running retains the beta.3 behavior.
  await snapshot({ ...base, workingCount: 1 }, 'working');
  await snapshot({ ...base, notice: { id: 'failed-task', reason: 'error' } }, 'error');
  await snapshot(base, 'working');
  await snapshot({ ...base, running: false, workingCount: 0, outcome: { id: 'finished-task', reason: 'completed' } }, 'celebrate');
  await snapshot(base, 'working');
  await snapshot({ ...base, running: false, workingCount: 0, outcome: { id: 'aborted-task', reason: 'aborted' } }, 'resting');

  // Exercise normal keyboard, context-menu and settings actions, without special runtime APIs.
  await page('Page.bringToFront');
  await evaluate(`previewPet.button.focus()`);
  assert.equal(await evaluate(`previewPet.root.activeElement === previewPet.button`), true);
  // Match native browser automation: Enter needs its carriage-return text to
  // produce keypress/default button activation; non-text keys use rawKeyDown.
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.equal(await evaluate(`previewPet.panel.hidden`), false);
  assert.equal(await evaluate(`previewPet.root.activeElement === previewPet.root.querySelector('.close')`), true);
  await evaluate(`previewPet.scope.value='current';previewPet.scope.dispatchEvent(new Event('change'));previewPet.range.value='125';previewPet.range.dispatchEvent(new Event('input'));previewPet.motion.click();previewPet.sleep.value='30000';previewPet.sleep.dispatchEvent(new Event('change'));`);
  assert.deepEqual(await evaluate(`({scope:previewPet.preferences.scope,scale:previewPet.preferences.scale,motion:previewPet.preferences.motion,sleep:previewPet.machine.sleepAfterMs})`), { scope: 'current', scale: 1.25, motion: false, sleep: 30000 });
  await evaluate(`previewPet.root.querySelector('.hide').click()`);
  assert.deepEqual(await evaluate(`({hidden:previewPet.pet.hidden,restore:previewPet.restore.hidden,panel:previewPet.panel.hidden})`), { hidden: true, restore: false, panel: true });
  await evaluate(`previewPet.restore.click()`);
  assert.equal(await evaluate(`previewPet.pet.hidden`), false);
  const before = await evaluate(`previewPet.position.x`);
  await page('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  assert.equal(await evaluate(`previewPet.position.x`), before - 5);
  const drag = await evaluate(`(()=>{const rect=previewPet.button.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,left:previewPet.position.x,top:previewPet.position.y}})()`);
  await page('Input.dispatchMouseEvent', { type: 'mousePressed', x: drag.x, y: drag.y, button: 'left', clickCount: 1 });
  await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: drag.x - 30, y: drag.y - 30, button: 'left', buttons: 1 });
  await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x: drag.x - 30, y: drag.y - 30, button: 'left', clickCount: 1 });
  assert.deepEqual(await evaluate(`({x:previewPet.position.x,y:previewPet.position.y,dragging:previewPet.drag})`), { x: drag.left - 30, y: drag.top - 30, dragging: null });
  await evaluate(`previewPet.button.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));previewPet.root.querySelector('.reset').click();`);
  assert.equal(await evaluate(`previewPet.panel.hidden`), false);
  assert.deepEqual(await evaluate(`({x:previewPet.preferences.x,y:previewPet.preferences.y})`), { x: null, y: null });
  await page('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await evaluate(`previewPet.panel.hidden`), true);

  const bounds = async () => {
    const geometry = await evaluate(`(()=>{const p=previewPet.panel.getBoundingClientRect();return {left:p.left,top:p.top,right:p.right,bottom:p.bottom,width:innerWidth,height:innerHeight,scroll:getComputedStyle(previewPet.panel).overflowY}})()`);
    assert.ok(geometry.left >= 0 && geometry.top >= 0 && geometry.right <= geometry.width && geometry.bottom <= geometry.height, JSON.stringify(geometry));
    assert.equal(geometry.scroll, 'auto');
  };
  for (const [language, dark] of [['zh', false], ['en', true]]) {
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    await evaluate(`document.body.classList.toggle('dark',${dark});document.documentElement.style.colorScheme=${JSON.stringify(dark ? 'dark' : 'light')};previewPet.setLanguage(${JSON.stringify(language)});previewPet.openPanel();`);
    await assertFormalMenu(); await bounds();
    assert.equal(await evaluate(`previewPet.root.querySelector('[data-i18n="panel.title"]').textContent`), language === 'zh' ? '小鲸鱼 · 陪你工作' : 'Your little whale buddy');
    assert.equal(await evaluate(`previewPet.panel.getAttribute('aria-label')`), language === 'zh' ? '鲸鱼宠物设置' : 'Whale companion settings');
    const image = await page('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(root, `artifacts/release-ui-${language}.png`), Buffer.from(image.data, 'base64'));
  }
  await page('Emulation.setDeviceMetricsOverride', { width: 360, height: 480, deviceScaleFactor: 1, mobile: true });
  await evaluate(`previewPet.reposition();previewPet.positionPanel()`);
  await bounds(); await assertFormalMenu();
  await evaluate(`previewPet.root.querySelector('.close').click()`);
  assert.equal(await evaluate(`previewPet.panel.hidden`), true);
  await evaluate(`previewPet.dispose()`);
  assert.equal(await evaluate(`window.__clipboardCalls`), 0);
  assert.deepEqual(await evaluate(`window.__unhandled`), []);
  assert.deepEqual(exceptionEvents, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(networkRequests, []);
  console.log(JSON.stringify({ result: 'PASS', version, environment: 'isolated file:// preview, not live DSH', checks: ['no diagnostic/test menu controls', 'working/waiting/celebration/error snapshots', 'aborts do not celebrate', 'regular settings and hide/restore', 'keyboard menu/movement and pointer drag', 'Chinese/light and English/dark', '360x480 mobile menu bounds', 'no clipboard access', 'no network requests or runtime/unhandled errors'], screenshots: ['artifacts/release-ui-zh.png', 'artifacts/release-ui-en.png'] }, null, 2));
} catch (error) {
  console.error(chromeOutput);
  throw error;
} finally {
  for (const item of pending.values()) clearTimeout(item.timer);
  socket?.close();
  if (chrome.pid) { try { process.kill(-chrome.pid, 'SIGTERM'); } catch { /* already exited */ } }
  if (chrome.pid && chrome.exitCode === null) await new Promise(resolve => { const timer = setTimeout(resolve, 3000); chrome.once('exit', () => { clearTimeout(timer); resolve(); }); });
  fs.rmSync(profile, { recursive: true, force: true });
}
