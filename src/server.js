import express from 'express';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionFetcher, jobStart, jobUpdate, jobSubscribe } from './fetch-queue.js';
import { meterFor, keySignature, prettyKey, buildAbc } from './abc.js';
import { meterColor, sigColor } from './palette.js';
import { parseKey, stepNeighbours, edgeNotes, pcName } from './music.js';
import { analyzeSets } from './analysis.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// Reuse the flashcards project's cache when present so tunes fetched for the
// PDF generator (or vice versa) don't get re-downloaded.
const SIBLING_CACHE = join(ROOT, '..', 'tunebook-flashcards', '.cache');
const CACHE_DIR = process.env.CACHE_DIR || (existsSync(SIBLING_CACHE) ? SIBLING_CACHE : join(ROOT, '.cache'));
const DATA_DIR = join(ROOT, 'data');
const MYSETS = join(DATA_DIR, 'mysets.json');

const BASE = 'https://thesession.org';
const fetcher = new SessionFetcher({ cacheDir: CACHE_DIR });
const app = express();
app.use(express.json());
app.use(express.static(join(ROOT, 'web')));
app.use('/vendor/abcjs', express.static(join(ROOT, 'node_modules', 'abcjs')));

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

function keyCard(key, setting, type) {
  const p = parseKey(key);
  const sig = keySignature(key) || { count: 0, label: '0' };
  const edges = setting ? edgeNotes(setting.abc, p ? p.sig : 0) : { first: null, last: null };
  const neighbours = p ? stepNeighbours(key) : null;
  return {
    key,
    label: prettyKey(key),
    settingId: setting ? setting.id : null,
    tonicPc: p ? p.pc : null,
    mode: p ? p.mode : null,
    sig: { count: sig.count, label: sig.label, color: sigColor(sig.count) },
    firstNote: edges.first, // midi number or null
    lastNote: edges.last,
    firstName: edges.first === null ? null : pcName(edges.first),
    lastName: edges.last === null ? null : pcName(edges.last),
    stepUpPc: neighbours ? neighbours.up : null,
    stepDownPc: neighbours ? neighbours.down : null,
    abc: setting ? buildAbc({ key, type, body: setting.abc, bars: 2 }) : null,
  };
}

// Build one tunebook entry with per-key info needed by the set builder.
function buildEntry(raw) {
  const groups = new Map(); // key -> most common / earliest setting
  for (const s of raw.settings || []) {
    const g = groups.get(s.key);
    if (!g) groups.set(s.key, { count: 1, setting: s });
    else { g.count++; if (s.id < g.setting.id) g.setting = s; }
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].count - a[1].count || a[1].setting.id - b[1].setting.id);
  const meterLabel = meterFor(raw.type).meter;
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    url: `https://thesession.org/tunes/${raw.id}`,
    meter: { label: meterLabel, color: meterColor(meterLabel) },
    keys: ranked.slice(0, 4).map(([key, g]) => keyCard(key, g.setting, raw.type)),
  };
}

// Realtime progress stream for a job id (SSE). The client opens this and
// passes the same id as ?job= on the slow request; order doesn't matter.
app.get('/api/progress/:id', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const unsubscribe = jobSubscribe(req.params.id, res);
  req.on('close', unsubscribe);
});

