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
    ],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 412 },
      hasTouch: true,
      isMobile: true,
    });
    await page.addInitScript(() => {
      window.AndroidApp = {};
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:8080/index.html?world=frontier");
    await page.waitForFunction(
      () => window.FERAL?.ready && FERAL.stats().running,
    );
    await page.evaluate(() => {
      for (const k of ["stone", "wood", "plank", "fiber", "iron", "crystal"])
        FERAL.inventory.add(k, 100);
      FERAL.openBag();
    });
    for (const name of [
      "사냥 활",
      "화살 × 12",
      "합금 곡괭이",
      "합금 검",
      "돌 창",
      "삽",
      "벌목 도끼",
    ]) {
      await page.getByRole("button", { name, exact: true }).click();
      await page.click("#craftOutput");
    }
    const bowIndex = await page.evaluate(() =>
      FERAL.inventory.slots.findIndex((s) => s?.id === "bow"),
    );
    await page.click(`[data-slot="${bowIndex}"]`);
    await page.click('[data-slot="0"]');
    assert.equal(
      await page.evaluate(() => FERAL.inventory.equipment.weapon),
      "bow",
    );
    await page.screenshot({ path: "verification/equipment-ledger-0.5.0.png" });
    await page.click("#resumeBtn");
    const combat = await page.evaluate(() => {
      const f = FERAL;
      f.ecology.entities = [];
      // Elevated fixture isolates range/voxel collision from random terrain.
      const e = f.ecology.spawn(1, 80, 70);
      e.y = 30;
      e.yaw = 0;
      e.phase = 0;
      e.moving = 0;
      e.speed = 0;
      f.ecology.rehash();
      f.setCamera(80, 30.65, 80, 0, 0);
      f.selectTool(1);
      const before = f.inventory.count("arrow");
      f.use();
      const hp = e.hp;
      f.use();
      const result = {
        hp,
        max: e.maxHP,
        arrows: f.inventory.count("arrow"),
        before,
        wear: f.inventory.wear.bow,
        dead: e.dead,
      };
      f.save(true);
      return result;
    });
    assert.ok(combat.hp < combat.max, JSON.stringify(combat));
    assert.equal(combat.arrows, combat.before - 1);
    assert.equal(combat.wear, 139);
    await page.waitForTimeout(250);
    await page.screenshot({ path: "verification/equipment-combat-0.5.0.png" });
    await page.reload();
    await page.waitForFunction(
      () => window.FERAL?.ready && FERAL.stats().running,
    );
    assert.equal(await page.evaluate(() => FERAL.inventory.wear.bow), 139);
    for (const [width, height] of [
      [412, 900],
      [360, 640],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => FERAL.openBag());
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      assert.equal(overflow, false);
      await page.screenshot({ path: `build/equipment-${width}.png` });
      await page.click("#resumeBtn");
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      "verification/equipment-results-0.5.0.json",
      JSON.stringify(
        { combat, viewports: ["900x412", "412x900", "360x640"], errors },
        null,
        2,
      ),
    );
    console.log("EQUIPMENT", JSON.stringify(combat));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
