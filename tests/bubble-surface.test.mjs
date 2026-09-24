import test from 'node:test';
import assert from 'node:assert/strict';
import { smoothBubblePath } from '../src/bubble-surface.js';
const points = d => [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);

test('smooth SVG uses the accepted 20/22/21/19 corner radii',()=>{
  const d=smoothBubblePath(200,60),p=points(d);
  assert.ok(d.endsWith('Z'));assert.equal(p.length,260);
  assert.deepEqual(p[0],[178,0]);assert.deepEqual(p[64],[200,22]);
  assert.deepEqual(p[129],[179,60]);assert.deepEqual(p.at(-1),[20,0]);
});
test('SVG curve follows superellipse(1.5), rather than ordinary elliptical corners',()=>{
  const [x,y]=points(smoothBubblePath(200,60))[32];
  const factor=Math.cos(Math.PI/4)**(2/(2**1.5));
  assert.ok(Math.abs(x-(178+22*factor))<.001);
  assert.ok(Math.abs(y-(22-22*factor))<.001);
  assert.ok(x>178+22*Math.SQRT1_2);
});
test('small and fractional bubbles proportionally clamp radii inside bounds',()=>{
  for(const [w,h]of [[8,5],[36,22],[165.25,98.5],[320,48.75]]){
    const p=points(smoothBubblePath(w,h));assert.equal(p.length,260);
    for(const [x,y]of p){assert.ok(x>=0&&x<=w+.001);assert.ok(y>=0&&y<=h+.001)}
  }
});
test('half-pixel inset reserves space for a complete one-pixel SVG outline',()=>{
  const p=points(smoothBubblePath(260.5,64.25,.5));assert.equal(p.length,260);
  for(const [x,y]of p){assert.ok(x>=.5&&x<=260);assert.ok(y>=.5&&y<=63.75)}
});
test('invalid or non-positive surface dimensions cannot emit malformed SVG',()=>{
  for(const n of [0,-1,NaN,Infinity,-Infinity]){
    assert.equal(smoothBubblePath(n,60),'');assert.equal(smoothBubblePath(200,n),'');
  }
});
