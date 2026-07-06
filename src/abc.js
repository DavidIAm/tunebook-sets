// Vendored from tunebook-flashcards (same author) so this repo is self-contained.
// Pure ABC / music-theory helpers. No I/O.

const METER_BY_TYPE = {
  reel: '4/4', hornpipe: '4/4', barndance: '4/4', strathspey: '4/4', march: '4/4',
  jig: '6/8', 'slip jig': '9/8', slide: '12/8', polka: '2/4',
  waltz: '3/4', mazurka: '3/4', 'three-two': '3/2',
};

export function meterFor(type) {
  const key = String(type || '').trim().toLowerCase();
  return { meter: METER_BY_TYPE[key] || '4/4', unitNote: '1/8' };
}

export function firstBars(body, n) {
  const cleaned = String(body || '').replace(/[!\n\r]+/g, ' ');
  const tokens = cleaned
    .split('|')
    .map((t) => t.replace(/^[\s:]+|[\s:]+$/g, '')) // strip surrounding spaces/repeat colons
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return '';
  const notes = (t) => (t.match(/[A-Ga-gz]/g) || []).length;
  // A much-shorter leading token is an anacrusis (pickup): keep it as a lead-in
  // but don't count it as one of the N full measures.
  let lead = [];
  if (tokens.length >= 2 && notes(tokens[0]) > 0 && notes(tokens[0]) * 2 <= notes(tokens[1])) {
    lead = [tokens.shift()];
  }
  const bars = [...lead, ...tokens.slice(0, n)];
  return '|' + bars.join('|') + '|';
}

const MAJOR_SHARPS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const MODE_OFFSET = { ionian: 0, major: 0, maj: 0, lydian: 1, lyd: 1,
  mixolydian: -1, mix: -1, mixo: -1, dorian: -2, dor: -2,
  aeolian: -3, minor: -3, min: -3, aeo: -3, phrygian: -4, phr: -4, locrian: -5, loc: -5 };
const MODE_ABBR = { major: 'maj', ionian: 'maj', minor: 'min', aeolian: 'min',
  dorian: 'dor', mixolydian: 'mix', lydian: 'lyd', phrygian: 'phr', locrian: 'loc' };

function parseKey(key) {
  const m = String(key || '').replace(/\s+/g, '').match(/^([A-Ga-g])([#b♯♭]?)([A-Za-z]*)$/);
  if (!m) return null;
  const tonic = m[1].toUpperCase() + (m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2]);
  const mode = (m[3] || 'major').toLowerCase();
  return { tonic, mode };
}

export function keySignature(key) {
  const p = parseKey(key);
  if (!p) return null;
  const base = MAJOR_SHARPS[p.tonic];
  const off = MODE_OFFSET[p.mode];
  if (base === undefined || off === undefined) return null;
  const count = base + off;
  const label = count === 0 ? '0' : `${Math.abs(count)}${count > 0 ? '♯' : '♭'}`;
  return { count, label };
}

export function prettyKey(key) {
  const p = parseKey(key);
  if (!p) return String(key || '');
  return `${p.tonic} ${MODE_ABBR[p.mode] || p.mode.slice(0, 3)}`;
}

export function buildAbc({ key, type, body, bars }) {
  const { meter, unitNote } = meterFor(type);
  const p = parseKey(key);
  const kField = p ? `${p.tonic} ${p.mode}` : 'C';
  const measures = firstBars(body, bars);
  return `X:1\nL:${unitNote}\nM:${meter}\nK:${kField}\n${measures}`;
}
