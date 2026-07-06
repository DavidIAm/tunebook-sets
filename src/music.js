// Music-theory helpers for set building: key parsing, modal cousins,
// diatonic step transitions, and first/last-note extraction from ABC.
// Key-signature logic mirrors tunebook-flashcards/src/abc.js.

const MAJOR_SHARPS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const MODE_OFFSET = { ionian: 0, major: 0, maj: 0, lydian: 1, lyd: 1,
  mixolydian: -1, mix: -1, mixo: -1, dorian: -2, dor: -2,
  aeolian: -3, minor: -3, min: -3, aeo: -3, phrygian: -4, phr: -4, locrian: -5, loc: -5 };
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function parseKey(key) {
  const m = String(key || '').replace(/\s+/g, '').match(/^([A-Ga-g])([#b♯♭]?)([A-Za-z]*)$/);
  if (!m) return null;
  const tonic = m[1].toUpperCase() + (m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2]);
  const mode = (m[3] || 'major').toLowerCase();
  const base = MAJOR_SHARPS[tonic];
  const off = MODE_OFFSET[mode];
  if (base === undefined || off === undefined) return null;
  const pc = (PC[tonic[0]] + (tonic[1] === '#' ? 1 : tonic[1] === 'b' ? -1 : 0) + 12) % 12;
  return { tonic, mode, sig: base + off, pc };
}

// Pitch classes of the 7-note scale for a key, ordered from the tonic.
// Derived from the major scale of the key signature, rotated to the tonic.
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
export function scalePcs(key) {
  const p = typeof key === 'string' ? parseKey(key) : key;
  if (!p) return null;
  // Major tonic for this signature: each sharp moves the tonic up a fifth.
  const majTonic = ((p.sig * 7) % 12 + 12) % 12;
  const pcs = MAJOR_STEPS.map((s) => (majTonic + s) % 12);
  const start = pcs.indexOf(p.pc);
  if (start === -1) return null; // tonic not in signature scale (shouldn't happen)
  return pcs.slice(start).concat(pcs.slice(0, start));
}

// Diatonic neighbours of the tonic: one scale step up and one down.
// Em (2♯ scale: D major notes rotated to E) → up = F#, down = D.
export function stepNeighbours(key) {
  const pcs = scalePcs(key);
  if (!pcs) return null;
  return { up: pcs[1], down: pcs[6] };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const pcName = (pc) => NOTE_NAMES[((pc % 12) + 12) % 12];

// ---- ABC first/last note extraction ----
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
function sigAccidentals(sig) {
  const acc = {};
  if (sig > 0) for (let i = 0; i < sig && i < 7; i++) acc[SHARP_ORDER[i]] = 1;
  if (sig < 0) for (let i = 0; i < -sig && i < 7; i++) acc[FLAT_ORDER[i]] = -1;
  return acc;
}

function cleanAbc(body) {
  return String(body || '')
    .replace(/\\\r?\n/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/"[^"]*"/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/![^!]*!/g, '')
    .replace(/\[[A-Z]:[^\]]*\]/g, '');
}

function noteTokens(bar) {
  const out = [];
  const re = /(\^{1,2}|_{1,2}|=)?([A-Ga-g])([,']*)/g;
  let m;
  while ((m = re.exec(bar))) {
    const letter = m[2].toUpperCase();
    let oct = m[2] === m[2].toLowerCase() ? 5 : 4;
    for (const c of m[3]) oct += c === "'" ? 1 : -1;
    const acc = m[1] ? (m[1] === '=' ? 0 : m[1][0] === '^' ? m[1].length : -m[1].length) : null;
    out.push({ letter, acc, oct });
  }
  return out;
}

function pitchOf(note, keyAcc, barAcc) {
  const a = note.acc !== null ? note.acc
    : barAcc[note.letter + note.oct] !== undefined ? barAcc[note.letter + note.oct]
    : keyAcc[note.letter] || 0;
  return 12 * (note.oct + 1) + PC[note.letter] + a;
}

// First and last sounded pitch (midi number) of an ABC body under a key signature.
export function edgeNotes(body, sig) {
  const bars = cleanAbc(body).split(/\|/);
  const keyAcc = sigAccidentals(sig);
  let first = null, last = null;
  for (const bar of bars) {
    const ns = noteTokens(bar);
    if (ns.length) { first = pitchOf(ns[0], keyAcc, {}); break; }
  }
  for (let i = bars.length - 1; i >= 0; i--) {
    const ns = noteTokens(bars[i]);
    if (!ns.length) continue;
    const barAcc = {};
    for (const n of ns) {
      last = pitchOf(n, keyAcc, barAcc);
      if (n.acc !== null) barAcc[n.letter + n.oct] = n.acc;
    }
    break;
  }
  return { first, last };
}
