import {prepareSave, prepareSaveJson} from './save.js';

export function prepareSaveMessage(message) {
  const {id, sequence, state} = message ?? {};
  const start = performance.now();
  try {
    if (!Number.isSafeInteger(id) || id < 1) throw Error('잘못된 저장 요청입니다.');
    const raw = typeof message.json === 'string' ? prepareSaveJson(message.json, sequence) : prepareSave(state, sequence);
    return {id, raw, preparationMs:performance.now() - start};
  } catch (error) {
    return {id, error:error?.message ?? String(error), preparationMs:performance.now() - start};
  }
}

// Importable by Node tests without installing a global worker handler there.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  self.onmessage = event => self.postMessage(prepareSaveMessage(event.data));
}
