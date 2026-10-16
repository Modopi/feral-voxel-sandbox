const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.FERAL_CHROME || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--enable-webgl",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-dev-shm-usage",
    ],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 900, height: 412 },
      hasTouch: true,
      isMobile: true,
    });
    await context.addInitScript(() => {
      window.AndroidApp = {};
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.setDefaultTimeout(20000);
    const base = process.env.FERAL_BASE_URL || "http://127.0.0.1:8080";
    await page.goto(base + "/index.html?world=frontier");
    const ready = () =>
      page.waitForFunction(
        () => window.FERAL?.ready && window.FERAL.stats().running,
        { timeout: 60000 },
      );
    await ready();
    const walk = await page.evaluate(() => {
      const f = FERAL,
        v = f.frontier.region.villages[0];
      f.player.yaw = Math.atan2(-(v.x - f.player.x), -(v.z - f.player.z));
      for (
        let n = 0;
        n < 450 && Math.hypot(v.x - f.player.x, v.z - f.player.z) > 5;
        n++
      )
        f.fixedStep({ forward: 1, side: 0 });
      f.renderCamera(1);
      return {
        distance: Math.hypot(v.x - f.player.x, v.z - f.player.z),
        knowledge: f.inventory.count("knowledge"),
        x: f.player.x,
        y: f.player.y,
        z: f.player.z,
      };
    });
    assert.ok(
      walk.distance < 12,
      "walkable supply trail reaches first village: " + JSON.stringify(walk),
    );
    await page.click("#interactBtn");
    await page
      .locator(".villageRow")
      .first()
      .locator('[data-action="trade"]')
      .click();
    assert.match(await page.locator("#frontierFeedback").innerText(), /결정 2/);
    await page.click("#frontierClose");
    await page.click("#inventoryBtn");
    const craft = async (name) =>
      page
        .locator(".recipe")
        .filter({ hasText: name })
        .getByRole("button", { name: "제작", exact: true })
        .click();
    await craft("목재 조각 × 4");
    await craft("목재 조각 × 4");
    await page.click("#resumeBtn");
    await page.click("#interactBtn");
    for (let n = 0; n < 2; n++)
      await page
        .locator(".villageRow")
        .first()
        .locator('[data-action="aid"]')
        .click();
    await page
      .locator(".villageRow")
      .first()
      .locator('[data-action="ally"]')
      .click();
    assert.equal(await page.evaluate(() => FERAL.frontier.allies.length), 1);
    await page.screenshot({ path: "build/frontier-society.png" });
    await page.click("#frontierClose");
    await page.click("#inventoryBtn");
    await craft("동력 연구");
    assert.equal(
      await page.evaluate(() => FERAL.inventory.unlocks.has("engineering")),
      true,
    );
    await page.click("#resumeBtn");
    // Combat integration fixture positions the player at the arena, then uses real ray aiming and attacks.
    const combat = await page.evaluate(() => {
      const f = FERAL,
        b = f.frontier.region.boss;
      const y = f.world.surface(b.x, b.z);
      f.setCamera(b.x, y + 1.8, b.z + 5, 0, 0);
      f.selectTool(1);
      let hits = 0;
      for (let n = 0; n < 24 && !b.defeated; n++) {
        for (let t = 0; t < 36; t++) f.fixedStep({});
        f.setCamera(b.x, f.world.surface(b.x, b.z) + 1.8, b.z + 5, 0, 0);
        f.use();
        hits++;
      }
      return {
        hits,
        defeated: b.defeated,
        relic: f.inventory.count("relic"),
        hp: b.hp,
      };
    });
    assert.ok(combat.defeated, JSON.stringify(combat));
    assert.equal(combat.relic, 1);
    // Resource fixture represents mined materials; construction, prerequisites and costs use the real UI.
    await page.evaluate(() => {
      const f = FERAL;
      for (const [id, n] of Object.entries({
        iron: 45,
        plank: 10,
        resin: 4,
        knowledge: 30,
        crystal: 8,
      }))
        f.inventory.add(id, n);
      f.setCamera(77.5, f.world.surface(77.5, 84.5) + 1.36, 84.5, 0, 0);
    });
    await page.click("#inventoryBtn");
    await craft("기본 차량 설계");
    await craft("회전익 연구");
    await craft("투사체 연구");
    await page.click("#resumeBtn");
    await page.click("#journalBtn");
    await page.click('[data-frontier-tab="machine"]');
    await page.selectOption("#frontierLayer", "2");
    await page.selectOption("#frontierPart", "rotor");
    await page
      .locator('#frontierMachineGrid button[aria-label="0,2,0 빈 칸"]')
      .click();
    await page
      .locator('#frontierMachineGrid button[aria-label="1,2,0 빈 칸"]')
      .click();
    await page.screenshot({ path: "build/frontier-machine.png" });
    await page.click("#rideVehicle");
    assert.equal(await page.evaluate(() => FERAL.frontier.riding), true);
    await page.click("#flyBtn");
    assert.equal(await page.evaluate(() => FERAL.frontier.airborne), true);
    const flight = await page.evaluate(() => {
      const f = FERAL,
        y = f.player.y;
      for (let n = 0; n < 90; n++)
        f.fixedStep({ forward: 0, side: 0, up: true });
      return f.player.y - y;
    });
    assert.ok(flight > 2);
    await page.click("#journalBtn");
    await page.click('[data-frontier-tab="machine"]');
    await page.click("#rideVehicle");
    assert.equal(await page.evaluate(() => FERAL.frontier.riding), false);
    await page.click("#frontierClose");
    await page.evaluate(() => {
      const f = FERAL;
      f.setCamera(77.5, f.world.surface(77.5, 84.5) + 1.36, 84.5, 0, 0);
      f.world.set(80, 25, 85, 3);
      f.save(true);
    });
    const before = await page.evaluate(() => ({
      food: FERAL.inventory.count("food"),
      machine: FERAL.frontier.machine.blueprint.length,
      allies: FERAL.frontier.allies.length,
    }));
    await page.click("#journalBtn");
    await page.click('[data-route="1,0"]');
    await ready();
    await page.waitForFunction(() => FERAL.frontier.key === "1,0");
    assert.equal(
      await page.evaluate(() => FERAL.inventory.count("food")),
      before.food - 1,
    );
    await page.click("#journalBtn");
    await page.click('[data-route="-1,0"]');
    await ready();
    await page.waitForFunction(() => FERAL.frontier.key === "0,0");
    const restored = await page.evaluate(() => ({
      block: FERAL.world.get(80, 25, 85),
      boss: FERAL.frontier.region.boss.defeated,
      machine: FERAL.frontier.machine.blueprint.length,
      allies: FERAL.frontier.allies.length,
      food: FERAL.inventory.count("food"),
    }));
    assert.equal(restored.block, 3);
    assert.ok(restored.boss);
    assert.equal(restored.machine, before.machine);
    assert.equal(restored.allies, before.allies);
    assert.equal(restored.food, before.food - 2);
    // Quota failure must not consume food, move the region, or overwrite the saved world.
    const failure = await page.evaluate(() => {
      const f = FERAL,
        food = f.inventory.count("food"),
        stored = localStorage.getItem("feral.slot.frontier"),
        set = Storage.prototype.setItem;
      Storage.prototype.setItem = function () {
        throw new DOMException("quota", "QuotaExceededError");
      };
      let moved;
      try {
        moved = f.travel(0, 1);
      } finally {
        Storage.prototype.setItem = set;
      }
      return {
        moved,
        key: f.frontier.key,
        food: f.inventory.count("food") === food,
        storage: localStorage.getItem("feral.slot.frontier") === stored,
      };
    });
    assert.deepEqual(failure, {
      moved: false,
      key: "0,0",
      food: true,
      storage: true,
    });
    await page.reload();
    await ready();
    assert.equal(
      await page.evaluate(() => FERAL.frontier.region.boss.defeated),
      true,
    );
    for (const [width, height] of [
      [900, 412],
      [412, 900],
      [360, 640],
    ]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: `build/frontier-hud-${width}.png` });
      await page.click("#journalBtn");
      for (const tab of ["map", "society", "machine", "journal"]) {
        await page.click(`[data-frontier-tab="${tab}"]`);
        assert.equal(
          await page
            .locator("#frontierPanel")
            .evaluate((e) => e.scrollWidth > e.clientWidth),
          false,
          `${width} ${tab} overflow`,
        );
      }
      await page.screenshot({ path: `build/frontier-journal-${width}.png` });
      await page.click("#frontierClose");
    }
    assert.deepEqual(errors, []);
    const result = {
      walk,
      combat,
      flight,
      restored,
      failure,
      viewports: [900, 412, 360],
      errors,
    };
    fs.writeFileSync(
      "build/frontier-browser-results.json",
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
