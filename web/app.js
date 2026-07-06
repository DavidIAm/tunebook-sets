/* Tunebook Sets frontend. Data flows: load tunebook -> cards; set builder
   suggests next tunes by cousin key (same signature) or step transition
   (candidate's first note one diatonic step above/below current tonic). */

const $ = (s) => document.querySelector(s);
const state = { memberId: null, tunes: [], set: [] };

// ---------- localStorage (primary store — the app is local-first) ----------
const LS = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }, // quota → just skip caching
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---------- helpers ----------
const status = (msg) => { $('#status').textContent = msg; };

// status text plus a clickable "refresh" affordance
function statusWithRefresh(msg, onRefresh) {
  const el = $('#status');
  el.textContent = msg + ' ';
  const a = document.createElement('a');
  a.href = '#';
  a.textContent = '↻ refresh';
  a.addEventListener('click', (e) => { e.preventDefault(); onRefresh(); });
  el.appendChild(a);
}

// subscribe to server-side fetch progress (SSE) for a job id
function watchProgress(jobId) {
  const bar = $('#fetch-progress');
  const es = new EventSource(`/api/progress/${jobId}`);
  es.onmessage = (ev) => {
    const p = JSON.parse(ev.data);
    if (p.status !== 'running') { es.close(); bar.hidden = true; return; }
    if (p.total > 0) { bar.hidden = false; bar.max = p.total; bar.value = p.done; }
    status(`${p.phase} ${p.done}/${p.total || '…'}`);
  };
  es.onerror = () => { /* stream ends when job completes */ };
  return { close: () => { es.close(); bar.hidden = true; } };
}

const newJobId = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

function renderAbcInto(el, abc) {
  if (!abc || !window.ABCJS) return;
  try {
    ABCJS.renderAbc(el, abc, { responsive: 'resize', paddingtop: 0, paddingbottom: 0, staffwidth: 200 });
  } catch { /* bad ABC: skip notation */ }
}

// ---------- tabs ----------
document.querySelectorAll('nav .tab').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('nav .tab').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + b.dataset.view));
  if (b.dataset.view === 'whelan') ensureWhelan().catch((e) => status('error: ' + e.message));
}));

// ---------- load tunebook (browser-cache first, network on demand) ----------
async function loadTunebook(id, force = false) {
  const key = `ts_tunebook_${id}`;
  if (!force) {
    const cached = LS.get(key);
    if (cached && cached.tunes) {
      state.tunes = cached.tunes;
      statusWithRefresh(
        `${cached.tunes.length} tunes from browser cache (${new Date(cached.at).toLocaleDateString()})`,
        () => loadTunebook(id, true));
      populateFilters(); renderCards(); renderSuggestions();
      return;
    }
  }
  const jobId = newJobId();
  const progress = watchProgress(jobId);
  try {
    const { tunes } = await api(`/api/tunebook/${id}?job=${jobId}`);
    state.tunes = tunes;
    LS.set(key, { at: Date.now(), tunes });
    status(`${tunes.length} tunes loaded`);
    populateFilters(); renderCards(); renderSuggestions();
  } finally { progress.close(); }
}

$('#member-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ref = $('#member-input').value.trim();
  if (!ref) return;
  try {
    status('resolving member…');
    const { id } = await api(`/api/member/${encodeURIComponent(ref)}`);
    state.memberId = id;
    await loadTunebook(id);
  } catch (err) { status('error: ' + err.message); }
});

// ---------- cards view ----------
function populateFilters() {
  const types = [...new Set(state.tunes.map((t) => t.type))].sort();
  $('#card-type').innerHTML = '<option value="">all types</option>' + types.map((t) => `<option>${esc(t)}</option>`).join('');
  const keys = [...new Set(state.tunes.flatMap((t) => t.keys.map((k) => k.label)))].sort();
  $('#card-key').innerHTML = '<option value="">all keys</option>' + keys.map((k) => `<option>${esc(k)}</option>`).join('');
}

