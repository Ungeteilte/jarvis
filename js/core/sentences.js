// Zerlegt gestreamten Text in fertige Sätze (für satzweise Sprachausgabe).
// Browser-frei. push(teil) → fertige Sätze[], flush() → Rest.

const ABBREV = /(?:\b(?:[a-zäöü]|bzw|ca|Nr|Dr|Hr|Fr|Str|usw|evtl|ggf|inkl|bspw)\.|\d\.)$/i;

export function createSentenceChunker({ minLength = 2 } = {}) {
  let buf = '';
  return {
    push(text) {
      buf += String(text || '');
      const out = [];
      const re = /[.!?…]+["“”»)]*(?=\s)|\n+/g;
      let last = 0;
      let m;
      while ((m = re.exec(buf))) {
        const end = m.index + m[0].length;
        const piece = buf.slice(last, end);
        // Abkürzungen/Ordnungszahlen nicht als Satzende behandeln
        if (/\.$/.test(m[0]) && ABBREV.test(buf.slice(Math.max(0, end - 6), end))) continue;
        const s = piece.trim();
        if (s.length >= minLength) out.push(s);
        last = end;
      }
      buf = buf.slice(last);
      return out;
    },
    flush() {
      const s = buf.trim();
      buf = '';
      return s ? [s] : [];
    },
    reset() { buf = ''; }
  };
}
