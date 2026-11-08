import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const exporterPath = new URL('../android/feral-migration/src/main/java/com/kgb/feral/migration/LegacyWebViewExporter.java', import.meta.url);
const exporterSource = await readFile(exporterPath, 'utf8');

function exactEmbeddedScript(source) {
  const initializer = source.match(/private static final String HTML = ([\s\S]*?);\n\n    private final Activity/);
  assert.ok(initializer, 'LegacyWebViewExporter.HTML initializer must exist');
  const literals = initializer[1].match(/"(?:\\.|[^"\\])*"/g);
  assert.ok(literals?.length, 'HTML initializer must contain Java string literals');
  const html = literals.map(literal => JSON.parse(literal)).join('');
  const script = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(script, 'migration-only HTML must contain its inline script');
  return script[1];
}

const script = exactEmbeddedScript(exporterSource);

function makeLocalStorage(entries = {}) {
  const rows = Object.entries(entries);
  return {
    get length() { return rows.length; },
    key(index) { return rows[index]?.[0] ?? null; },
    getItem(key) { return Object.hasOwn(entries, key) ? entries[key] : null; }
  };
}

function existingDatabase(rows, {hasKeys = true, readError = null} = {}) {
  let closed = false;
  const db = {
    objectStoreNames: {contains: name => hasKeys && name === 'keys'},
    close() { closed = true; },
    transaction(storeName, mode) {
      assert.equal(storeName, 'keys');
      assert.equal(mode, 'readonly');
      const tx = {};
      tx.objectStore = name => {
        assert.equal(name, 'keys');
        return {
          openCursor() {
            const request = {};
            if (readError) {
              queueMicrotask(() => {
                request.error = new Error(readError);
                request.onerror?.();
              });
              return request;
            }
            let index = 0;
            const advance = () => {
              if (index >= rows.length) {
                request.result = null;
                request.onsuccess?.();
                queueMicrotask(() => tx.oncomplete?.());
                return;
              }
              request.result = {value: rows[index++], continue: () => queueMicrotask(advance)};
              request.onsuccess?.();
            };
            queueMicrotask(advance);
            return request;
          }
        };
      };
      return tx;
    }
  };
  const openRequest = {};
  const indexedDB = {
    databases: async () => [{name: 'feral-vault'}],
    open(name, version) {
      assert.equal(name, 'feral-vault');
      assert.equal(version, 1);
      queueMicrotask(() => {
        openRequest.result = db;
        openRequest.onsuccess?.();
      });
      return openRequest;
    }
  };
  return {indexedDB, get closed() { return closed; }};
}

async function runExport({entries = {}, indexedDB, begin = true, appendError = null, timeoutMs = 500} = {}) {
  const chunks = [];
  let timeout;
  const outcome = new Promise(resolve => {
    const sink = {
      begin: () => begin,
      append(sequence, value) {
        if (appendError) throw new Error(appendError);
        assert.equal(sequence, chunks.length, 'chunks must arrive in order');
        chunks.push(value);
      },
      complete(count) { resolve({ok: true, count, chunks}); },
      fail(error) { resolve({ok: false, error: String(error), chunks}); }
    };
    const window = {FeralMigrationSink: sink};
    if (indexedDB !== undefined) window.indexedDB = indexedDB;
    const globals = {window, localStorage: makeLocalStorage(entries)};
    if (indexedDB !== undefined) globals.indexedDB = indexedDB;
    vm.runInNewContext(script, globals, {timeout: timeoutMs});
    timeout = setTimeout(() => resolve({ok: false, error: 'test_timeout', chunks}), timeoutMs * 2);
  });
  try {
    return await outcome;
  } finally {
    clearTimeout(timeout);
  }
}

function exportedJson(result) {
  assert.equal(result.ok, true, `export should complete: ${result.error ?? ''}`);
  assert.equal(result.count, result.chunks.length, 'complete chunk count must match append calls');
  return JSON.parse(result.chunks.join(''));
}

