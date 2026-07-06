// Polite, globally-throttled fetcher for thesession.org.
// All network requests across all endpoints flow through ONE sequential queue
// with a minimum gap between requests; disk-cache hits bypass the queue.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const UA = 'Mozilla/5.0 (compatible; tunebook-sets; +https://github.com/skylos)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SessionFetcher {
  constructor({ cacheDir, minDelayMs = 300 } = {}) {
    this.cacheDir = cacheDir;
    mkdirSync(cacheDir, { recursive: true });
    this.minDelayMs = minDelayMs;
    this.queue = [];
    this.draining = false;
    this.lastFinish = 0;
  }

  stats() { return { queued: this.queue.length, draining: this.draining }; }

  getJson(url) {
    const file = join(this.cacheDir, createHash('sha1').update(url).digest('hex') + '.json');
    if (existsSync(file)) return Promise.resolve(JSON.parse(readFileSync(file, 'utf8')));
    return new Promise((resolve, reject) => {
      this.queue.push({ url, file, resolve, reject });
      this.#drain();
    });
  }

  async #drain() {
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length) {
      const task = this.queue.shift();
      const wait = this.lastFinish + this.minDelayMs - Date.now();
      if (wait > 0) await sleep(wait);
      try { task.resolve(await this.#fetch(task)); }
      catch (e) { task.reject(e); }
      this.lastFinish = Date.now();
    }
    this.draining = false;
  }

  async #fetch({ url, file }) {
    let res, attempt = 0;
    while (true) {
      try {
        res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      } catch (e) {
        if (attempt < 5) { await sleep(1000 * 2 ** attempt++); continue; }
        throw e;
      }
      if (res.ok) break;
      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        await sleep(1000 * 2 ** attempt++); continue;
      }
      throw new Error(`GET ${url} -> ${res.status}`);
    }
    const json = await res.json();
    writeFileSync(file, JSON.stringify(json));
    return json;
  }
}

// ---- job registry: progress state pushed to SSE listeners ----
const jobs = new Map();

export function jobStart(id, phase) {
  if (!id) return;
  const j = jobs.get(id) || { listeners: new Set() };
  Object.assign(j, { phase, total: 0, done: 0, status: 'running' });
  jobs.set(id, j);
}

export function jobUpdate(id, patch) {
  if (!id) return;
  const j = jobs.get(id);
  if (!j) return;
  Object.assign(j, patch);
  const payload = `data: ${JSON.stringify({ phase: j.phase, total: j.total, done: j.done, status: j.status })}\n\n`;
  for (const res of j.listeners) res.write(payload);
  if (j.status === 'done' || j.status === 'error') {
    for (const res of j.listeners) res.end();
    setTimeout(() => jobs.delete(id), 60_000);
  }
}

export function jobSubscribe(id, res) {
  let j = jobs.get(id);
  if (!j) { j = { phase: 'pending', total: 0, done: 0, status: 'running', listeners: new Set() }; jobs.set(id, j); }
  j.listeners.add(res);
  res.write(`data: ${JSON.stringify({ phase: j.phase, total: j.total, done: j.done, status: j.status })}\n\n`);
  return () => j.listeners.delete(res);
}