function cardHtml(t, extra = '') {
  const k = t.keys[0] || {};
  const notes = k.firstName ? `starts ${k.firstName} · ends ${k.lastName}` : '';
  return `
    <div class="band-top" style="background:${k.sig ? k.sig.color : '#999'}"></div>
    <div class="band-right" style="background:${t.meter.color}"></div>
    <span class="tab-key">${esc(k.label || '?')}</span>
    <span class="tab-meter">${esc(t.meter.label)}</span>
    <h3>${esc(t.name)}</h3>
    <div class="meta">${esc(t.type)}${t.keys.length > 1 ? ' · also ' + t.keys.slice(1).map((x) => esc(x.label)).join(', ') : ''}</div>
    <div class="notes">${esc(notes)}</div>
    <div class="abc"></div>
    ${extra}`;
}

function renderCards() {
  const q = $('#card-search').value.trim().toLowerCase();
  const type = $('#card-type').value;
  const key = $('#card-key').value;
  const grid = $('#card-grid');
  grid.innerHTML = '';
  const shown = state.tunes.filter((t) =>
    (!q || t.name.toLowerCase().includes(q)) &&
    (!type || t.type === type) &&
    (!key || t.keys.some((k) => k.label === key)));
  for (const t of shown.slice(0, 200)) {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = cardHtml(t, `<button class="add">add to set</button>`);
    div.querySelector('.add').addEventListener('click', (e) => { e.stopPropagation(); addToSet(t); });
    div.addEventListener('click', () => window.open(t.url, '_blank'));
    grid.appendChild(div);
    renderAbcInto(div.querySelector('.abc'), t.keys[0] && t.keys[0].abc);
  }
  if (shown.length > 200) {
    const note = document.createElement('p');
    note.textContent = `…showing 200 of ${shown.length}; narrow the filter.`;
    grid.appendChild(note);
  }
}
['#card-search', '#card-type', '#card-key'].forEach((s) => $(s).addEventListener('input', renderCards));

// ---------- set builder ----------
function addToSet(tune, keyIdx = 0) {
  state.set.push({ tune, keyIdx });
  renderCurrentSet();
  renderSuggestions();
  document.querySelector('nav .tab[data-view=builder]').click();
}

function renderCurrentSet() {
  const ol = $('#current-set');
  ol.innerHTML = '';
  state.set.forEach((item, i) => {
    const k = item.tune.keys[item.keyIdx];
    const li = document.createElement('li');
    li.innerHTML = `${esc(item.tune.name)}
      <span class="key-chip" style="background:${k.sig.color}">${esc(k.label)}</span>
      <button title="remove">✕</button>`;
    li.querySelector('button').addEventListener('click', () => { state.set.splice(i, 1); renderCurrentSet(); renderSuggestions(); });
    ol.appendChild(li);
  });
  if (!state.set.length) ol.innerHTML = '<li style="list-style:none;color:#888">empty — add a starting tune from Cards or Suggestions</li>';
}

function suggestionReason(mode, last, cand) {
  if (!last) return '';
  const lk = last.tune.keys[last.keyIdx];
  if (mode === 'cousin') return `same signature as ${lk.label} (${lk.sig.label})`;
  if (mode === 'step') {
    const pc = cand.firstNote % 12;
    if (pc === lk.stepUpPc) return `first note ${cand.firstName} = one step up from ${lk.label}`;
    if (pc === lk.stepDownPc) return `first note ${cand.firstName} = one step down from ${lk.label}`;
  }
  return '';
}

function candidateKeys(tune) { return tune.keys.map((k, i) => ({ ...k, keyIdx: i })); }

/* Voice-leading match: previous tune's final note → candidate's first note.
   Pitch-class based so octave doesn't matter. Returns null when they don't
   connect by one of the three favored intervals. */
function voiceLead(lk, k) {
  if (lk.lastNote === null || k.firstNote === null) return null;
  const vl = ((k.firstNote % 12) - (lk.lastNote % 12) + 12) % 12;
  if (vl === 0) return { score: 3, why: `starts on ${k.firstName}, the note the last tune ends on` };
  if (vl === 7) return { score: 2, why: `starts ${k.firstName}, a 5th above the ending ${lk.lastName}` };
  if (vl === 2) return { score: 1, why: `starts ${k.firstName}, a step above the ending ${lk.lastName}` };
  return null;
}

