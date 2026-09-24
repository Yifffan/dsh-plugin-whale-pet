/** SVG equivalent of superellipse(1.5), with the approved TL/TR/BR/BL radii.
 * The zero-inset path matches the showcase prototype. A 0.5px inset contains
 * the production 1px stroke without changing the bubble's border-box layout.
 */
export function smoothBubblePath(width, height, inset = 0) {
  if (![width, height, inset].every(Number.isFinite) || width <= 0 || height <= 0 || inset < 0) return '';
  const w = width - inset * 2, h = height - inset * 2;
  if (w <= 0 || h <= 0) return '';
  const radii = [20, 22, 21, 19];
  const fit = Math.min(1, w / (radii[0] + radii[1]), w / (radii[3] + radii[2]), h / (radii[0] + radii[3]), h / (radii[1] + radii[2]));
  const [tl, tr, br, bl] = radii.map(radius => radius * fit);
  const power = 2 / (2 ** 1.5);
  const corners = [[w - tr, tr, tr, -Math.PI / 2], [w - br, h - br, br, 0], [bl, h - bl, bl, Math.PI / 2], [tl, tl, tl, Math.PI]];
  let result = '';
  for (const [cx, cy, radius, start] of corners) {
    for (let step = 0; step <= 64; step++) {
      const angle = start + step * Math.PI / 128;
      const c = Math.cos(angle), s = Math.sin(angle);
      const x = inset + cx + radius * Math.sign(c) * Math.abs(c) ** power;
      const y = inset + cy + radius * Math.sign(s) * Math.abs(s) ** power;
      result += `${result ? 'L' : 'M'}${x.toFixed(3)} ${y.toFixed(3)}`;
    }
  }
  return result + 'Z';
}

/** Attach one inert, theme-inheriting SVG surface. The caller owns the message.
 * SVG geometry never participates in layout, so ResizeObserver cannot feed back
 * through path changes. Synchronous update() also covers missing observer APIs.
 */
export function attachBubbleSurface(bubble, onResize = () => {}) {
  const document = bubble.ownerDocument;
  const view = document.defaultView;
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  element.setAttribute('class', 'bubble-surface');
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('focusable', 'false');
  element.setAttribute('preserveAspectRatio', 'none');
  element.append(path);
  bubble.prepend(element);
  let disposed = false, observer, previousWidth, previousHeight;
  const update = () => {
    if (disposed) return false;
    // Use untransformed CSS pixels, not a scaled ancestor's client rectangle.
    const style = view?.getComputedStyle?.(bubble);
    let width = Number.parseFloat(style?.width), height = Number.parseFloat(style?.height);
    if (style && style.boxSizing !== 'border-box') {
      const size = property => Number.parseFloat(style[property]) || 0;
      width += size('paddingLeft') + size('paddingRight') + size('borderLeftWidth') + size('borderRightWidth');
      height += size('paddingTop') + size('paddingBottom') + size('borderTopWidth') + size('borderBottomWidth');
    }
    if (!Number.isFinite(width) || width <= 0) width = bubble.offsetWidth;
    if (!Number.isFinite(height) || height <= 0) height = bubble.offsetHeight;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 1 || height <= 1) return false;
    if (width === previousWidth && height === previousHeight) return false;
    previousWidth = width; previousHeight = height;
    element.setAttribute('viewBox', `0 0 ${width} ${height}`);
    path.setAttribute('d', smoothBubblePath(width, height, 0.5));
    return true;
  };
  const Observer = view?.ResizeObserver ?? globalThis.ResizeObserver;
  if (typeof Observer === 'function') {
    try {
      observer = new Observer(() => {
        if (disposed) return;
        update();
        onResize();
      });
      observer.observe(bubble, { box: 'border-box' });
    } catch {
      observer?.disconnect();
      observer = undefined;
    }
  }
  update();
  return {
    element, path, update,
    dispose() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      observer = undefined;
      element.remove();
    },
  };
}
