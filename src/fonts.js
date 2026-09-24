/** Per-document, reference-counted local font faces. No network or installed-font dependency. */
const bubbleFontDocuments = new WeakMap();
export function acquireBubbleFonts(document, sources) {
  const FontFaceClass = document?.defaultView?.FontFace;
  if (!FontFaceClass || !document.fonts || !sources?.en || !sources?.zh) return { ready: Promise.resolve(false), release() {} };
  let entries = bubbleFontDocuments.get(document);
  if (!entries) { entries = new Map(); bubbleFontDocuments.set(document, entries); }
  const key = sources.en + sources.zh;
  let entry = entries.get(key);
  if (!entry) {
    const faces = [];
    try {
      for (const [language, family, weight] of [['en', 'Whale Bubble Latin', '500'], ['zh', 'Whale Bubble Han', '400']]) {
        const url = sources[language];
        if (!/^data:font\/woff2;base64,[A-Za-z0-9+/=]+$/.test(url)) throw new Error('Only embedded WOFF2 bubble fonts are accepted');
        const bytes = Uint8Array.from(globalThis.atob(url.slice(url.indexOf(',') + 1)), character => character.charCodeAt(0));
        const face = new FontFaceClass(family, bytes, { weight, style: 'normal', display: 'swap' });
        document.fonts.add(face); faces.push(face);
      }
      entry = { refs: 0, faces, ready: Promise.all(faces.map(face => face.load())).then(() => true, () => false) };
      entries.set(key, entry);
    } catch {
      for (const face of faces) document.fonts.delete(face);
      return { ready: Promise.resolve(false), release() {} };
    }
  }
  entry.refs++;
  let released = false;
  return {
    ready: entry.ready,
    release() {
      if (released) return;
      released = true;
      if (--entry.refs > 0) return;
      for (const face of entry.faces) document.fonts.delete(face);
      if (entries.get(key) === entry) entries.delete(key);
    },
  };
}
