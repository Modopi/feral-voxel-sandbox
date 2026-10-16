const { chromium } = require("playwright");
const fs = require("fs");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.FERAL_CHROME ||
      "../toolchain/chrome-headless-shell-linux64/chrome-headless-shell",
    headless: true,
    args: [
      "--no-sandbox",
      "--enable-webgl",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-dev-shm-usage",
      "--allow-file-access-from-files",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 900, height: 412 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    window.AndroidApp = {};
  });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("ERROR", e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(
    "file://" + process.cwd() + "/app/src/main/assets/index.html",
  );
  await page.waitForFunction(() => window.FERAL?.ready);
  await page.click("#startBtn");
  const floor = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const y = [],
          camera = [];
        let n = 0;
        function sample() {
          y.push(window.FERAL.player.y);
          camera.push(window.FERAL.view.camera.position.y);
          if (++n < 18) requestAnimationFrame(sample);
          else
            resolve({
              footRange: Math.max(...y) - Math.min(...y),
              cameraRange: Math.max(...camera) - Math.min(...camera),
              eye: camera[0] - y[0],
            });
        }
        requestAnimationFrame(sample);
      }),
  );
  assert.ok(floor.footRange < 1e-6);
  assert.ok(floor.cameraRange < 1e-6);
  assert.ok(Math.abs(floor.eye - 1.36) < 1e-6);
  console.log("FLOOR", JSON.stringify(floor));
  await page.screenshot({ path: "build/v2-gameplay.png" });
  const mining = await page.evaluate(() => {
    const f = window.FERAL;
    function aim(x, y, z) {
      const o = { x: 77.5, y: 13.36, z: 84.5 },
        dx = x - o.x,
        dy = y - o.y,
        dz = z - o.z;
      f.setCamera(
        o.x,
        o.y,
        o.z,
        Math.atan2(-dx, -dz),
        Math.atan2(dy, Math.hypot(dx, dz)),
      );
    }
    const before = f.inventory.count("dirt");
    f.selectTool(2);
    if (f.miningSize !== 1) f.cycleRange();
    aim(79.25, 11.99, 84.25);
    for (let n = 0; n < 3; n++) {
      f.world.time += 0.21;
      f.use();
    }
    const coarseRemoved = f.world.getCell(158, 23, 168) === 0;
    f.cycleRange();
    aim(78.25, 11.99, 84.25);
    for (let n = 0; n < 2; n++) {
      f.world.time += 0.21;
      f.use();
    }
    const halfRemoved = f.world.getCell(156, 23, 168) === 0,
      neighborIntact = f.world.getCell(157, 23, 168) !== 0;
    f.setCamera(78.8, 13.36, 84.7, 0, 0);
    for (let i = 0; i < 150; i++) f.fixedStep({});
    return {
      before,
      after: f.inventory.count("dirt"),
      coarseRemoved,
      halfRemoved,
      neighborIntact,
      collected: f.loot.collected,
    };
  });
  assert.ok(
    mining.coarseRemoved && mining.halfRemoved && mining.neighborIntact,
  );
  assert.ok(mining.after >= mining.before + 9);
  console.log("MINE_PICKUP", JSON.stringify(mining));
  await page.click("#inventoryBtn");
  await page
    .getByRole("button", { name: "목재 조각 × 4", exact: true })
    .click();
  await page.click("#craftOutput");
  assert.equal(
    await page.evaluate(() => window.FERAL.inventory.count("plank")),
    4,
  );
  await page.screenshot({ path: "build/v2-inventory.png" });
  await page.click("#resumeBtn");
  const combat = await page.evaluate(() => {
    const f = window.FERAL;
    f.setCamera(77.5, 13.36, 84.5, 0, 0);
    const others = f.ecology.entities;
    f.ecology.entities = [];
    const e = f.ecology.spawn(0, 77.5, 81.5);
    e.yaw = 0;
    e.speed = 0;
    e.moving = 0;
    e.targetX = e.x;
    e.targetZ = e.z;
    e.lastThink = f.world.time;
    f.ecology.rehash();
    const dx = 0.35,
      dz = 81.82 - 84.5,
      dy = 12.25 - 13.36;
    f.setCamera(
      77.5,
      13.36,
      84.5,
      Math.atan2(-dx, -dz),
      Math.atan2(dy, Math.hypot(dx, dz)),
    );
    f.selectTool(1);
    f.use();
    const fragments = f.loot.items
      .filter((d) => d.kind === "bio")
      .reduce((a, d) => a + d.count, 0);
    f.setCamera(77.5, 13.36, 81.8, 0, 0);
    for (let i = 0; i < 60; i++) f.fixedStep({});
    f.ecology.entities = [...others, e];
    f.ecology.rehash();
    return { fragments, collected: f.inventory.count("bio") };
  });
  assert.ok(combat.fragments > 0 && combat.collected > 0);
  console.log("COMBAT", JSON.stringify(combat));
  // Supply a deterministic pickup fixture, then use the same collection and crafting UI as play.
  await page.evaluate(() => {
    const f = window.FERAL;
    f.loot.spawn("stone", 12, f.player.x, f.player.y + 0.4, f.player.z);
    f.loot.spawn("bio", 6, f.player.x, f.player.y + 0.4, f.player.z);
    f.fixedStep({});
  });
  await page.click("#inventoryBtn");
  await page
    .getByRole("button", { name: "생체 수지 × 2", exact: true })
    .click();
  await page.click("#craftOutput");
  await page
    .getByRole("button", { name: "2 m 채굴 해머", exact: true })
    .click();
  await page.click("#craftOutput");
  const hammer = await page.evaluate(() => ({
    owned: window.FERAL.inventory.unlocks.has("hammer"),
    size: window.FERAL.miningSize,
  }));
  assert.equal(hammer.owned, true);
  // Unlock adds the range choice; crafting no longer switches the held item.
  await page.evaluate(() => {
    FERAL.selectTool(2);
  });
  await page.screenshot({ path: "build/v2-crafted.png" });
  await page.evaluate(() => {
    const i = FERAL.inventory.slots.findIndex((s) => s?.id === "dirt");
    if (i >= 9) FERAL.inventory.move(i, 2);
    FERAL.selectHotbar(i < 9 ? i : 2);
  });
  await page.click("#resumeBtn");
  assert.equal(await page.evaluate(() => FERAL.buildSize), 0.5);
  const building = await page.evaluate(() => {
    const f = window.FERAL;
    const x = 78.75,
      z = 83.25,
      dx = x - 77.5,
      dz = z - 84.5,
      dy = 11.99 - 13.36;
    f.setCamera(
      77.5,
      13.36,
      84.5,
      Math.atan2(-dx, -dz),
      Math.atan2(dy, Math.hypot(dx, dz)),
    );
    const before = f.inventory.count("dirt");
    f.use();
    return {
      before,
      after: f.inventory.count("dirt"),
      placed: f.world.getCell(157, 24, 166),
      size: f.buildSize,
    };
  });
  assert.equal(building.size, 0.5);
  assert.equal(building.placed, 2);
  assert.equal(building.before - building.after, 1);
  console.log("BUILD", JSON.stringify(building));
  await page.evaluate(() => window.FERAL.save(true));
  const beforeSave = await page.evaluate(() => ({
    dirt: window.FERAL.inventory.count("dirt"),
    plank: window.FERAL.inventory.count("plank"),
    subcells: window.FERAL.world.subcells.size,
    inventory: window.FERAL.inventory.save(),
  }));
  await page.reload();
  await page.waitForFunction(() => window.FERAL?.ready);
  await page.click("#continueBtn");
  const restored = await page.evaluate(() => ({
    dirt: window.FERAL.inventory.count("dirt"),
    plank: window.FERAL.inventory.count("plank"),
    subcells: window.FERAL.world.subcells.size,
    hammer: window.FERAL.inventory.unlocks.has("hammer"),
    cell: window.FERAL.world.getCell(157, 24, 166),
  }));
  assert.equal(restored.dirt, beforeSave.dirt);
  assert.equal(restored.plank, beforeSave.plank);
  assert.equal(restored.subcells, beforeSave.subcells);
  assert.ok(restored.hammer);
  assert.equal(restored.cell, 2);
  await page.click("#inventoryBtn");
  await page.setViewportSize({ width: 412, height: 900 });
  await page.screenshot({ path: "build/v2-bag-portrait.png" });
  await page.setViewportSize({ width: 900, height: 412 });
  await page.click("#resumeBtn");
  await page.addInitScript(() => {
    if (sessionStorage.getItem("feral.legacyFixture") === "yes") {
      const s = JSON.parse(localStorage.getItem("feral.world.v1"));
      s.version = 1;
      delete s.inventory;
      delete s.loot;
      delete s.miningSize;
      delete s.buildMaterial;
      delete s.buildSize;
      delete s.world.subcells;
      localStorage.setItem("feral.world.v1", JSON.stringify(s));
    }
  });
  await page.evaluate(() =>
    sessionStorage.setItem("feral.legacyFixture", "yes"),
  );
  await page.reload();
  await page.waitForFunction(() => window.FERAL?.ready);
  await page.click("#continueBtn");
  const legacy = await page.evaluate(() => ({
    running: window.FERAL.stats().running,
    dirt: window.FERAL.inventory.count("dirt"),
    finite: Number.isFinite(window.FERAL.player.y),
  }));
  assert.ok(legacy.running && legacy.finite);
  assert.equal(legacy.dirt, 16);
  const report = {
    floor,
    mining,
    combat,
    hammer,
    building,
    beforeSave,
    restored,
    legacy,
    errors,
  };
  fs.writeFileSync(
    "build/progression-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  assert.equal(errors.length, 0);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
