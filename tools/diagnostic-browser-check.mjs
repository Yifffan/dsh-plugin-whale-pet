// Offline-only UI smoke test. Set CHROME_PATH; never attaches to a user's browser/DSH.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const chromePath = process.env.CHROME_PATH;
assert.ok(chromePath, 'Set CHROME_PATH to your installed Chromium executable');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-diagnostic-check-'));
const chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
let socket;
let chromeOutput = '';
chrome.stderr.on('data', chunk => { chromeOutput = (chromeOutput + chunk.toString()).slice(-12000); });
const pending = new Map();
let sequence = 0;
const exceptionEvents = [];
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
  await page('Runtime.enable'); await page('Page.enable');
  await page('Emulation.setDeviceMetricsOverride', { width: 1100, height: 850, deviceScaleFactor: 1, mobile: false });
  await page('Page.navigate', { url: pathToFileURL(path.resolve('preview/index.html')).href });
  const evaluate = async expression => {
    const result = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await evaluate(`new Promise((resolve,reject)=>{let count=0;const ready=()=>{if(window.previewPet) resolve(true);else if(++count>100)reject(new Error('preview missing'));else setTimeout(ready,30)};ready()})`);
  assert.equal(await evaluate(`window.previewPet.diagnosticsPanel.hidden`), true);
  await evaluate(`window.__refreshCalls=0;window.__unhandled=[];window.addEventListener('unhandledrejection',e=>window.__unhandled.push(String(e.reason)));previewPet.onDiagnosticsRefresh=async()=>{window.__refreshCalls++};previewPet.openPanel();previewPet.openDiagnostics();`);
  await evaluate(`new Promise(resolve=>setTimeout(resolve,30))`);
  assert.equal(await evaluate(`window.__refreshCalls`), 1);
  assert.equal(await evaluate(`previewPet.diagnosticsToggle.getAttribute('aria-expanded')`), 'true');
  assert.ok((await evaluate(`previewPet.diagnosticsText.value`)).includes(version));
  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text}}});`);
  await evaluate(`previewPet.refreshDiagnostics(true)`);
  assert.equal(await evaluate(`window.__refreshCalls`), 2);
  assert.ok((await evaluate(`window.__copied`)).includes(version));
  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('PRIVATE_CLIPBOARD_SENTINEL')}}});`);
  await evaluate(`previewPet.refreshDiagnostics(true)`);
  assert.equal(await evaluate(`previewPet.diagnosticsText.selectionStart===0&&previewPet.diagnosticsText.selectionEnd===previewPet.diagnosticsText.value.length`), true);
  const selected = await evaluate(`({start:previewPet.diagnosticsText.selectionStart,end:previewPet.diagnosticsText.selectionEnd,text:previewPet.diagnosticsText.value,calls:window.__refreshCalls})`);
  await evaluate(`for(let n=0;n<5;n++)previewPet.paint();`);
  assert.deepEqual(await evaluate(`({start:previewPet.diagnosticsText.selectionStart,end:previewPet.diagnosticsText.selectionEnd,text:previewPet.diagnosticsText.value,calls:window.__refreshCalls})`), selected);
  assert.equal(await evaluate(`previewPet.diagnosticsPanel.textContent.includes('PRIVATE_CLIPBOARD_SENTINEL')`), false);
  for (const [language, dark] of [['zh', false], ['en', true]]) {
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    await evaluate(`previewPet.setLanguage(${JSON.stringify(language)});previewPet.positionPanel();`);
    const geometry = await evaluate(`(()=>{const p=previewPet.panel.getBoundingClientRect();return {left:p.left,top:p.top,right:p.right,bottom:p.bottom,width:innerWidth,height:innerHeight,title:previewPet.diagnosticsToggle.textContent}})()`);
    assert.ok(geometry.left >= 0 && geometry.top >= 0 && geometry.right <= geometry.width && geometry.bottom <= geometry.height, JSON.stringify(geometry));
    assert.ok(geometry.title.includes(language === 'zh' ? '同步诊断' : 'Sync diagnostics'));
    fs.mkdirSync('artifacts', { recursive: true });
    const image = await page('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`artifacts/diagnostic-ui-${language}.png`, Buffer.from(image.data, 'base64'));
  }
  await page('Emulation.setDeviceMetricsOverride', { width: 360, height: 480, deviceScaleFactor: 1, mobile: false });
  await evaluate(`previewPet.reposition();previewPet.positionPanel()`);
  const small = await evaluate(`(()=>{const p=previewPet.panel.getBoundingClientRect();return {left:p.left,top:p.top,right:p.right,bottom:p.bottom,scroll:getComputedStyle(previewPet.panel).overflowY}})()`);
  assert.ok(small.left >= 0 && small.top >= 0 && small.right <= 360 && small.bottom <= 480, JSON.stringify(small));
  assert.equal(small.scroll, 'auto');
  await evaluate(`previewPet.onDiagnosticsRefresh=()=>new Promise(resolve=>window.__lateResolve=resolve);window.__late=previewPet.refreshDiagnostics();true`);
  await evaluate(`previewPet.closePanel(false);window.__lateResolve();window.__late`);
  assert.equal(await evaluate(`previewPet.diagnosticsPanel.hidden`), true);
  await evaluate(`previewPet.onDiagnosticsRefresh=()=>Promise.reject(new Error('PRIVATE_HOST_SENTINEL'));previewPet.openPanel();previewPet.openDiagnostics();`);
  await evaluate(`new Promise(resolve=>setTimeout(resolve,30))`);
  assert.equal(await evaluate(`previewPet.diagnosticsPanel.textContent.includes('PRIVATE_HOST_SENTINEL')`), false);
  await evaluate(`previewPet.dispose()`);
  assert.deepEqual(await evaluate(`window.__unhandled`), []);
  assert.deepEqual(exceptionEvents, []);
  console.log(JSON.stringify({ result: 'PASS', environment: 'isolated file:// preview, not live DSH', checks: ['explicit-only host refresh', 'clipboard success', 'denied clipboard manual selection preserved by paint', 'sanitized errors', 'Chinese/light and English/dark', '360x480 viewport bounds', 'close-race and rejected refresh cleanup', 'no runtime/unhandled errors'] }, null, 2));
} catch (error) {
  console.error(chromeOutput);
  throw error;
} finally {
  for (const item of pending.values()) clearTimeout(item.timer);
  socket?.close();
  try { process.kill(-chrome.pid, 'SIGTERM'); } catch { /* already exited */ }
  if (chrome.exitCode === null) await new Promise(resolve => { const timer = setTimeout(resolve, 3000); chrome.once('exit', () => { clearTimeout(timer); resolve(); }); });
  fs.rmSync(profile, { recursive: true, force: true });
}
