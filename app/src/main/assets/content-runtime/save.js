// Two complete generations; the previous valid generation survives quota errors.
import {LZString} from '../vendor/lz-string.js';
export const EXPEDITION_SCHEMA = 1;
function checksum(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
function decode(raw) {
  if (!raw) return null;
  const envelope = JSON.parse(raw);
  if (typeof envelope.payload !== 'string' || checksum(envelope.payload) !== envelope.checksum)
    throw Error('저장 데이터 검증에 실패했습니다.');
  if(envelope.encoding!=null&&envelope.encoding!=='lz-string-utf16-v1')throw Error('지원하지 않는 저장 압축 방식입니다.');
  const json=envelope.encoding?LZString.decompressFromUTF16(envelope.payload):envelope.payload;
  if(typeof json!=='string'||envelope.encoding&&json.length!==envelope.originalLength)throw Error('저장 데이터 압축을 해제하지 못했습니다.');
  const value = JSON.parse(json);
  if (value.schema !== EXPEDITION_SCHEMA || !Number.isSafeInteger(envelope.sequence) || envelope.sequence < 0)
    throw Error('지원하지 않는 탐험 저장 버전입니다.');
  if (!value.player || !['x','y','z','hp'].every(k => Number.isFinite(value.player[k])))
    throw Error('플레이어 저장값이 올바르지 않습니다.');
  return {sequence: envelope.sequence, value};
}
// Compression, expansion and full state validation may run in a dedicated worker.
// This result is only accepted for the exact store revision that requested it.
export function prepareSave(state, sequence) {
  const json = JSON.stringify({...state, schema: EXPEDITION_SCHEMA});
  return prepareSaveJson(json, sequence);
}
export function prepareSaveJson(json, sequence) {
  if (typeof json !== 'string') throw Error('저장 스냅샷이 올바르지 않습니다.');
  const compressed = LZString.compressToUTF16(json), useCompressed = compressed.length < json.length;
  const payload = useCompressed ? compressed : json;
  const raw = JSON.stringify({sequence, checksum: checksum(payload), payload,
    ...(useCompressed ? {encoding:'lz-string-utf16-v1', originalLength:json.length} : {})});
  decode(raw);
  return raw;
}
export class ExpeditionSave {
  constructor(storage, key) {
    this.storage = storage; this.key = key; this.sequence = 0; this.active = null;
    this.revision = 0;
  }
  load() {
    // Loading also invalidates preparation started against an earlier world.
    this.revision++;
    const valid = [], errors = [];
    for (const slot of ['a','b']) {
      const raw = this.storage.getItem(this.key + '.' + slot);
      try { const result = decode(raw); if (result) valid.push({...result, slot}); }
      catch (e) { errors.push(e); }
    }
    valid.sort((a,b) => b.sequence - a.sequence);
    if (!valid.length) { if (errors.length) throw errors[0]; return null; }
    const best = valid[0]; this.sequence = best.sequence; this.active = best.slot;
    return best.value;
  }
  write(state) {
    // Invalidate asynchronous snapshots even if this newest synchronous save fails.
    const revision = ++this.revision;
    return this.commitPrepared(prepareSave(state, this.sequence + 1), revision);
  }
  // Only call with prepareSave's validated result. No decompression on the main
  // thread: exact raw readback verifies the already validated worker envelope.
  commitPrepared(raw, expectedRevision) {
    if (expectedRevision !== this.revision) return null;
    if (typeof raw !== 'string') throw Error('저장 준비 결과가 올바르지 않습니다.');
    const envelope = JSON.parse(raw);
    if (envelope.sequence !== this.sequence + 1 || typeof envelope.payload !== 'string' ||
        checksum(envelope.payload) !== envelope.checksum ||
        (envelope.encoding != null && envelope.encoding !== 'lz-string-utf16-v1'))
      throw Error('저장 준비 결과가 올바르지 않습니다.');
    const slot = this.active === 'a' ? 'b' : 'a';
    const key = this.key + '.' + slot;
    const previous = this.storage.getItem(key);
    try {
      this.storage.setItem(key, raw);
      // A same-sequence substituted or truncated payload must never be accepted.
      if (this.storage.getItem(key) !== raw) throw Error('저장을 확인하지 못했습니다.');
    } catch (error) {
      // The active generation is never touched. Best-effort rollback also keeps
      // an unconfirmed but parseable next generation from winning on reload.
      try {
        if (previous !== null) this.storage.setItem(key, previous);
        else this.storage.removeItem?.(key);
      } catch { /* Quota/store failure: the previous active slot still survives. */ }
      throw error;
    }
    this.sequence = envelope.sequence; this.active = slot; this.revision++;
    return this.sequence;
  }
}
