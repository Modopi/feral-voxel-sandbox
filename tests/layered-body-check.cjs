const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const out = "verification/0.10.0";
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.FERAL_CHROME || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-dev-shm-usage",
    ],
  });
  try {
    const page = await browser.newPage({
        viewport: { width: 900, height: 412 },
        hasTouch: true,
        isMobile: true,
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => (window.AndroidApp = {}));
    await page.goto(
      (process.env.FERAL_BASE_URL || "http://127.0.0.1:8080") +
        "/index.html?world=frontier",
    );
    await page.waitForFunction(
      () => window.FERAL?.ready && FERAL.stats().running,
      null,
      { timeout: 60000 },
    );
    await page.evaluate(async () => {
      const f = FERAL;
      const { cellPosition, toWorld, SPECIES } = await import("./entities.js");
      f.ecology.entities = [];
      f.ecology.update = () => {};
      f.player.flying = true;
      f.world.loose.enabled = false;
      for (let x = 77; x <= 83; x++)
        for (let z = 72; z <= 80; z++) {
          for (let y = 12; y < 40; y++) f.world.set(x, y, z, 0);
          f.world.set(x, 11, z, 1);
        }
      const e = f.ecology.spawn(0, 80, 76);
      e.y = 12;
      e.yaw = 0;
      e.moving = 0;
      window.subject = e;
      f.ecology.rehash();
      const p = SPECIES[0].parts[2],
        at = toWorld(e, p, 2, cellPosition(p, 0), f.world.time);
      f.inventory.add("pick", 1);
      f.selectHotbar(f.inventory.slots.findIndex((s) => s?.id === "pick"));
      f.setCamera(at[0], at[1], at[2] - 2, Math.PI, 0);
      f.view.rebuild(100);
    });
    await page.waitForFunction(() => FERAL.target().ent?.part === 2);
    const before = await page.evaluate(() => ({
      hp: subject.hp,
      legs: FERAL.ecology.legs(subject),
      layer: FERAL.target().ent.layer,
    }));
    assert.equal(before.layer, "shell");
    await page.tap("#actBtn");
    await page.waitForFunction(() => FERAL.target().ent?.layer === "structure");
    const skin = await page.evaluate(() => ({
      hp: subject.hp,
      legs: FERAL.ecology.legs(subject),
      layer: FERAL.target().ent.layer,
    }));
    assert.equal(skin.hp, before.hp);
    assert.equal(skin.legs, 4);
    await page.screenshot({ path: out + "/exposed-bone-mobile.png" });
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => {
        for (let i = 0; i < 35; i++) FERAL.fixedStep({});
      });
      await page.tap("#actBtn");
    }
    const fracture = await page.evaluate(() => ({
      hp: subject.hp,
      legs: FERAL.ecology.legs(subject),
      status: subject.bodyPose.label,
    }));
    assert.equal(fracture.legs, 3);
    assert.ok(fracture.hp < before.hp);
    // The detailed humanoid uses the same graph, with rendered holes and detached limb groups.
    const human = await page.evaluate(async () => {
      const f = FERAL,
        t = f.frontierUI.training;
      f.setCamera(81, t.rig.root.position.y + 1.05, 91.3, 0, -0.08);
      t.lastTime = null;
      f.frontierUI.updateTargets();
      const initial = f.frontierUI.objectTarget();
      const p = t.rig.bones.legL;
      const { Vector3 } = await import("./vendor/three.module.js");
      const local = new Vector3(0, -0.18, 0),
        world = p.localToWorld(local.clone());
      t.damage({ part: "legL", layer: "shell", point: world }, 12, 0.14);
      const shell = t.body.status();
      const node = t.body.model.nodes.find((n) => n.part === "legL");
      t.damage(
        { part: "legL", layer: "structure", node: node.id, point: world },
        100,
        0.08,
      );
      t.animate(f.frontier.time, 0.016, (x, z) => f.world.surface(x, z), true);
      f.frontier.region.trainingBody = t.body.save();
      return {
        target: initial?.kind,
        shellLeg: shell.functions.legL,
        brokenLeg: t.body.status().functions.legL,
        fragments: t.fragments.length,
        pose: t.body.status().alive,
      };
    });
    assert.equal(human.target, "body");
    assert.equal(human.shellLeg, true);
    assert.equal(human.brokenLeg, false);
    assert.ok(human.fragments > 0);
    assert.equal(human.pose, true);
    await page.screenshot({ path: out + "/humanoid-structure.png" });
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      out + "/layered-body.json",
      JSON.stringify({ before, skin, fracture, human, errors }, null, 2),
    );
    console.log({ before, skin, fracture, human });
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
