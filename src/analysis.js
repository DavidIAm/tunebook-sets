// Pattern analysis over a member's sets: how consecutive tunes relate in
// key, signature, and edge notes. Pure — takes sets + tune JSON, returns stats.
import { parseKey, edgeNotes } from './music.js';

const IV = ['unison', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];

function tally(map, k) { map[k] = (map[k] || 0) + 1; }
function sorted(map) { return Object.entries(map).sort((a, b) => b[1] - a[1]); }

export function analyzeSets(sets, tunesById) {
  const settingById = {};
  for (const t of Object.values(tunesById)) {
    for (const s of t.settings || []) settingById[s.id] = s;
  }

  const rel = {}, sigDelta = {}, tonicMove = {}, typeRel = {};
  const lastVsTonicA = {}, firstVsTonicB = {}, firstVsTonicA = {}, meterRel = {};
  let pairs = 0, notePairs = 0;

  for (const set of sets) {
    const ss = set.settings || [];
    for (let i = 0; i + 1 < ss.length; i++) {
      const A = ss[i], B = ss[i + 1];
      const kA = parseKey(A.key), kB = parseKey(B.key);
      if (!kA || !kB) continue;
      pairs++;

      const sameKey = kA.tonic === kB.tonic && kA.mode === kB.mode;
      const d = kB.sig - kA.sig;
      tally(sigDelta, d);
      if (sameKey) tally(rel, 'same key');
      else if (d === 0) tally(rel, 'modal cousin (same signature)');
      else if (Math.abs(d) === 1) tally(rel, 'signature step (±1 accidental)');
      else tally(rel, 'signature jump (≥2)');
      if (!sameKey) tally(tonicMove, `${A.key} → ${B.key}`);
      tally(typeRel, A.type === B.type ? 'same type' : 'type change');
      tally(meterRel, A.meter === B.meter ? 'same meter' : 'meter change');

      const sA = settingById[A.id], sB = settingById[B.id];
      if (sA?.abc && sB?.abc) {
        const eA = edgeNotes(sA.abc, kA.sig);
        const eB = edgeNotes(sB.abc, kB.sig);
        if (eA.last !== null && eB.first !== null) {
          notePairs++;
          tally(lastVsTonicA, IV[((eA.last % 12) - kA.pc + 12) % 12]);
          tally(firstVsTonicB, IV[((eB.first % 12) - kB.pc + 12) % 12]);
          tally(firstVsTonicA, IV[((eB.first % 12) - kA.pc + 12) % 12]);
        }
      }
    }
  }

  return {
    sets: sets.length,
    pairs,
    notePairs,
    keyRelationship: sorted(rel),
    signatureDelta: sorted(sigDelta),
    topKeyChanges: sorted(tonicMove).slice(0, 15),
    typeRelationship: sorted(typeRel),
    meterRelationship: sorted(meterRel),
    lastNoteVsOwnTonic: sorted(lastVsTonicA),
    firstNoteVsOwnTonic: sorted(firstVsTonicB),
    nextFirstNoteVsPrevTonic: sorted(firstVsTonicA),
  };
}