app.get('/api/member/:ref', async (req, res) => {
  try {
    const ref = String(req.params.ref).trim();
    if (/^\d+$/.test(ref)) return res.json({ id: Number(ref) });
    const data = await fetcher.getJson(`${BASE}/members/search?q=${encodeURIComponent(ref)}&format=json`);
    const members = data.members || [];
    const exact = members.filter((m) => m.name.toLowerCase() === ref.toLowerCase());
    const pool = exact.length ? exact : members;
    if (pool.length !== 1) {
      return res.status(404).json({ error: pool.length ? 'multiple members match — use the numeric id' : `no member found for "${ref}"` });
    }
    res.json({ id: pool[0].id });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.get('/api/tunebook/:id', async (req, res) => {
  const job = req.query.job;
  try {
    const id = Number(req.params.id);
    jobStart(job, 'tunebook pages');
    const first = await fetcher.getJson(`${BASE}/members/${id}/tunebook?format=json&page=1`);
    const pages = first.pages || 1;
    const list = [...(first.tunes || [])];
    jobUpdate(job, { total: pages, done: 1 });
    for (let p = 2; p <= pages; p++) {
      const d = await fetcher.getJson(`${BASE}/members/${id}/tunebook?format=json&page=${p}`);
      list.push(...(d.tunes || []));
      jobUpdate(job, { done: p });
    }
    jobUpdate(job, { phase: 'fetching tunes', total: list.length, done: 0 });
    let done = 0;
    const entries = await mapLimit(list, 4, async (t) => {
      const e = buildEntry(await fetcher.getJson(`${BASE}/tunes/${t.id}?format=json`));
      jobUpdate(job, { done: ++done });
      return e;
    });
    jobUpdate(job, { status: 'done' });
    res.json({ tunes: entries });
  } catch (e) {
    jobUpdate(job, { status: 'error' });
    res.status(500).json({ error: e.message });
  }
});

async function fetchAllSets(id, job) {
  const first = await fetcher.getJson(`${BASE}/members/${id}/sets?format=json&page=1`);
  const pages = first.pages || 1;
  const sets = [...(first.sets || [])];
  jobUpdate(job, { total: pages, done: 1 });
  for (let p = 2; p <= pages; p++) {
    const d = await fetcher.getJson(`${BASE}/members/${id}/sets?format=json&page=${p}`);
    sets.push(...(d.sets || []));
    jobUpdate(job, { done: p });
  }
  return sets;
}

// Full notation for one setting of a tune (the set-appropriate key), with
// complete ABC headers so abcjs can engrave the whole tune.
app.get('/api/fullabc/:tuneId/:settingId', async (req, res) => {
  try {
    const raw = await fetcher.getJson(`${BASE}/tunes/${Number(req.params.tuneId)}?format=json`);
    const s = (raw.settings || []).find((x) => x.id === Number(req.params.settingId));
    if (!s) return res.status(404).json({ error: 'setting not found' });
    const p = parseKey(s.key);
    const { meter, unitNote } = meterFor(raw.type);
    // thesession bodies use "!" as a line break in older transcriptions
    const body = String(s.abc || '').replace(/!/g, '\n').replace(/\r/g, '');
    const abc = `X:1\nT:${raw.name}\nR:${raw.type}\nM:${meter}\nL:${unitNote}\nK:${p ? `${p.tonic} ${p.mode}` : 'C'}\n${body}`;
    res.json({ abc, name: raw.name, key: s.key, type: raw.type });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sets/:id', async (req, res) => {
  try { res.json({ sets: await fetchAllSets(Number(req.params.id)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/analysis/:id', async (req, res) => {
  const job = req.query.job;
  try {
    jobStart(job, 'set pages');
    const sets = await fetchAllSets(Number(req.params.id), job);
    const tuneIds = new Set();
    for (const s of sets) for (const st of s.settings) {
      const m = st.url.match(/\/tunes\/(\d+)/);
      if (m) tuneIds.add(Number(m[1]));
    }
    jobUpdate(job, { phase: 'fetching tunes', total: tuneIds.size, done: 0 });
    const tunes = {};
    let done = 0;
    await mapLimit([...tuneIds], 4, async (tid) => {
      tunes[tid] = await fetcher.getJson(`${BASE}/tunes/${tid}?format=json`);
      jobUpdate(job, { done: ++done });
    });
    jobUpdate(job, { status: 'done' });
    res.json(analyzeSets(sets, tunes));
  } catch (e) {
    jobUpdate(job, { status: 'error' });
    res.status(500).json({ error: e.message });
  }
});

// One tunebook-style entry for any tune id (for loading Whelan sets whose
// tunes aren't in the member's tunebook).
app.get('/api/tune/:id', async (req, res) => {
  try { res.json(buildEntry(await fetcher.getJson(`${BASE}/tunes/${Number(req.params.id)}?format=json`))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// John Whelan's emailed sets (parsed corpus in data/whelan-sets.json),
// deduped by tune+key sequence with play counts and date range.
let whelanCache = null;
app.get('/api/whelan', (req, res) => {
  try {
    if (!whelanCache) {
      const instances = JSON.parse(readFileSync(join(DATA_DIR, 'whelan-sets.json'), 'utf8'));
      const groups = new Map();
      for (const s of instances) {
        const tunes = s.settings.map((st) => {
          const sig = keySignature(st.key) || { count: 0 };
          return {
            tuneId: Number((st.url.match(/tunes\/(\d+)/) || [])[1]),
            settingId: st.id, name: st.name, key: st.key,
            label: prettyKey(st.key), sigColor: sigColor(sig.count), type: st.type,
          };
        });
        if (tunes.some((t) => !t.tuneId)) continue;
        const k = tunes.map((t) => `${t.tuneId}:${t.key}`).join(',');
        const g = groups.get(k);
        if (g) { g.count++; g.dates.push(s.date); }
        else groups.set(k, { tunes, count: 1, dates: [s.date] });
      }
      whelanCache = [...groups.values()].map((g) => ({
        tunes: g.tunes, count: g.count, type: g.tunes[0].type,
        first: g.dates.reduce((a, b) => (a < b ? a : b)),
        last: g.dates.reduce((a, b) => (a > b ? a : b)),
      }));
    }
    res.json({ sets: whelanCache });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Locally saved sets (thesession.org has no write API).
function readMySets() {
  try { return JSON.parse(readFileSync(MYSETS, 'utf8')); } catch { return []; }
}
app.get('/api/mysets', (req, res) => res.json({ sets: readMySets() }));
app.post('/api/mysets', (req, res) => {
  const { name, tunes } = req.body || {};
  if (!Array.isArray(tunes) || tunes.length === 0) return res.status(400).json({ error: 'tunes required' });
  mkdirSync(DATA_DIR, { recursive: true });
  const sets = readMySets();
  const set = { id: Date.now(), name: name || tunes.map((t) => t.name).join(', '), created: new Date().toISOString(), tunes };
  sets.push(set);
  writeFileSync(MYSETS, JSON.stringify(sets, null, 2));
  res.json({ set });
});
app.delete('/api/mysets/:id', (req, res) => {
  const sets = readMySets().filter((s) => String(s.id) !== req.params.id);
  writeFileSync(MYSETS, JSON.stringify(sets, null, 2));
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3117;
app.listen(PORT, () => console.log(`tunebook-sets listening on http://localhost:${PORT} (cache: ${CACHE_DIR})`));