/* "Style match" scoring, weights derived from analyzing 619 of skylos's sets
   (1012 consecutive-tune pairs):
   - 63% of transitions move ±1 key signature; staying in the exact same key
     is rarer than chance (lift ~0.6), cousins ~15%.
   - Next tune's first note lands on the 5th / tonic / 2nd of the previous
     tune's tonic far more than other degrees.
   - Voice-leading: same pitch, up a fifth, or up a step from the previous
     tune's final note are the top last→first intervals. */
function styleScore(lk, k) {
  let score = 0;
  const why = [];
  const d = k.sig.count - lk.sig.count;
  const sameKey = k.label === lk.label;
  if (sameKey) score += 0.5;
  else if (Math.abs(d) === 1) { score += 3; why.push(`signature ${d > 0 ? '+1♯' : '−1♯'}`); }
  else if (d === 0) { score += 2; why.push('cousin key'); }
  if (k.firstNote !== null && lk.tonicPc !== null) {
    const iv = ((k.firstNote % 12) - lk.tonicPc + 12) % 12;
    const ivBonus = { 7: 2, 0: 2, 2: 1.5, 9: 1, 5: 1, 10: 1, 11: 1 }[iv] || 0;
    score += ivBonus;
    const tonic = lk.label.split(' ')[0];
    if (iv === 0) why.push(`starts on ${tonic}, the previous tonic`);
    else if (iv === 7) why.push(`starts ${k.firstName}, a 5th above ${tonic}`);
    else if (iv === 2) why.push(`starts ${k.firstName}, a step above ${tonic}`);
  }
  if (k.firstNote !== null && lk.lastNote !== null) {
    const vl = ((k.firstNote % 12) - (lk.lastNote % 12) + 12) % 12;
    const vlBonus = { 0: 1, 7: 0.75, 2: 0.75, 5: 0.5 }[vl] || 0;
    score += vlBonus;
    if (vl === 0) why.push(`picks up the ending note (${lk.lastName})`);
  }
  return { score, why: why.join(' · ') };
}

/* Heuristic suggestions: given a seed tune+key (the first tune of the current
   set), compose six full 3-tune sets that follow the patterns found in the
   set-corpus analysis:
   - same rhythm throughout (92% of observed transitions keep the type)
   - each transition moves ±1 key signature (63% of observed transitions)
   - the set arches home: closer in the seed's key (exact ABA), or at least
     its signature (cousin arch)
   - transitions are ranked by voice-leading: the next tune starting on the
     previous tune's final note beats a 5th above, beats a step above. */
function seamScore(prevK, candK) {
  if (prevK.lastNote === null || candK.firstNote === null) return { s: 0, why: '' };
  const vl = ((candK.firstNote % 12) - (prevK.lastNote % 12) + 12) % 12;
  if (vl === 0) return { s: 3, why: `picks up the ending ${prevK.lastName}` };
  if (vl === 7) return { s: 2, why: `starts ${candK.firstName}, a 5th above the ending ${prevK.lastName}` };
  if (vl === 2) return { s: 1, why: `starts ${candK.firstName}, a step above the ending ${prevK.lastName}` };
  return { s: 0, why: '' };
}

/* Position-aware search. The seed can open the set, sit in the middle, or
   close it ("contains" tries all three; "start"/"end" pin it). The shape is
   always sig(A), sig(A)±1, sig(A) — one signature step per seam — with the
   arch judged closer-vs-opener (exact key +2, cousin +0.5). */
