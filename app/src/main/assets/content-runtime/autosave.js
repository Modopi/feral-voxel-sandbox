import {prepareSaveMessage} from './save-worker.js';
import {EXPEDITION_SCHEMA} from './save.js';

// One worker request and one latest pending snapshot. No growing save queue.
export class Autosave {
  constructor(store, {onSaved = () => {}, onError = () => {}, workerFactory} = {}) {
    this.store = store; this.onSaved = onSaved; this.onError = onError;
    this.disposed = false; this.serial = 0; this.active = null; this.pending = null;
    this.timer = null; this.worker = null;
    this.workerFactory = workerFactory ?? (() => typeof Worker === 'undefined' ? null :
      new Worker(new URL('./save-worker.js', import.meta.url), {type:'module'}));
    this._connect();
  }
  _connect() {
    try { this.worker = this.workerFactory(); } catch { this.worker = null; }
    if (!this.worker) return;
    const worker = this.worker;
    worker.onmessage = event => { if (this.worker === worker) this._complete(event.data); };
    worker.onerror = event => { event.preventDefault?.(); if (this.worker === worker) this._fallback(); };
    worker.onmessageerror = () => { if (this.worker === worker) this._fallback(); };
  }
  schedule(state) {
    if (this.disposed) return false;
    try {
      const scheduledAt = performance.now();
      // An immutable JSON snapshot avoids two costly structured clones of large
      // object graphs (capture + postMessage). Compression/validation stay off-thread.
      const json = JSON.stringify({...state, schema:EXPEDITION_SCHEMA});
      this.pending = {id:++this.serial, json, revision:this.store.revision, scheduledAt};
      this._start();
      return true;
    } catch (error) { this.onError(error); return false; }
  }
  _start() {
    if (this.disposed || this.active || !this.pending) return;
    if (this.pending.revision !== this.store.revision) { this.pending = null; return; }
    this.active = {...this.pending, sequence:this.store.sequence + 1};
    this.pending = null;
    if (this.worker) {
      try { this.worker.postMessage(this.active); } catch { this._fallback(); }
    } else this._deferFallback();
  }
  _deferFallback() {
    const job = this.active;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.disposed && this.active === job) this._complete(prepareSaveMessage(job));
    }, 0);
  }
  _fallback() {
    this.worker?.terminate(); this.worker = null;
    if (this.active && this.timer === null) this._deferFallback();
  }
  _complete(message) {
    const job = this.active;
    if (this.disposed || !job || message?.id !== job.id) return;
    this.active = null;
    // A newer queued snapshot or any synchronous write supersedes this result.
    if (job.id === this.serial && job.revision === this.store.revision) {
      try {
        if (message.error) throw Error(message.error);
        const start = performance.now();
        const sequence = this.store.commitPrepared(message.raw, job.revision);
        if (sequence !== null) this.onSaved(sequence, {mode:this.worker ? 'worker' : 'fallback',
          preparationMs:message.preparationMs, commitMs:performance.now() - start,
          elapsedMs:performance.now() - job.scheduledAt});
      } catch (error) { this.onError(error); }
    }
    this._start();
  }
  writeNow(state) {
    if (this.disposed) throw Error('종료된 자동 저장입니다.');
    this.serial++; this.pending = null; this.active = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    // Keep a module worker for future saves, but stop obsolete expensive work.
    if (this.worker) { this.worker.terminate(); this.worker = null; this._connect(); }
    const start = performance.now(), sequence = this.store.write(state);
    this.onSaved(sequence, {mode:'sync', elapsedMs:performance.now() - start});
    return sequence;
  }
  dispose() {
    this.disposed = true; this.serial++; this.pending = null; this.active = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null; this.worker?.terminate(); this.worker = null;
  }
}
