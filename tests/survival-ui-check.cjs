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
    const context = await browser.newContext({
      viewport: { width: 900, height: 412 },
      hasTouch: true,
      isMobile: true,
    });
    await context.addInitScript(() => (window.AndroidApp = {}));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const ready = () =>
      page.waitForFunction(() => window.FERAL?.ready && FERAL.stats().running);
    await page.goto(
      (process.env.FERAL_BASE_URL || "http://127.0.0.1:8080") +
        "/play.html?world=frontier",
    );
    await ready();
    assert.equal(await page.locator("#hotbar .slot:visible").count(), 9);
    assert.equal(await page.locator("#hotbar .slot .glyph").count(), 0);
    await page.tap("#inventoryBtn");
    assert.equal(await page.locator("#inventoryGrid .itemSlot").count(), 27);
    // Desktop dragging uses the same atomic slot moves as mobile taps.
    const dragSlot = async (from, to) => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const visible = await page.evaluate(
          ({ from, to }) => {
            const body = document.querySelector(".inventoryBody"),
              r = body.getBoundingClientRect();
            const rects = [from, to].map((i) =>
              document
                .querySelector(`[data-slot="${i}"]`)
                .getBoundingClientRect(),
            );
            return {
              fits: rects.every((b) => b.top >= r.top && b.bottom <= r.bottom),
              direction:
                Math.max(...rects.map((b) => b.bottom)) > r.bottom ? 1 : -1,
              x: r.right - 12,
              y: r.top + 30,
            };
          },
          { from, to },
        );
        if (visible.fits) break;
        await page.mouse.move(visible.x, visible.y);
        await page.mouse.wheel(0, visible.direction * 100);
        await page.waitForTimeout(120);
      }
      for (const index of [from, to])
        assert.ok(
          await page.locator(`[data-slot="${index}"]`).evaluate((el) => {
            const r = el.getBoundingClientRect(),
              p = el.closest(".inventoryBody").getBoundingClientRect();
            return (
              r.top >= p.top &&
              r.bottom <= p.bottom &&
              el.contains(
                document.elementFromPoint(
                  r.x + r.width / 2,
                  r.y + r.height / 2,
                ),
              )
            );
          }),
          "drag slot is exposed",
        );
      const a = await page.locator(`[data-slot="${from}"]`).boundingBox(),
        b = await page.locator(`[data-slot="${to}"]`).boundingBox();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, {
        steps: 8,
      });
      await page.mouse.up();
    };
    await dragSlot(3, 18);
    assert.equal(
      await page.evaluate(() => FERAL.inventory.slots[18]?.id),
      "wood",
    );
    await dragSlot(18, 3);
    assert.equal(
      await page.evaluate(() => FERAL.inventory.slots[3]?.id),
      "wood",
    );
    const craft = async (id) => {
      await page.tap(`[data-recipe="${id}"]`);
      await page.tap("#craftOutput");
    };
    const before = await page.evaluate(() => FERAL.inventory.count("wood"));
    await craft("planks");
    assert.equal(
      await page.evaluate(() => FERAL.inventory.count("wood")),
      before - 2,
    );
    await craft("stonepick");
    const pick = await page.evaluate(() =>
      FERAL.inventory.slots.findIndex((s) => s?.id === "stonepick"),
    );
    await page.tap(`[data-slot="${pick}"]`);
    await page.tap('[data-slot="0"]');
    assert.equal(
      await page.evaluate(() => FERAL.inventory.slots[0].id),
      "stonepick",
    );
    await page.tap("#splitStack");
    await page.tap('[data-slot="2"]');
    await page.tap('[data-slot="17"]');
    assert.equal(await page.evaluate(() => FERAL.inventory.slots[17].count), 8);
    await page.tap("#splitStack");
    await page.tap('[data-slot="17"]');
    await page.tap('[data-slot="2"]');
    assert.equal(await page.evaluate(() => FERAL.inventory.slots[2].count), 16);
    await page.screenshot({
      path: "verification/inventory-0.5.0-landscape.png",
    });
    await page.tap("#resumeBtn");
    assert.equal(await page.evaluate(() => FERAL.heldItem()), "stonepick");
    // Real mobile hold mines a known block. No direct use/craft call drives this flow.
    await page.evaluate(() => {
      const f = FERAL;
      f.world.set(78, 13, 82, 3);
      f.setCamera(78.5, 13.5, 85, 0, 0);
    });
    const cdp = await context.newCDPSession(page);
    const center = async (selector) =>
      page.locator(selector).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
    let act = await center("#actBtn");
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...act, id: 1 }],
    });
    await page.waitForFunction(
      () => FERAL.world.getCell(157, 26, 165) === 0,
      null,
      { timeout: 30000 },
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    assert.equal(
      await page.evaluate(() => FERAL.world.getCell(157, 26, 165)),
      0,
    );
    assert.equal(
      await page.evaluate(() => FERAL.world.getCell(156, 26, 165)),
      3,
    );
    assert.ok(await page.evaluate(() => FERAL.inventory.wear.stonepick < 160));
    // Select a real block stack and use the distinct place/use control.
    await page.tap('[data-hotbar="2"]');
    assert.equal(await page.evaluate(() => FERAL.heldItem()), "dirt");
    await page.evaluate(() => {
      const f = FERAL;
      f.world.set(78, 13, 82, 3);
      f.setCamera(78.5, 13.5, 85, 0, 0);
    });
    await page.waitForTimeout(300);
    await page.tap("#useBtn");
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => FERAL.inventory.count("dirt")), 15);
    // Synthetic multitouch via browser input: move, look, and attack at the same time, then cancel.
    await page.tap('[data-hotbar="0"]');
    const stick = await center("#stick");
    act = await center("#actBtn");
    const previous = await page.evaluate(() => ({
      x: FERAL.player.x,
      z: FERAL.player.z,
      yaw: FERAL.player.yaw,
    }));
    const touches = [
      { ...stick, id: 1 },
      { x: 550, y: 180, id: 2 },
      { ...act, id: 3 },
    ];
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: touches,
    });
    touches[0].y -= 25;
    touches[1].x += 40;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: touches,
    });
    await page.waitForTimeout(500);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    const after = await page.evaluate(() => ({
      x: FERAL.player.x,
      z: FERAL.player.z,
      yaw: FERAL.player.yaw,
    }));
    assert.ok(Math.abs(after.yaw - previous.yaw) > 0.03);
    assert.ok(Math.hypot(after.x - previous.x, after.z - previous.z) > 0.1);
    await page.waitForTimeout(400);
    const stopped = await page.evaluate(() => ({
      x: FERAL.player.x,
      z: FERAL.player.z,
    }));
    await page.waitForTimeout(300);
    assert.ok(
      await page.evaluate(
        (p) => Math.hypot(FERAL.player.x - p.x, FERAL.player.z - p.z) < 0.02,
        stopped,
      ),
    );
    await page.evaluate(() =>
      FERAL.setCamera(
        77.5,
        FERAL.world.surface(77.5, 84.5) + 1.36,
        84.5,
        -0.5,
        -0.4,
      ),
    );
    await page.waitForTimeout(250);
    const checks = [];
    for (const [width, height] of [
      [900, 412],
      [412, 900],
      [360, 640],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(100);
      const geometry = await page.evaluate(() => {
        const rect = (id) => {
          const r = document.getElementById(id).getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        };
        const target = rect("target"),
          bar = rect("hotbar");
        const ids = ["actBtn", "useBtn", "jumpBtn", "stick"];
        const intersects = (a, b) =>
          a.x < b.x + b.w &&
          a.x + a.w > b.x &&
          a.y < b.y + b.h &&
          a.y + a.h > b.y;
        return {
          targetClear: !(
            target.x < innerWidth / 2 &&
            target.x + target.w > innerWidth / 2 &&
            target.y < innerHeight / 2 &&
            target.y + target.h > innerHeight / 2
          ),
          panelsClear:
            !intersects(rect("vitals"), rect("frontierActions")) &&
            ids.every((id) => !intersects(rect(id), target)),
          controlsClear: ids.every((id) => !intersects(rect(id), bar)),
          within: ids.every((id) => {
            const r = rect(id);
            return (
              r.x >= 0 &&
              r.y >= 0 &&
              r.x + r.w <= innerWidth &&
              r.y + r.h <= innerHeight
            );
          }),
          slots: [...document.querySelectorAll("#hotbar .slot")].filter(
            (e) => e.getBoundingClientRect().width > 0,
          ).length,
        };
      });
      assert.ok(
        geometry.targetClear &&
          geometry.panelsClear &&
          geometry.controlsClear &&
          geometry.within,
        JSON.stringify({ width, geometry }),
      );
      assert.equal(geometry.slots, 9);
      checks.push({ width, height, ...geometry });
      await page.screenshot({
        path: `verification/survival-hud-0.5.0-${width}.png`,
      });
      await page.tap("#inventoryBtn");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.locator("#inventoryHotbar").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `verification/inventory-0.5.0-${width}.png`,
      });
      await page.tap("#resumeBtn");
    }
    await page.setViewportSize({ width: 900, height: 412 });
    await page.evaluate(() => {
      const f = FERAL;
      f.ecology.entities = [];
      for (let x = 76; x <= 80; x++)
        for (let z = 78; z <= 85; z++) {
          for (let y = 12; y < 25; y++) f.world.set(x, y, z, 0);
          f.world.set(x, 11, z, 3);
        }
      for (const [x, z] of [
        [77.5, 81],
        [78.5, 81.5],
      ]) {
        const e = f.ecology.spawn(0, x, z);
        e.yaw = 0;
        e.speed = 0;
        e.age = 40;
        e.moving = 0;
      }
      f.ecology.rehash();
      const index = f.inventory.slots.findIndex((s) => s?.id === "seed");
      if (index >= 9) f.inventory.move(index, 5);
      f.selectHotbar(index < 9 ? index : 5);
      f.setCamera(77.5, 13.36, 83, 0, Math.atan2(-0.71, 2));
    });
    const seeds = await page.evaluate(() => FERAL.inventory.count("seed"));
    await page.tap("#useBtn");
    await page.waitForTimeout(650);
    await page.evaluate(() =>
      FERAL.setCamera(
        77.5,
        13.36,
        83,
        Math.atan2(-1, 1.5),
        Math.atan2(-0.71, Math.hypot(1, 1.5)),
      ),
    );
    await page.tap("#useBtn");
    await page.waitForTimeout(100);
    const ecology = await page.evaluate(() => ({
      seeds: FERAL.inventory.count("seed"),
      population: FERAL.ecology.entities.length,
      offspring: FERAL.ecology.entities.filter((e) => e.age < 5).length,
    }));
    assert.equal(ecology.seeds, seeds - 2);
    assert.equal(ecology.offspring, 1);
    assert.equal(ecology.population, 3);
    await page.screenshot({ path: "verification/ecology-0.5.0.png" });
    const hp = await page.evaluate(() => {
      const f = FERAL;
      f.world.time = 720;
      const fox = f.ecology.spawn(1, 77.5, 82);
      fox.speed = 0;
      f.ecology.rehash();
      return f.frontier.hp;
    });
    await page.waitForTimeout(700);
    assert.ok(await page.evaluate((hp) => FERAL.frontier.hp < hp, hp));
    await page.evaluate(() => {
      FERAL.world.time = 60;
      FERAL.ecology.entities = FERAL.ecology.entities.filter(
        (e) => e.type !== 1,
      );
    });
    // Left-hand controls remain separate from the hotbar and item panels.
    await page.setViewportSize({ width: 360, height: 640 });
    await page.evaluate(() => {
      document.getElementById("leftHand").checked = true;
      document.getElementById("leftHand").dispatchEvent(new Event("change"));
    });
    const left = await page.evaluate(() => ({
      stick: document.getElementById("stick").getBoundingClientRect().x,
      attack: document.getElementById("actBtn").getBoundingClientRect().x,
    }));
    assert.ok(left.stick > 180 && left.attack < 90);
    await page.screenshot({
      path: "verification/survival-left-hand-0.5.0.png",
    });
    const snapshot = await page.evaluate(() => {
      FERAL.save(true);
      return FERAL.inventory.save();
    });
    await page.reload();
    await ready();
    assert.deepEqual(
      await page.evaluate(() => FERAL.inventory.slots),
      snapshot.slots,
    );
    assert.equal(
      await page.evaluate(() => FERAL.inventory.selectedSlot),
      snapshot.selectedSlot,
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      "verification/survival-ui-results-0.5.0.json",
      JSON.stringify(
        {
          checks,
          touch: {
            mined: true,
            placed: true,
            simultaneous: true,
            cancelled: true,
          },
          saved: true,
          mouseDrag: true,
          ecology,
          leftHand: true,
          errors,
        },
        null,
        2,
      ),
    );
    console.log("SURVIVAL_UI_OK", JSON.stringify(checks));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
