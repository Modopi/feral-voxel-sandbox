// Serves app assets with the same MIME mapping and CSP as MainActivity.shouldInterceptRequest,
// so browser checks see what the Android WebView sees (desktop http server MIME rules hide failures).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../app/src/main/assets/', import.meta.url));
const ACTIVITY = fileURLToPath(new URL('../app/src/main/java/com/kgb/feral/MainActivity.java', import.meta.url));

/** MIME rules parsed from MainActivity so this server cannot drift from the shipped native code. */
export function nativeMimeRules(source = fs.readFileSync(ACTIVITY, 'utf8')) {
  const rules = [...source.matchAll(/path\.endsWith\("([^"]+)"\) \? "([^"]+)"/g)].map(m => [m[1], m[2]]);
  const fallback = /: "([^"]+)";\s*\n\s*return response\(mime, in\)/.exec(source)?.[1];
  const csp = /"Content-Security-Policy", "([^"]+)"/.exec(source)?.[1];
  if (!rules.length || !fallback || !csp) throw new Error('MainActivity asset rules not found');
  return { rules, fallback, csp };
}

export function nativeMime(file, { rules, fallback } = nativeMimeRules()) {
  return rules.find(([ext]) => file.endsWith(ext))?.[1] ?? fallback;
}

export function startAndroidAssetServer(port = 0) {
  const native = nativeMimeRules();
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://local');
    if (request.method !== 'GET' || !url.pathname.startsWith('/assets/')) { response.writeHead(404); response.end(); return; }
    const relative = decodeURIComponent(url.pathname.slice('/assets/'.length));
    const file = path.normalize(path.join(ROOT, relative));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': nativeMime(relative, native), 'Cache-Control': 'no-store', 'Content-Security-Policy': native.csp });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const server = await startAndroidAssetServer(Number(process.env.PORT || 8082));
  console.log(`Android asset rules on http://127.0.0.1:${server.address().port}/assets/`);
}
