const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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
      isMobile: true,
      hasTouch: true,
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
      const f = FERAL,
        w = f.world;
      f.ecology.entities = [];
      f.ecology.rehash();
      f.player.flying = true;
      w.loose.enabled = false;
      for (let x = 76; x <= 85; x++)
        for (let z = 76; z <= 85; z++) {
          for (let y = 12; y < 40; y++) w.set(x, y, z, 0);
          w.set(x, 11, z, 1);
        }
      for (let y = 24; y < 27; y++) w.setCell(160, y, 160, 5);
      for (let x = 160; x < 165; x++) w.setCell(x, 27, 160, 5);
      w.loose.enabled = true;
      f.inventory.slots.fill(null);
      f.inventory.add("pick", 1);
      f.inventory.add("grapple", 1);
      f.inventory.add("wrench", 1);
      f.inventory.add("wood", 8);
      f.selectHotbar(0);
      f.setCamera(80.25, 13.25, 82.7, 0, 0);
      f.view.rebuild(100);
    });
    // Hold the real mobile attack button to cut the support, not a model-only edit.
    const attack = await page.locator("#actBtn").boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }],
      });
    await touch(
      "touchStart",
      attack.x + attack.width / 2,
      attack.y + attack.height / 2,
    );
    await page.waitForFunction(
      () => FERAL.world.loose.bodies.length > 0,
      null,
      { timeout: 12000 },
    );
    await touch("touchEnd");
    const detached = await page.evaluate(() => ({
      bodies: FERAL.world.loose.bodies.map((s) => ({
        id: s.id,
        count: s.cells.length,
      })),
      remaining: FERAL.world.getCell(160, 26, 160),
    }));
    assert.equal(detached.bodies[0].count, 5);
    assert.equal(detached.remaining, 0);
    // Pin the beam after it settles so it can be extended, cut and inspected reliably.
    await page.waitForTimeout(700);
    async function aim(tool) {
      await page.evaluate(async (tool) => {
        const { worldPoint } = await import("./machine/assembly-state.js");
        const f = FERAL,
          s = f.world.loose.bodies.find((s) => s.cells.length >= 4),
          c = s.cells.at(-1),
          p = worldPoint(s.pose, { x: c.x * 0.5, y: c.y * 0.5, z: c.z * 0.5 });
        f.selectHotbar(f.inventory.slots.findIndex((s) => s?.id === tool));
        f.setCamera(p.x, p.y, p.z + 2.5, 0, 0);
      }, tool);
      await page
        .waitForFunction(() => FERAL.target().loose)
        .catch(async (e) => {
          console.log(
            await page.evaluate(() => ({
              target: FERAL.target(),
              camera: FERAL.view.camera.position,
              bodies: FERAL.world.loose.bodies,
            })),
          );
          await page.screenshot({ path: "build/loose-aim-failure.png" });
          throw e;
        });
    }
    await aim("wrench");
    await page.tap("#useBtn");
    await page.waitForFunction(() =>
      FERAL.world.loose.bodies.some((s) => s.pose.anchored),
    );
    const attachBefore = await page.evaluate(() =>
      FERAL.inventory.count("wood"),
    );
    await aim("wood");
    await page.tap("#useBtn");
    await page.waitForFunction(
      (n) => FERAL.inventory.count("wood") === n - 1,
      attachBefore,
    );
    assert.equal(
      await page.evaluate(() => FERAL.world.loose.bodies[0].cells.length),
      6,
    );
    await aim("wrench");
    await page.tap("#useBtn");
    await page.waitForFunction(
      () => !FERAL.world.loose.bodies[0].pose.anchored,
    );
    await aim("grapple");
    const use = await page.locator("#useBtn").boundingBox(),
      ux = use.x + use.width / 2,
      uy = use.y + use.height / 2;
    const yaw = await page.evaluate(() => FERAL.player.yaw);
    await touch("touchStart", ux, uy);
    await page.waitForFunction(() => !!FERAL.physicalWorld.loose.grip);
    await touch("touchMove", ux - 75, uy - 25);
    await page.waitForTimeout(700);
    const grip = await page.evaluate(() => ({
      held: !!FERAL.physicalWorld.loose.grip,
      yaw: FERAL.player.yaw,
      scale: FERAL.physicalWorld.loose.speedScale,
    }));
    assert.ok(grip.held && Math.abs(grip.yaw - yaw) > 0.05);
    await touch("touchEnd");
    await page.screenshot({ path: out + "/carry-mobile.png" });
    await page.tap("#actBtn");
    await page.waitForFunction(() => !FERAL.physicalWorld.loose.grip);
    const thrown = await page.evaluate(() =>
      FERAL.world.loose.bodies.map((s) =>
        Math.hypot(...Object.values(s.pose.velocity)),
      ),
    );
    assert.ok(thrown.some((v) => v > 1));
    // A mobile save/reload retains body identity, shape, pose and per-cell wounds.
    await page.evaluate(() => {
      FERAL.pause(true);
      const s = FERAL.world.loose.bodies[0];
      s.cells[0].damage = 0.25;
      s.pose.anchored = true;
      s.pose.velocity = { x: 0, y: 0, z: 0 };
      s.pose.spin = { x: 0, y: 0, z: 0 };
      FERAL.save(true);
      window.savedBody = JSON.stringify(s);
    });
    const saved = await page.evaluate(() => JSON.parse(savedBody));
    await page.reload();
    await page.waitForFunction(
      () => window.FERAL?.ready && FERAL.stats().running,
      null,
      { timeout: 60000 },
    );
    const loaded = await page.evaluate(
      (id) => FERAL.world.loose.bodies.find((s) => s.id === id),
      saved.id,
    );
    assert.equal(loaded.cells.length, saved.cells.length);
    assert.equal(loaded.cells[0].damage, 0.25);
    assert.deepEqual(loaded.pose, saved.pose);
    const occlusion = await page.evaluate(async () => {
      const f = FERAL,
        { createLab, TYPES } = await import("./machine/model.js"),
        { initialPose, worldPoint } = await import(
          "./machine/assembly-state.js"
        );
      const s = f.world.loose.bodies[0],
        c = s.cells[0],
        p = worldPoint(s.pose, { x: c.x * 0.5, y: c.y * 0.5, z: c.z * 0.5 });
      f.player.flying = true;
      f.setCamera(p.x, p.y, p.z + 3, 0, 0);
      const m = createLab();
      m.assembly = true;
      m.blueprint = [{ id: "p0", type: "hull", x: 0, y: 0, z: 0 }];
      m.hp = { p0: TYPES.hull.hp };
      m.pose = initialPose(p.x, p.y - 0.25, p.z + 1.1, f.frontier.key);
      f.frontier.machine = m;
      f.frontierUI.assembly.draw();
      return {
        assembly: !!f.frontierUI.assembly.ray(6.5),
        loose: !!f.target().loose,
      };
    });
    assert.ok(
      occlusion.assembly && !occlusion.loose,
      "the nearer vehicle blocks interaction with terrain objects behind it",
    );
    await page.screenshot({ path: out + "/loose-restored.png" });
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      out + "/loose-world.json",
      JSON.stringify(
        {
          detached,
          grip,
          thrown,
          restoredCells: loaded.cells.length,
          occlusion,
          errors,
        },
        null,
        2,
      ),
    );
    console.log("loose world mobile", {
      detached,
      grip,
      thrown,
      restoredCells: loaded.cells.length,
    });
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
