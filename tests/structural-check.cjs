const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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
    });
    const errors = [];
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
    await page.evaluate(() => {
      const f = FERAL;
      f.ecology.entities = [];
      f.ecology.rehash();
      f.player.flying = true;
      for (let x = 74; x < 90; x++)
        for (let z = 74; z < 92; z++) {
          for (let y = 12; y < 40; y++) f.world.set(x, y, z, 0);
          f.world.set(x, 11, z, 1);
        }
      f.inventory.slots.fill(null);
      for (const [id, n] of Object.entries({
        hull_part: 6,
        motor_part: 1,
        wrench: 1,
        iron: 10,
      }))
        f.inventory.add(id, n);
      f.selectHotbar(0);
      f.setCamera(80.25, 13.36, 82.75, 0, Math.atan2(-1.36, 2.5));
      f.view.rebuild(100);
    });
    await page.tap("#useBtn");
    await page.waitForFunction(
      () => FERAL.frontier.machine?.blueprint.length === 1,
    );
    assert.equal(
      await page.evaluate(() => FERAL.inventory.count("hull_part")),
      5,
    );
    assert.equal(await page.evaluate(() => FERAL.stats().paused), false);
    assert.equal(await page.locator("#frontierMachineGrid").count(), 0);
    const root = await page.evaluate(
      () => FERAL.frontier.machine.pose.position,
    );
    async function aim(id, x, y, z, pitch = 0) {
      await page.evaluate(
        ({ id, x, y, z, pitch }) => {
          const f = FERAL;
          f.selectHotbar(f.inventory.slots.findIndex((s) => s?.id === id));
          f.setCamera(x, y, z, 0, pitch);
        },
        { id, x, y, z, pitch },
      );
      await page.waitForFunction(
        () => FERAL.frontier.time > FERAL.frontierUI.assembly.nextUse,
      );
    }
    await aim(
      "motor_part",
      root.x,
      root.y + 2,
      root.z + 2,
      Math.atan2(-1.5, 2),
    );
    await page.tap("#useBtn");
    await page.waitForFunction(
      () => FERAL.frontier.machine.blueprint.length === 2,
    );
    assert.equal(
      await page.evaluate(() => FERAL.inventory.count("motor_part")),
      0,
    );
    await aim("hull_part", root.x, root.y + 0.25, root.z + 3);
    await page.tap("#useBtn");
    await page.waitForFunction(
      () => FERAL.frontier.machine.blueprint.length === 3,
    );
    await aim("wrench", root.x, root.y + 0.25, root.z + 3);
    await page.tap("#actBtn");
    await page.waitForFunction(
      () => FERAL.frontier.machine.blueprint.length === 2,
    );
    assert.equal(
      await page.evaluate(() => FERAL.inventory.count("hull_part")),
      5,
    );
    // Repair is charged once using the same inventory, with no design panel.
    await page.evaluate(() => {
      const s = FERAL.frontier.machine;
      s.hp[s.blueprint[0].id] -= 20;
      s.revision++;
    });
    await aim("iron", root.x, root.y + 0.25, root.z + 3);
    await page.tap("#useBtn");
    await page.waitForFunction(
      () =>
        FERAL.frontier.machine.hp[FERAL.frontier.machine.blueprint[0].id] ===
        100,
    );
    assert.equal(await page.evaluate(() => FERAL.inventory.count("iron")), 9);
    await aim("wrench", root.x, root.y + 0.25, root.z + 3);
    fs.mkdirSync("verification/0.6.0", { recursive: true });
    await page.screenshot({ path: "verification/0.6.0/world-assembly.png" });
    await page.tap("#useBtn");
    await page.waitForFunction(() => !FERAL.frontier.machine.pose.anchored);
    const beforeCount = await page.evaluate(
      () => FERAL.frontier.machine.blueprint.length,
    );
    await aim("hull_part", root.x, root.y + 0.25, root.z + 3);
    await page.tap("#useBtn");
    assert.equal(
      await page.evaluate(() => FERAL.frontier.machine.blueprint.length),
      beforeCount,
    );
    assert.equal(
      await page.evaluate(() => FERAL.inventory.count("hull_part")),
      5,
    );
    // A complete driving fixture exercises actual mobile boarding and independent rigid-body motion.
    await page.evaluate(async () => {
      const { createLab, preset } = await import("/machine/model.js"),
        { initialPose } = await import("/machine/assembly-state.js");
      const s = createLab();
      preset(s);
      s.assembly = true;
      s.pose = initialPose(82, 12.08, 86);
      FERAL.frontier.machine = s;
      FERAL.player.flying = false;
      FERAL.setCamera(84, 13.36, 86, Math.PI / 2, 0);
    });
    await page.waitForFunction(
      () => !document.getElementById("interactBtn").hidden,
    );
    await page.tap("#interactBtn");
    assert.equal(await page.evaluate(() => FERAL.frontier.riding), true);
    const driven = await page.evaluate(() => {
      const s = FERAL.frontier.machine,
        p = { ...s.pose.position };
      for (let i = 0; i < 100; i++) FERAL.fixedStep({ forward: 1 });
      return Math.hypot(p.x - s.pose.position.x, p.z - s.pose.position.z);
    });
    assert.ok(driven > 1, `vehicle travels ${driven}`);
    const parked = await page.evaluate(() => ({
      ...FERAL.frontier.machine.pose.position,
    }));
    await page.tap("#interactBtn");
    assert.equal(await page.evaluate(() => FERAL.frontier.riding), false);
    const after = await page.evaluate(() => ({
      ...FERAL.frontier.machine.pose.position,
    }));
    assert.ok(
      Math.hypot(after.x - 77.5, after.z - 87.5) > 2,
      "dismount does not teleport to camp: " +
        JSON.stringify({ parked, after }),
    );
    // Anchor before save to compare exact restored transforms.
    await page.evaluate(() => {
      FERAL.frontier.machine.pose.anchored = true;
      FERAL.fixedStep({});
      FERAL.save(true);
    });
    const saved = await page.evaluate(() => ({
      pose: FERAL.frontier.machine.pose,
      hull: FERAL.inventory.count("hull_part"),
    }));
    await page.reload();
    await page.waitForFunction(
      () => window.FERAL?.ready && FERAL.stats().running,
      null,
      { timeout: 60000 },
    );
    const loaded = await page.evaluate(() => ({
      pose: FERAL.frontier.machine.pose,
      hull: FERAL.inventory.count("hull_part"),
    }));
    assert.deepEqual(loaded, saved);
    // Actual voxel cuts change the visible animal pose and its target information.
    await page.evaluate(async () => {
      const { SPECIES, toWorld, cellPosition, condition } =
          await import("/entities.js"),
        f = FERAL;
      f.ecology.entities = [];
      const e = f.ecology.spawn(0, 80, 79);
      e.y = 12;
      e.yaw = 0;
      e.moving = 0;
      e.age = 40;
      e.speed = 0;
      for (const pi of [2, 4]) {
        const p = SPECIES[0].parts[pi];
        f.ecology.damageHit(
          {
            entity: e,
            part: pi,
            voxel: 0,layer:"structure",node:`${pi}:0`,
            point: toWorld(e, p, pi, cellPosition(p, 0), 0),
          },
          0,
          0.01,
          24,
        );
      }
      f.ecology.rehash();
      window.subject = e;
      f.player.flying = true;
      f.setCamera(80, 13.36, 82.5, 0, Math.atan2(-1.0, 3.5));
      f.view.rebuild(100);
      condition(e);
    });
    await page.waitForFunction(() =>
      FERAL.view.worldUI.labels
        .get("focus")
        .data?.hint.includes("지지 다리 2/4"),
    );
    assert.match(await page.evaluate(() => subject.behavior), /기어 이동/);
    await page.screenshot({ path: "verification/0.6.0/injured-animal.png" });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        worldAssembly: true,
        mobileUse: true,
        resourceAccounting: true,
        driven,
        saveRestore: true,
        injuredAnimal: true,
        errors,
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
