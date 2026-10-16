import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

test("native package verification, activation, interrupted startup and save rollback", () => {
  fs.mkdirSync("build/native-tests", { recursive: true });
  execFileSync(
    "java",
    [
      "com.sun.tools.javac.Main",
      "-d",
      "build/native-tests",
      "app/src/main/java/com/kgb/feral/UpdateCore.java",
      "tests/UpdateCoreCheck.java",
    ],
    { encoding: "utf8" },
  );
  const result = execFileSync(
    "java",
    ["-cp", "build/native-tests", "UpdateCoreCheck"],
    { encoding: "utf8" },
  );
  fs.writeFileSync("build/native-update-results.txt", result);
  assert.match(result, /Native updater checks: 44/);
});

test("version files agree with authoritative version.json", () => {
  execFileSync("node", ["tools/version.mjs", "--check"]);
});

test("public update transport works without credentials and enforces download boundaries", () => {
  fs.mkdirSync("build/public-tests", { recursive: true });
  execFileSync("java", [
    "com.sun.tools.javac.Main",
    "-d",
    "build/public-tests",
    "app/src/main/java/com/kgb/feral/PublicUpdates.java",
    "tests/PublicUpdatesCheck.java",
  ]);
  const result = execFileSync(
    "java",
    ["-cp", "build/public-tests", "PublicUpdatesCheck"],
    { encoding: "utf8" },
  );
  fs.writeFileSync("build/public-update-results.txt", result);
  assert.match(result, /Public transport checks: 15/);
});
