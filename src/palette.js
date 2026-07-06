// Vendored from tunebook-flashcards (same author) so this repo is self-contained.
export const METER_COLORS = { '4/4':'#2f6fed','6/8':'#1f9d57','9/8':'#14a3a3','12/8':'#7b53d6','2/4':'#e8821a','3/4':'#d23f6f','3/2':'#8a6d3b' };
export const METER_SLOTS = ['4/4','6/8','9/8','12/8','2/4','3/4','3/2'];
// Signed key-signature count → color, from flats (warm) through none (grey) to
// sharps (cool). Range −3…+4 covers every key signature Irish trad uses (3 flats
// = Eb/Cm/Fdor … 4 sharps = E/C#m); anything outside falls back to grey.
export const KEYSIG_COLORS = { '-3':'#7f1d1d','-2':'#dc2626','-1':'#d97706','0':'#6b7280','1':'#14b8a6','2':'#3b82f6','3':'#6366f1','4':'#8b5cf6' };
export const KEYSIG_SLOTS = [-3, -2, -1, 0, 1, 2, 3, 4];
export const FALLBACK = '#6b7280';
export const meterColor = (m) => METER_COLORS[m] || FALLBACK;
export const sigColor = (c) => KEYSIG_COLORS[String(c)] || FALLBACK;