function heuristicSets(seed, pos, recipe) {
  const sk = seed.tune.keys[seed.keyIdx];
  const seedSlot = { tune: seed.tune, keyIdx: seed.keyIdx, k: sk };
  const pool = [];
  for (const t of state.tunes) {
    if (t.id === seed.tune.id || t.type !== seed.tune.type) continue;
    t.keys.forEach((k, i) => pool.push({ tune: t, keyIdx: i, k }));
  }
  const step = pool.filter((x) => Math.abs(x.k.sig.count - sk.sig.count) === 1);
  const same = pool.filter((x) => x.k.sig.count === sk.sig.count);

  const mk = (a, b, c, seedPos) => {
    const s1 = seamScore(a.k, b.k), s2 = seamScore(b.k, c.k);
    const exact = c.k.label === a.k.label;
    return {
      items: [a, b, c].map((x) => ({ tune: x.tune, keyIdx: x.keyIdx })),
      keys: [a.k, b.k, c.k],
      whys: [null, s1.why || null,
        [(exact ? `arches home to ${a.k.label}` : `cousin arch (${c.k.sig.label})`), s2.why].filter(Boolean).join(' · ')],
      score: s1.s + s2.s + (exact ? 2 : 0.5),
      seedPos,
    };
  };

  const combos = [];
  if (recipe === 'conventional') {
    /* Conventional recipe, calibrated on four unrelated prolific members
       (JimW, Bregolas, Julie Triedman, Kevin Healy): every corpus favors
       ±1-step seams but also uses cousins and same-key freely; arch is a
       tendency, not a rule. Seam weight: step 1.5 > cousin 1.0 > same key
       0.75; jumps ≥2 excluded. Arch is a small bonus (+0.75 exact / +0.25
       signature). Voice-leading scoring is unchanged — it was the most
       universal pattern in every corpus. */
    const near = (fromK) => pool.filter((x) => Math.abs(x.k.sig.count - fromK.sig.count) <= 1);
    const catW = (pk, ck) => {
      const d = ck.sig.count - pk.sig.count;
      if (Math.abs(d) === 1) return { w: 1.5, why: `signature ${d > 0 ? '+1♯' : '−1♯'}` };
      if (pk.label === ck.label) return { w: 0.75, why: 'same key' };
      return { w: 1.0, why: 'cousin key' };
    };
    const mkc = (a, b, c, seedPos) => {
      const c1 = catW(a.k, b.k), c2 = catW(b.k, c.k);
      const s1 = seamScore(a.k, b.k), s2 = seamScore(b.k, c.k);
      const arch = c.k.label === a.k.label ? 0.75 : c.k.sig.count === a.k.sig.count ? 0.25 : 0;
      return {
        items: [a, b, c].map((x) => ({ tune: x.tune, keyIdx: x.keyIdx })),
        keys: [a.k, b.k, c.k],
        whys: [null,
          [c1.why, s1.why].filter(Boolean).join(' · '),
          [c2.why, arch ? (arch === 0.75 ? `arches home to ${a.k.label}` : 'signature arch') : null, s2.why].filter(Boolean).join(' · ')],
        score: c1.w + c2.w + s1.s + s2.s + arch,
        seedPos,
      };
    };
    if (pos === 'start' || pos === 'contains')
      for (const x of near(sk)) for (const y of near(x.k))
        if (y.tune.id !== x.tune.id) combos.push(mkc(seedSlot, x, y, 1));
    if (pos === 'contains')
      for (const x of near(sk)) for (const y of near(sk))
        if (y.tune.id !== x.tune.id) combos.push(mkc(x, seedSlot, y, 2));
    if (pos === 'end' || pos === 'contains')
      for (const x of pool) for (const m of near(x.k))
        if (m.tune.id !== x.tune.id && Math.abs(sk.sig.count - m.k.sig.count) <= 1)
          combos.push(mkc(x, m, seedSlot, 3));
  } else {
    if (pos === 'start' || pos === 'contains')
      for (const m of step) for (const e of same)
        if (e.tune.id !== m.tune.id) combos.push(mk(seedSlot, m, e, 1));
    if (pos === 'contains')
      for (const x of step) for (const y of pool)
        if (y.tune.id !== x.tune.id && y.k.sig.count === x.k.sig.count) combos.push(mk(x, seedSlot, y, 2));
    if (pos === 'end' || pos === 'contains')
      for (const x of same) for (const m of step)
        if (m.tune.id !== x.tune.id) combos.push(mk(x, m, seedSlot, 3));
  }

  combos.sort((a, b) => b.score - a.score);
  // diversity: no non-seed tune may appear in more than two of the six picks
  const picked = [], use = {};
  for (const c of combos) {
    const others = c.items.filter((x) => x.tune.id !== seed.tune.id);
    if (others.some((x) => (use[x.tune.id] || 0) >= 2)) continue;
    picked.push(c);
    for (const x of others) use[x.tune.id] = (use[x.tune.id] || 0) + 1;
    if (picked.length === 6) break;
  }
  return picked;
}

