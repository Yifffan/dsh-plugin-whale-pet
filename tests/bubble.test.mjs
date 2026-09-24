import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireBubbleFonts } from '../src/fonts.js';
import { bubbleLayout } from '../src/bubble-layout.js';
import { MESSAGES } from '../src/i18n.js';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const sources = { en: 'data:font/woff2;base64,d09GMg==', zh: 'data:font/woff2;base64,d09GMg==' };
test('font metadata matches binaries and covers every current bilingual bubble phrase', () => {
  const metadata = JSON.parse(fs.readFileSync(new URL('../assets/fonts/manifest.json', import.meta.url), 'utf8'));
  const covered = new Set(metadata.fonts.flatMap(font => font.codepoints));
  for (const font of metadata.fonts) {
    const bytes = fs.readFileSync(new URL(`../assets/fonts/${font.file}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), font.sha256);
  }
  for (const dictionary of Object.values(MESSAGES)) for (const [key, text] of Object.entries(dictionary)) {
    if (!/^(state|working|celebrate|error)\./.test(key) && key !== 'pet.greeting') continue;
    for (const character of text) assert.ok(covered.has(character.codePointAt(0)), `${key}: missing embedded glyph ${character}; regenerate bubble fonts`);
  }
});
function fontDocument(fail = false) {
  const faces = [];
  class Face {
    constructor(family, buffer, descriptors) { this.family = family; this.descriptors = descriptors; this.buffer = buffer; faces.push(this); }
    load() { return fail ? Promise.reject(new Error('font unavailable')) : Promise.resolve(this); }
  }
  return { defaultView: { FontFace: Face }, fonts: new Set(), faces };
}
test('embedded fonts are binary FontFace sources, not network URLs or shadow @font-face', async () => {
  const doc = fontDocument(); const lease = acquireBubbleFonts(doc, sources);
  assert.equal(await lease.ready, true); assert.equal(doc.fonts.size, 2);
  assert.ok(doc.faces.every(face => face.buffer instanceof Uint8Array));
  assert.deepEqual(doc.faces.map(face => face.family), ['Whale Bubble Latin', 'Whale Bubble Han']);
  lease.release(); assert.equal(doc.fonts.size, 0);
});
test('multiple widgets share faces and only remove them after last release', async () => {
  const doc = fontDocument(); const first = acquireBubbleFonts(doc, sources), second = acquireBubbleFonts(doc, { ...sources });
  await first.ready; assert.equal(doc.faces.length, 2);
  first.release(); first.release(); assert.equal(doc.fonts.size, 2);
  second.release(); assert.equal(doc.fonts.size, 0);
  const third = acquireBubbleFonts(doc, sources); await third.ready; assert.equal(doc.faces.length, 4); third.release();
});
test('missing font API and font failures degrade without rejected ready promises', async () => {
  assert.equal(await acquireBubbleFonts({}, sources).ready, false);
  const doc = fontDocument(true); const lease = acquireBubbleFonts(doc, sources);
  assert.equal(await lease.ready, false); lease.release(); assert.equal(doc.fonts.size, 0);
});
test('external, malformed and partial sources cannot leave registered faces', async () => {
  for (const src of [{ en: 'https://example.test/font.woff2', zh: sources.zh }, { en: sources.en, zh: 'data:font/woff2;base64,!' }, { en: sources.en }]) {
    const doc = fontDocument(); const lease = acquireBubbleFonts(doc, src);
    assert.equal(await lease.ready, false); assert.equal(doc.fonts.size, 0); lease.release();
  }
});
const base = { x: 300, y: 400, size: 156, width: 200, height: 45, visibleHeight: 70, viewportWidth: 800, viewportHeight: 800 };
test('resting bubble anchors above actual visible drawing, not the square top', () => {
  const layout = bubbleLayout(base);
  assert.equal(layout.side, 'above');
  assert.equal(layout.top + base.height, base.y + base.size - 17 - base.visibleHeight - 28);
  assert.ok(layout.top > base.y - base.height, 'closer than old square-top placement');
});
test('near titlebar bubble moves below the drawing and points upward', () => {
  const layout = bubbleLayout({ ...base, y: 56, visibleHeight: 119 });
  assert.equal(layout.side, 'below'); assert.equal(layout.top, 56 + 156 - 17 + 28);
});
test('viewport corners clamp both bubble and tail without changing pet position', () => {
  for (const x of [12, 632]) {
    const layout = bubbleLayout({ ...base, x });
    assert.ok(layout.left >= 12 && layout.left + base.width <= 788);
    assert.ok(layout.tailX >= 22 && layout.tailX <= base.width - 28);
  }
});
test('long translated bubble and narrow viewport remain visible', () => {
  const input = { ...base, x: 12, y: 56, size: 156, width: 176, height: 95, viewportWidth: 200, viewportHeight: 250 };
  const layout = bubbleLayout(input);
  assert.ok(layout.left >= 12 && layout.left + input.width <= 188);
  assert.ok(layout.top >= 12 && layout.top + input.height <= 238);
});