test('embedded migration exporter script parses and remains read-only', () => {
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /request\.onupgradeneeded=\(\)=>\{created=true;request\.transaction\.abort\(\);\}/,
    'opening a fresh install on older IndexedDB must abort the upgrade instead of creating feral-vault');
  assert.doesNotMatch(script, /localStorage\.(?:setItem|removeItem|clear)\s*\(/,
    'migration export must not alter existing localStorage');
  assert.doesNotMatch(script, /indexedDB\.deleteDatabase\s*\(/,
    'migration export must not delete the IndexedDB vault');
  assert.match(exporterSource, /main\.postDelayed\(\(\) -> finish\(null, "migration_timeout"\), 60000\)/,
    'the Android exporter must fail the migration if its WebView export stalls');
});

test('fresh install with no vault exports empty storage without creating a database', async () => {
  let openCalls = 0;
  const indexedDB = {
    databases: async () => [],
    open() { openCalls++; throw new Error('must not open absent database'); }
  };
  const result = await runExport({indexedDB});
  assert.deepEqual(exportedJson(result), {localStorage: {}, vault: {available: false, rows: []}});
  assert.equal(openCalls, 0);
});

test('localStorage-only legacy save exports sorted feral keys and keeps all other keys untouched', async () => {
  const entries = {'other.key': 'ignore', 'feral.z': 'last', 'feral.a': 'first'};
  const original = structuredClone(entries);
  const result = await runExport({entries});
  assert.deepEqual(exportedJson(result), {
    localStorage: {'feral.a': 'first', 'feral.z': 'last'},
    vault: {available: false, rows: []}
  });
  assert.deepEqual(entries, original);
});

test('older IndexedDB API aborts the version-one upgrade on a fresh install', async () => {
  let aborted = false;
  const indexedDB = {
    open(name, version) {
      assert.equal(name, 'feral-vault');
      assert.equal(version, 1);
      const request = {transaction: {abort() { aborted = true; }}};
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.error = new Error('upgrade_aborted');
        request.onerror?.();
      });
      return request;
    }
  };
  const result = await runExport({indexedDB});
  assert.deepEqual(exportedJson(result), {localStorage: {}, vault: {available: false, rows: []}});
  assert.equal(aborted, true, 'no database should be created by probing an empty profile');
});

test('existing vault keys are exported verbatim in cursor order and closed', async () => {
  const rows = [
    {key: 'feral.world', value: '{"seed":17}'},
    {key: 'feral.settings', value: '{"music":false}'}
  ];
  const database = existingDatabase(rows);
  const result = await runExport({entries: {'feral.stale': 'old'}, indexedDB: database.indexedDB});
  assert.deepEqual(exportedJson(result), {
    localStorage: {'feral.stale': 'old'},
    vault: {available: true, rows}
  });
  assert.equal(database.closed, true);
});

test('existing vault without the keys object store is exported as available and empty', async () => {
  const database = existingDatabase([], {hasKeys: false});
  const result = await runExport({indexedDB: database.indexedDB});
  assert.deepEqual(exportedJson(result), {localStorage: {}, vault: {available: true, rows: []}});
  assert.equal(database.closed, true);
});

test('large localStorage payload crosses the 64 KiB bridge boundary with ordered chunks', async () => {
  const value = 'x'.repeat(70_000);
  const result = await runExport({entries: {'feral.large': value}});
  assert.equal(result.ok, true, result.error);
  assert.equal(result.count, 2, 'large key/value write should flush once and finish with one final chunk');
  assert.deepEqual(JSON.parse(result.chunks.join('')), {
    localStorage: {'feral.large': value},
    vault: {available: false, rows: []}
  });
  assert.ok(result.chunks[0].length >= 65_536);
});

test('file, IndexedDB open and cursor failures report errors without completing export', async t => {
  await t.test('unavailable private output file', async () => {
    const result = await runExport({begin: false});
    assert.equal(result.ok, false);
    assert.equal(result.error, 'export_file_unavailable');
  });

  await t.test('vault open failure', async () => {
    const request = {};
    const indexedDB = {
      databases: async () => [{name: 'feral-vault'}],
      open() {
        queueMicrotask(() => {
          request.error = new Error('vault_open_denied');
          request.onerror?.();
        });
        return request;
      }
    };
    const result = await runExport({indexedDB});
    assert.equal(result.ok, false);
    assert.equal(result.error, 'vault_open_denied');
  });

  await t.test('vault cursor read failure', async () => {
    const database = existingDatabase([], {readError: 'vault_read_denied'});
    const result = await runExport({indexedDB: database.indexedDB});
    assert.equal(result.ok, false);
    assert.equal(result.error, 'vault_read_denied');
    assert.equal(database.closed, false, 'failed read must fail rather than claim a completed export');
  });
});