function renderHeuristicSets(grid, view) {
  const seed = state.set[0];
  if (!seed) {
    grid.innerHTML = '<p style="color:#888">add a starting tune first — the six proposed sets are seeded by the first tune of the current set</p>';
    return;
  }
  const sk = seed.tune.keys[seed.keyIdx];
  const pos = document.querySelector('input[name=heurpos]:checked').value;
  const recipe = document.querySelector('input[name=heurrecipe]:checked').value;
  const picked = heuristicSets(seed, pos, recipe);
  if (!picked.length) {
    grid.innerHTML = '<p style="color:#888">no same-rhythm tunes one signature step away — try a different seed</p>';
    return;
  }
  const posText = { contains: 'containing', start: 'starting with', end: 'ending with' }[pos];
  const recipeText = recipe === 'whelan'
    ? 'one signature step per seam, arch home, smooth handoffs'
    : 'steps, cousins & same-key seams, arch optional, smooth handoffs';
  const head = document.createElement('p');
  head.className = 'heuristic-head';
  head.textContent = `Six 3-tune ${seed.tune.type} sets ${posText} “${seed.tune.name}” (${sk.label}) — ${recipeText}:`;
  grid.appendChild(head);

  const useSet = (c) => () => {
    state.set = c.items;
    renderCurrentSet();
    renderSuggestions();
  };
  const isSeed = (x) => x.tune.id === seed.tune.id;

  if (view === 'cards') {
    picked.forEach((c, n) => {
      const col = document.createElement('div');
      col.className = 'setcol';
      col.innerHTML = `<div class="setcol-head"><b>Set ${n + 1}</b>
        <button class="use">use</button> <button class="music">show music</button></div>`;
      col.querySelector('.use').addEventListener('click', useSet(c));
      col.querySelector('.music').addEventListener('click', () => showMusic(c.items, c.whys));
      c.items.forEach((x, i) => {
        const k = c.keys[i];
        const t = { ...x.tune, keys: [k, ...x.tune.keys.filter((_, j) => j !== x.keyIdx)] };
        const div = document.createElement('div');
        div.className = 'card' + (isSeed(x) ? ' seed' : '');
        div.innerHTML = cardHtml(t, c.whys[i] ? `<div class="why">${esc(c.whys[i])}</div>` : '');
        col.appendChild(div);
        renderAbcInto(div.querySelector('.abc'), k.abc);
      });
      grid.appendChild(col);
    });
    return;
  }

  const chip = (k) => `<span class="key-chip" style="background:${k.sig.color}">${esc(k.label)}</span>`;
  picked.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'setcard';
    const rows = c.items.map((x, i) => `
      <li>${isSeed(x) ? `<b>${esc(x.tune.name)}</b>` : esc(x.tune.name)} ${chip(c.keys[i])}
        ${c.whys[i] ? `<div class="why">${esc(c.whys[i])}</div>` : ''}</li>`).join('');
    div.innerHTML = `<ol>${rows}</ol>
      <button class="use">use this set</button> <button class="use music">show music</button>`;
    div.querySelector('.use').addEventListener('click', useSet(c));
    div.querySelector('.music').addEventListener('click', () => showMusic(c.items, c.whys));
    grid.appendChild(div);
  });
}

/* Full-screen notation overlay: the three tunes of a proposed set, each in
   the key chosen for that slot (the actual thesession setting, no transposing). */
