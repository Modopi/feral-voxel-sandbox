import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditDesign } from "../tools/audit-content-design.mjs";

const directory = fileURLToPath(new URL("../design/content/", import.meta.url));
function changedFixture(t, name, change) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "feral-content-contract-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  for (const file of fs.readdirSync(directory).filter((file) => file.endsWith(".json"))) {
    fs.copyFileSync(path.join(directory, file), path.join(temp, file));
  }
  const target = path.join(temp, `${name}.json`);
  const data = JSON.parse(fs.readFileSync(target, "utf8"));
  change(data);
  fs.writeFileSync(target, JSON.stringify(data));
  return auditDesign(temp);
}

test("proposed content links and all self-research bootstrap paths are consistent", () => {
  const report = auditDesign();
  assert.deepEqual(report.errors, []);
  assert.equal(report.reachability.energies, 6);
  assert.equal(report.reachability.excludesDiscoveryRewards, true);
});

test("first divinity cannot depend on the relic it must allow players to craft", (t) => {
  const report = changedFixture(t, "progression", (data) => {
    data.entries.find((e) => e.id === "first_divinity").requiredComponent = "relic";
  });
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((e) => e.includes("divine: energy cannot bootstrap")));
  assert.ok(report.errors.some((e) => e.includes("relic: unavailable without discovery")));
});

test("missing animal rewards are detected across separate design files", (t) => {
  const report = changedFixture(t, "creatures", (data) => {
    data.entries.find((e) => e.id === "moss_deer").drops[0].itemId = "unknown_reward";
  });
  assert.ok(report.errors.some((e) => e.includes("unknown drop unknown_reward")));
});

test("a valid-looking corridor with its endpoint outside the target room is rejected", (t) => {
  const report = changedFixture(t, "structures", (data) => {
    data.entries[0].connections[0].centerlineM.at(-1)[0] += 1000;
  });
  assert.ok(report.errors.some((e) => e.includes("corridor does not end at target room")));
});

test("shortening a boss warning below the calculated escape time fails review", (t) => {
  const report = changedFixture(t, "bosses", (data) => {
    data.entries[0].skills[0].windupS = 0.1;
  });
  assert.ok(report.errors.some((e) => e.includes("insufficient telegraph")));
});

test("a phase cannot expose its weak point only after an attack absent from that phase", (t) => {
  const report = changedFixture(t, "bosses", (data) => {
    const phase = data.entries.find((boss) => boss.id === "arboretum_symbiote").phases[0];
    phase.schedule = phase.schedule.filter((id) => !phase.state.coreExposure.skillIds.includes(id));
  });
  assert.ok(report.errors.some((e) => e.includes("weakness trigger absent")));
});
