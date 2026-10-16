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
  assert.match(result, /Native updater checks: 27/);
});

test("version files agree with authoritative version.json", () => {
  execFileSync("node", ["tools/version.mjs", "--check"]);
});
