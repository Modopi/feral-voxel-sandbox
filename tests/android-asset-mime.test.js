import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeMimeRules, nativeMime } from '../tools/android-asset-server.mjs';

const ROOT = fileURLToPath(new URL('../app/src/main/assets/', import.meta.url));
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const files = walk(ROOT);
const rel = file => path.relative(ROOT, file).split(path.sep).join('/');

function references(file) {
  const text = fs.readFileSync(file, 'utf8'), out = [];
  if (file.endsWith('.html')) {
    for (const m of text.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) out.push({ specifier: m[1], kind: 'script' });
    for (const m of text.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) out.push({ specifier: m[1], kind: 'style' });
  } else {
    for (const re of [/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g])
      for (const m of text.matchAll(re)) out.push({ specifier: m[1], kind: 'script' });
  }
  return out.filter(r => /^\.{0,2}\/|^[\w-]+\//.test(r.specifier) && !/^https?:/.test(r.specifier) && !r.specifier.startsWith('/'));
}

test('MainActivity asset rules are parsed from the shipped native source', () => {
  const rules = nativeMimeRules();
  assert.equal(nativeMime('a/b.js', rules), 'text/javascript');
  assert.equal(nativeMime('a/b.css', rules), 'text/css');
  assert.equal(nativeMime('a/b.mjs', rules), rules.fallback, 'unknown extensions fall back exactly like the app');
  assert.match(rules.csp, /script-src 'self'/);
});

test('every script and stylesheet the game loads is served with a usable MIME on Android', () => {
  const rules = nativeMimeRules(), problems = [];
  assert.deepEqual(files.filter(f => f.endsWith('.mjs')).map(rel), [], 'module scripts must use .js: the app serves other extensions as octet-stream');
  let checked = 0;
  for (const file of files.filter(f => /\.(?:js|html)$/.test(f))) {
    for (const { specifier, kind } of references(file)) {
      const target = path.normalize(path.join(path.dirname(file), specifier.split(/[?#]/)[0]));
      checked++;
      if (!target.startsWith(ROOT) || !fs.existsSync(target)) { problems.push(`${rel(file)} → ${specifier}: missing`); continue; }
      const mime = nativeMime(rel(target), rules), expected = kind === 'style' ? 'text/css' : 'text/javascript';
      if (mime !== expected) problems.push(`${rel(file)} → ${specifier}: ${mime}`);
    }
  }
  assert(checked > 100, `checked ${checked} references`);
  assert.deepEqual(problems, []);
});

test('content expedition does not depend on network fetches the app CSP blocks', () => {
  const { csp } = nativeMimeRules();
  assert.match(csp, /connect-src 'none'/);
  const runtime = files.filter(f => rel(f).startsWith('content-runtime/') && f.endsWith('.js') && !f.includes('.generated.'));
  const offenders = runtime.filter(f => /\bfetch\s*\(|XMLHttpRequest|createObjectURL/.test(fs.readFileSync(f, 'utf8'))).map(rel);
  assert.deepEqual(offenders, []);
});