let overlaySynths = [];
function stopOverlayAudio() {
  for (const s of overlaySynths) { try { s.pause(); } catch { /* not started */ } }
}
async function showMusic(items, whys = []) {
  stopOverlayAudio();
  overlaySynths = [];
  const overlay = $('#music-overlay');
  const content = $('#overlay-content');
  $('#overlay-title').textContent = items.map((x) => x.tune.name).join('  →  ');
  content.innerHTML = '<p style="color:#bbb">loading notation…</p>';
  overlay.hidden = false;
  try {
    const parts = await Promise.all(items.map(async (x) => {
      const k = x.tune.keys[x.keyIdx];
      if (!k.settingId) return { name: x.tune.name, k, abc: null };
      const cacheKey = `ts_abc_${x.tune.id}_${k.settingId}`;
      let abc = LS.get(cacheKey);
      if (!abc) {
        ({ abc } = await api(`/api/fullabc/${x.tune.id}/${k.settingId}`));
        LS.set(cacheKey, abc);
      }
      return { name: x.tune.name, k, abc };
    }));
    content.innerHTML = '';
    parts.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'overlay-tune';
      div.innerHTML = `<h3>${i + 1}. ${esc(p.name)}
          <span class="key-chip" style="background:${p.k.sig.color}">${esc(p.k.label)}</span></h3>
        ${whys[i] ? `<div class="seam">↳ ${esc(whys[i])}</div>` : ''}
        <div class="overlay-audio" id="overlay-audio-${i}"></div>
        <div class="overlay-abc"></div>`;
      content.appendChild(div);
      if (p.abc) {
        const visual = ABCJS.renderAbc(div.querySelector('.overlay-abc'), p.abc, { responsive: 'resize', staffwidth: 760 })[0];
        if (ABCJS.synth.supportsAudio()) {
          const ctl = new ABCJS.synth.SynthController();
          ctl.load(`#overlay-audio-${i}`, null, { displayPlay: true, displayRestart: true, displayProgress: true });
          // userAction=false defers soundfont download until play is clicked
          ctl.setTune(visual, false, { chordsOff: true });
          overlaySynths.push(ctl);
        }
      } else div.querySelector('.overlay-abc').textContent = 'no notation available';
    });
  } catch (err) {
    content.innerHTML = `<p style="color:#f88">${esc(err.message)}</p>`;
  }
}
$('#overlay-close').addEventListener('click', () => { stopOverlayAudio(); $('#music-overlay').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { stopOverlayAudio(); $('#music-overlay').hidden = true; } });

function renderSuggestions() {
  const grid = $('#suggestions');
  grid.innerHTML = '';
  const mode = document.querySelector('input[name=mode]:checked').value;
  $('#heur-view-row').hidden = mode !== 'heuristic';
  $('#heur-pos-row').hidden = mode !== 'heuristic';
  $('#heur-recipe-row').hidden = mode !== 'heuristic';
  if (mode === 'heuristic') {
    const view = document.querySelector('input[name=heurview]:checked').value;
    grid.className = 'grid ' + (view === 'cards' ? 'setcols' : 'setlist');
    renderHeuristicSets(grid, view);
    return;
  }
  grid.className = 'grid small';
  const sameType = $('#same-type').checked;
  const excludeUsed = $('#exclude-used').checked;
  const last = state.set[state.set.length - 1] || null;
  const usedIds = new Set(state.set.map((x) => x.tune.id));

  let cands = [];
  for (const t of state.tunes) {
    if (excludeUsed && usedIds.has(t.id)) continue;
    if (last && sameType && t.type !== last.tune.type) continue;
    if (!last) { cands.push({ tune: t, key: t.keys[0], keyIdx: 0, why: '' }); continue; }
    const lk = last.tune.keys[last.keyIdx];
    if (mode === 'style') {
      let best = null;
      for (const k of candidateKeys(t)) {
        const { score, why } = styleScore(lk, k);
        if (!best || score > best.score) best = { tune: t, key: k, keyIdx: k.keyIdx, why, score };
      }
      if (best) cands.push(best);
      continue;
    }
    if (mode === 'voice') {
      // Rank by how the candidate's first note connects to the previous
      // tune's final note — the top last→first intervals observed in the
      // set corpus: same pitch, then up a fifth, then up a whole step.
      let best = null;
      for (const k of candidateKeys(t)) {
        const v = voiceLead(lk, k);
        if (v && (!best || v.score > best.score)) best = { tune: t, key: k, keyIdx: k.keyIdx, why: v.why, score: v.score };
      }
      if (best) cands.push(best);
      continue;
    }
    for (const k of candidateKeys(t)) {
      if (mode === 'cousin') {
        if (k.sig.count === lk.sig.count && k.label !== lk.label) {
          cands.push({ tune: t, key: k, keyIdx: k.keyIdx, why: suggestionReason(mode, last, k) });
          break;
        }
      } else if (mode === 'step') {
        if (k.firstNote !== null && ((k.firstNote % 12) === lk.stepUpPc || (k.firstNote % 12) === lk.stepDownPc)) {
          cands.push({ tune: t, key: k, keyIdx: k.keyIdx, why: suggestionReason(mode, last, k) });
          break;
        }
      } else {
        cands.push({ tune: t, key: k, keyIdx: k.keyIdx, why: '' });
        break;
      }
    }
  }
  if ((mode === 'style' || mode === 'voice') && last) cands.sort((a, b) => (b.score || 0) - (a.score || 0));

  for (const c of cands.slice(0, 60)) {
    const div = document.createElement('div');
    div.className = 'card';
    const t = { ...c.tune, keys: [c.tune.keys[c.keyIdx], ...c.tune.keys.filter((_, i) => i !== c.keyIdx)] };
    div.innerHTML = cardHtml(t, `${c.why ? `<div class="why">${esc(c.why)}</div>` : ''}<button class="add">add to set</button>`);
    div.querySelector('.add').addEventListener('click', (e) => { e.stopPropagation(); addToSet(c.tune, c.keyIdx); });
    grid.appendChild(div);
    renderAbcInto(div.querySelector('.abc'), t.keys[0] && t.keys[0].abc);
  }
  if (!cands.length) grid.innerHTML = '<p style="color:#888">no candidates — relax the filters or switch mode</p>';
}
document.querySelectorAll('#mode-row input, #same-type, #exclude-used, #heur-view-row input, #heur-pos-row input, #heur-recipe-row input').forEach((el) =>
  el.addEventListener('change', renderSuggestions));

