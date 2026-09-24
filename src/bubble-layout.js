/** Anchor a non-interactive thought bubble to the visible artwork, not the empty square. */
export function bubbleLayout({ x, y, size, width, height, visibleHeight, bottomInset = 17, viewportWidth, viewportHeight, topClearance = 56 }) {
  const margin = 12, gap = 28;
  const left = Math.max(margin, Math.min(viewportWidth - width - margin, x + size / 2 - width / 2));
  const artBottom = y + size - bottomInset;
  const artTop = artBottom - visibleHeight;
  const above = artTop - gap - height;
  const below = artBottom + gap;
  const belowFits = below + height <= viewportHeight - margin;
  const aboveSpace = artTop - topClearance;
  const belowSpace = viewportHeight - margin - artBottom;
  const side = above < topClearance && (belowFits || belowSpace > aboveSpace) ? 'below' : 'above';
  const maxTop = Math.max(margin, viewportHeight - height - margin);
  const minTop = Math.min(topClearance, maxTop);
  const top = Math.min(maxTop, Math.max(minTop, side === 'below' ? below : above));
  const tailX = Math.min(Math.max(22, width - 28), Math.max(22, x + size * 0.4 - left));
  return { left, top, side, tailX };
}
