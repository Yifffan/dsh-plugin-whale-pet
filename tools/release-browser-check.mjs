// Offline-only release regression check. Requires CHROME_PATH and a freshly built preview.
// Uses a fresh temporary profile; never attaches to a user's browser or live DSH GUI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

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

  // The fish gag in a real browser: a school, a run, one eaten straggler, and a whale
  // that is displaced by transform alone, so the saved spot never moves. A host that
  // asks for reduced motion gets no fish at all, so emulate a motion-friendly host
  // first and assert that guarantee with `reduce` before moving on.
  await page('Page.bringToFront');
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const quiet = await evaluate(`(() => {
    const pet = previewPet, start = Date.now();
    pet.temptation.clear(); pet.temptation.start(start);
    pet.paint();
    const status = { enabled: pet.chaseContext('working').enabled, chase: Object.hasOwn(pet.host.dataset, 'chase'), display: getComputedStyle(pet.root.querySelector('.fish-school')).display };
    pet.temptation.clear(); pet.paint();
    return status;
  })()`);
  assert.deepEqual(quiet, { enabled: false, chase: false, display: 'none' }, 'reduced motion must silence the fish entirely');
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const school = await evaluate(`(() => {
    const pet = previewPet, start = Date.now();
    window.__savedNow = pet.now; window.__fishStart = start;
    pet.temptation.clear(); pet.temptation.start(start);
    pet.now = () => start;
    pet.paint();
    const layer = pet.root.querySelector('.fish-school');
    const status = {
      chase: pet.host.dataset.chase, phase: pet.pet.dataset.chasePhase, display: getComputedStyle(layer).display,
      fish: pet.root.querySelectorAll('.fish').length, counter: pet.countOverlay.hasAttribute('hidden'),
      bubble: pet.bubbleText.textContent, label: pet.button.getAttribute('aria-label'),
      run: pet.pet.style.getPropertyValue('--chase-run'), catchX: layer.style.getPropertyValue('--catch-x'),
      petAnimations: pet.pet.getAnimations().map(animation => animation.effect.getTiming().duration),
      fishDurations: [...new Set([...pet.root.querySelectorAll('.fish')].flatMap(node => node.getAnimations().map(animation => animation.effect.getTiming().duration)))].sort((a, b) => a - b),
      src: pet.image.getAttribute('src').slice(0, 26),
    };
    for (const animation of pet.pet.getAnimations()) animation.pause();
    return status;
  })()`);
  assert.equal(school.chase, 'active', 'a school must show up on demand');
  assert.equal(school.phase, 'notice');
  assert.equal(school.display, 'block');
  assert.equal(school.fish, 6);
  assert.equal(school.counter, true, 'the work counter steps aside while the whale is off duty');
  assert.match(school.bubble, /./);
  assert.ok(school.label.includes(school.bubble), 'the gag is announced, not silently visual');
  assert.match(school.run, /^-?\d+px$/);
  assert.match(school.catchX, /^\d+px$/);
  assert.match(school.src, /^data:image\/svg\+xml;base64,/, 'the laptop pose is swapped for the plain one');
  assert.deepEqual(school.petAnimations, [7600], 'the whale run uses the documented 7.6 s timeline');
  assert.deepEqual(school.fishDurations, [950, 7600]);
  const swim = await evaluate(`(() => {
    const pet = previewPet, node = pet.pet;
    const set = time => { for (const animation of node.getAnimations()) { animation.pause(); animation.currentTime = time; } };
    set(0); const home = Math.round(node.getBoundingClientRect().x);
    set(4200); const mid = Math.round(node.getBoundingClientRect().x);
    set(9000); const back = Math.round(node.getBoundingClientRect().x);
    return { home, mid, back, saved: Math.round(pet.position.x) };
  })()`);
  assert.ok(swim.mid < swim.home - 200, `the whale must actually swim after the school: ${JSON.stringify(swim)}`);
  assert.equal(swim.back, swim.home, 'and return to the very same pixel');
  assert.equal(swim.saved, swim.home, 'because left/top, and therefore the saved spot, never changed');
  const eaten = await evaluate(`(() => {
    const pet = previewPet, start = window.__fishStart, straggler = pet.root.querySelectorAll('.fish')[5];
    const set = time => { for (const animation of [...pet.pet.getAnimations(), ...straggler.getAnimations()]) { animation.pause(); animation.currentTime = time; } };
    const catchX = Math.round(parseFloat(straggler.parentElement.style.getPropertyValue('--catch-x')));
    pet.now = () => start + 5400; pet.paint();
    set(5400);
    const caught = { x: Math.round(straggler.getBoundingClientRect().x), opacity: Number(getComputedStyle(straggler).opacity), inFront: Number(getComputedStyle(straggler.parentElement).zIndex) > Number(getComputedStyle(pet.pet).zIndex) };
    pet.now = () => start + 6000; pet.paint();
    set(6000);
    const gone = Number(getComputedStyle(straggler).opacity);
    return { catchX, caught, gone, phase: pet.pet.dataset.chasePhase, front: pet.host.dataset.catch };
  })()`);
  assert.equal(eaten.phase, 'catch');
  assert.equal(eaten.front, 'active');
  assert.ok(Math.abs(eaten.caught.x - eaten.catchX) <= 30, `the straggler must be at the whale's mouth: ${JSON.stringify(eaten)}`);
  assert.equal(eaten.caught.inFront, true, 'the fish being eaten is drawn in front of the whale');
  assert.equal(eaten.gone, 0, 'and is gone once swallowed');
  // A real pending decision ends the gag at once and gives the spot back.
  await evaluate(`previewSet(${JSON.stringify({ ...base, pending: true })})`);
  const interrupted = await evaluate(`({chase: Object.hasOwn(previewPet.host.dataset, 'chase'), phase: previewPet.pet.dataset.chasePhase, x: Math.round(previewPet.pet.getBoundingClientRect().x), saved: Math.round(previewPet.position.x)})`);
  assert.equal(interrupted.chase, false, 'a pending decision must never be hidden behind fish');
  assert.equal(interrupted.phase, 'none');
  assert.equal(interrupted.x, interrupted.saved, 'and the whale is back on its saved spot');
  await evaluate(`previewPet.now = window.__savedNow; previewPet.temptation.clear(); previewSet(${JSON.stringify(base)})`);

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
  console.log(JSON.stringify({ result: 'PASS', version, environment: 'isolated file:// preview, not live DSH', checks: ['no diagnostic/test menu controls', 'working/waiting/celebration/error snapshots', 'aborts do not celebrate', 'fish school run, eaten straggler and untouched saved spot', 'regular settings and hide/restore', 'keyboard menu/movement and pointer drag', 'Chinese/light and English/dark', '360x480 mobile menu bounds', 'no clipboard access', 'no network requests or runtime/unhandled errors'], screenshots: ['artifacts/release-ui-zh.png', 'artifacts/release-ui-en.png'] }, null, 2));
} catch (error) {
  console.error(chromeOutput);
  throw error;
} finally {
  for (const item of pending.values()) clearTimeout(item.timer);
  socket?.close();
  // Chromium's helper processes outlive its browser process, and a live child keeps
  // this process alive through the stderr pipe. Kill the whole tree, on Windows too.
  if (chrome.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
    else { try { process.kill(-chrome.pid, 'SIGKILL'); } catch { try { chrome.kill('SIGKILL'); } catch { /* already exited */ } } }
  }
  // On Windows the re-parented helpers outlive /T, and a stack of them would build up
  // across runs. Sweep our own throwaway profile path only; never touch a user browser.
  if (process.platform === 'win32') {
    const image = path.basename(chromePath);
    spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='${image}'" | Where-Object { $_.CommandLine -like '*${profile}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore' });
  }
  chrome.stderr?.destroy();
  chrome.unref();
  // Chromium children can hold the throwaway profile for a moment on Windows; a
  // locked temp directory must never turn a passing check into a failure.
  for (let attempt = 0; attempt < 10; attempt++) {
    try { fs.rmSync(profile, { recursive: true, force: true }); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
}