// ---------- saved sets (localStorage; one-time import of legacy server file) ----------
async function getMySets() {
  let sets = LS.get('ts_mysets');
  if (sets === null) {
    try { sets = (await api('/api/mysets')).sets || []; } catch { sets = []; }
    LS.set('ts_mysets', sets);
  }
  return sets;
}
async function refreshSavedSets() {
  const sets = await getMySets();
  const ul = $('#saved-sets');
  ul.innerHTML = '';
  for (const s of sets) {
    const li = document.createElement('li');
    li.innerHTML = `${esc(s.name)} <button title="delete">✕</button>`;
    li.querySelector('button').addEventListener('click', () => {
      LS.set('ts_mysets', sets.filter((x) => x.id !== s.id));
      refreshSavedSets();
    });
    ul.appendChild(li);
  }
}
$('#save-set').addEventListener('click', async () => {
  if (!state.set.length) return;
  const tunes = state.set.map((x) => ({ id: x.tune.id, name: x.tune.name, key: x.tune.keys[x.keyIdx].key, type: x.tune.type }));
  const sets = await getMySets();
  sets.push({
    id: Date.now(),
    name: $('#set-name').value.trim() || tunes.map((t) => t.name).join(', '),
    created: new Date().toISOString(),
    tunes,
  });
  LS.set('ts_mysets', sets);
  $('#set-name').value = '';
  state.set = [];
  renderCurrentSet();
  renderSuggestions();
  refreshSavedSets();
});
$('#clear-set').addEventListener('click', () => { state.set = []; renderCurrentSet(); renderSuggestions(); });

// ---------- Whelan sets browser ----------
async function ensureWhelan() {
  if (state.whelan) return;
  let sets = (LS.get('ts_whelan') || {}).sets;
  if (!sets) {
    ({ sets } = await api('/api/whelan'));
    LS.set('ts_whelan', { at: Date.now(), sets });
  }
  state.whelan = sets;
  const types = [...new Set(sets.map((s) => s.type))].sort();
  $('#whelan-type').innerHTML = '<option value="">all types</option>' + types.map((t) => `<option>${esc(t)}</option>`).join('');
  renderWhelan();
}

// Turn a whelan-set tune into a builder item, fetching the tune entry if it
// isn't in the loaded tunebook. Picks the key group matching Whelan's key.
async function materialize(t) {
  let tune = state.tunes.find((x) => x.id === t.tuneId);
  if (!tune) {
    tune = await api(`/api/tune/${t.tuneId}`);
    state.tunes.push(tune);
  }
  let keyIdx = tune.keys.findIndex((k) => k.key === t.key);
  if (keyIdx < 0) keyIdx = 0;
  return { tune, keyIdx };
}

async function whelanItems(ws) {
  const items = [];
  for (const t of ws.tunes) items.push(await materialize(t));
  return items;
}

