import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

test("actual release bundle matches the pinned Android verification key and payload", () => {
  execFileSync("python3", ["tools/build-update.py"]);
  const envelope = JSON.parse(fs.readFileSync("build/release/stable.feral"));
  const raw = Buffer.from(envelope.manifest, "base64");
  const signature = Buffer.from(envelope.signature, "base64");
  const key = crypto.createPublicKey({
    key: fs.readFileSync("app/src/main/assets/update-public.der"),
    format: "der",
    type: "spki",
  });
  assert.ok(crypto.verify("RSA-SHA256", raw, key, signature));
  const tampered = Buffer.from(raw);
  tampered[0] ^= 1;
  assert.equal(crypto.verify("RSA-SHA256", tampered, key, signature), false);
  const manifest = JSON.parse(raw);
  const archive = Buffer.from(envelope.archive, "base64");
  assert.equal(archive.length, manifest.archiveBytes);
  assert.equal(
    crypto.createHash("sha256").update(archive).digest("hex"),
    manifest.archiveSha256,
  );
  assert.deepEqual(
    manifest.versionCode,
    JSON.parse(fs.readFileSync("version.json")).versionCode,
  );
  const previous = fs.readFileSync("build/release/stable.feral");
  execFileSync("python3", ["tools/build-update.py"]);
  assert.deepEqual(
    fs.readFileSync("build/release/stable.feral"),
    previous,
    "repeat builds produce identical update bytes",
  );
});