function renderWhelan() {
  const list = $('#whelan-list');
  if (!state.whelan) return;
  const q = $('#whelan-search').value.trim().toLowerCase();
  const type = $('#whelan-type').value;
  const sort = $('#whelan-sort').value;
  let sets = state.whelan.filter((s) =>
    (!type || s.type === type) &&
    (!q || s.tunes.some((t) => t.name.toLowerCase().includes(q))));
  sets = sets.slice().sort((a, b) => sort === 'recent' ? (b.last > a.last ? 1 : -1) : b.count - a.count);
  $('#whelan-stats').textContent = `${sets.length} of ${state.whelan.length} sets`;
  list.innerHTML = '';
  for (const ws of sets.slice(0, 150)) {
    const row = document.createElement('div');
    row.className = 'whelan-row';
    const tunesHtml = ws.tunes.map((t) =>
      `${esc(t.name)}<span class="key-chip" style="background:${t.sigColor}">${esc(t.label)}</span>`).join(' → ');
    row.innerHTML = `
      <div class="tunes">${tunesHtml}</div>
      <span class="meta">${esc(ws.type)}s · ${ws.count}× · ${esc(ws.first.slice(0, 7))} → ${esc(ws.last.slice(0, 7))}</span>
      <button class="load">load into builder</button>
      <button class="music">show music</button>`;
    row.querySelector('.load').addEventListener('click', async () => {
      status('loading set…');
      state.set = await whelanItems(ws);
      status('');
      renderCurrentSet();
      renderSuggestions();
      document.querySelector('nav .tab[data-view=builder]').click();
    });
    row.querySelector('.music').addEventListener('click', async () => {
      status('loading set…');
      const items = await whelanItems(ws);
      status('');
      showMusic(items);
    });
    list.appendChild(row);
  }
  if (sets.length > 150) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = `…showing 150 of ${sets.length}; narrow the filter.`;
    list.appendChild(note);
  }
}
['#whelan-search', '#whelan-type', '#whelan-sort'].forEach((s) => $(s).addEventListener('input', renderWhelan));

// ---------- analysis ----------
async function runAnalysis(force = false) {
  if (!state.memberId) { status('load a tunebook first'); return; }
  const out = $('#analysis-out');
  const key = `ts_analysis_${state.memberId}`;
  const cached = force ? null : LS.get(key);
  let a = cached ? cached.analysis : null;
  let progress = null;
  try {
    if (!a) {
      out.innerHTML = '<p>analyzing… (first run fetches every set and tune)</p>';
      const jobId = newJobId();
      progress = watchProgress(jobId);
      a = await api(`/api/analysis/${state.memberId}?job=${jobId}`);
      LS.set(key, { at: Date.now(), analysis: a });
      status('analysis complete');
    } else {
      statusWithRefresh(`analysis from browser cache (${new Date(cached.at).toLocaleDateString()})`, () => runAnalysis(true));
    }
    const table = (title, rows, denom) => `
      <h3>${esc(title)}</h3>
      <table><tr><th></th><th>count</th><th>share</th><th></th></tr>
      ${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td><td>${(100 * v / denom).toFixed(1)}%</td>
        <td><span class="bar" style="width:${Math.round(160 * v / denom)}px"></span></td></tr>`).join('')}
      </table>`;
    out.innerHTML = `
      <p><b>${a.sets}</b> sets · <b>${a.pairs}</b> consecutive-tune pairs · <b>${a.notePairs}</b> with note data</p>
      ${table('Key relationship between consecutive tunes', a.keyRelationship, a.pairs)}
      ${table('Key-signature change (sharps: next − current)', a.signatureDelta.map(([k, v]) => [`Δ ${k}`, v]), a.pairs)}
      ${table('Most common key changes', a.topKeyChanges, a.pairs)}
      ${table('Tune type', a.typeRelationship, a.pairs)}
      ${table('Meter', a.meterRelationship, a.pairs)}
      ${table('Last note of a tune vs its own tonic', a.lastNoteVsOwnTonic, a.notePairs)}
      ${table('First note of a tune vs its own tonic', a.firstNoteVsOwnTonic, a.notePairs)}
      ${table("Next tune's first note vs previous tune's tonic", a.nextFirstNoteVsPrevTonic, a.notePairs)}`;
  } catch (err) { out.innerHTML = `<p style="color:#c00">${esc(err.message)}</p>`; }
  finally { if (progress) progress.close(); }
}
$('#run-analysis').addEventListener('click', () => runAnalysis());

renderCurrentSet();
refreshSavedSets().catch(() => {});
