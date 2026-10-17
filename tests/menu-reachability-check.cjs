const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const out = "verification/0.7.2";
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
    const context = await browser.newContext({
      viewport: { width: 900, height: 412 },
      hasTouch: true,
      isMobile: true,
    });
    await context.addInitScript(() => (window.AndroidApp = {}));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const base = process.env.FERAL_BASE_URL || "http://127.0.0.1:8080";
    await page.goto(base + "/index.html?world=frontier");
    await page.waitForFunction(
      () => window.FERAL?.ready && FERAL.stats().running,
      null,
      { timeout: 60000 },
    );
    const cdp = await context.newCDPSession(page);
    // No locator.click/tap, scrollIntoView or assigned scrollTop: every action must
    // hit an exposed viewport coordinate, reached only with browser touch gestures.
    const exposed = (selector) =>
      page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        let left = Math.max(0, r.left),
          right = Math.min(innerWidth, r.right),
          top = Math.max(0, r.top),
          bottom = Math.min(innerHeight, r.bottom);
        for (let p = el.parentElement; p; p = p.parentElement) {
          const c = getComputedStyle(p),
            b = p.getBoundingClientRect();
          if (/(auto|scroll|hidden|clip)/.test(c.overflowY)) {
            top = Math.max(top, b.top);
            bottom = Math.min(bottom, b.bottom);
          }
          if (/(auto|scroll|hidden|clip)/.test(c.overflowX)) {
            left = Math.max(left, b.left);
            right = Math.min(right, b.right);
          }
        }
        const x = (left + right) / 2,
          y = (top + bottom) / 2;
        return {
          x,
          y,
          left,
          right,
          top,
          bottom,
          width: right - left,
          height: bottom - top,
          full: bottom - top >= r.height - 2 && right - left >= r.width - 2,
          hit:
            right > left &&
            bottom > top &&
            el.contains(document.elementFromPoint(x, y)),
        };
      }, selector);
    const tap = async (selector) => {
      const r = await exposed(selector);
      assert.ok(
        r?.hit && r.full,
        `${selector} must be exposed before tapping: ${JSON.stringify(r)}`,
      );
      await page.touchscreen.tap(r.x, r.y);
    };
    const swipe = async (selector, direction = 1, startSelector) => {
      const r = await exposed(selector);
      assert.ok(r?.height > 45, selector + " has a usable scroll viewport");
      let x = r.left + Math.min(45, r.width * 0.35),
        y = direction > 0 ? r.bottom - 12 : r.top + 12;
      if (startSelector) {
        const b = await exposed(startSelector);
        assert.ok(b?.hit && b.full);
        x = b.x;
        y = b.y;
      }
      const end = Math.max(
        r.top + 5,
        Math.min(r.bottom - 5, y - direction * Math.min(180, r.height * 0.65)),
      );
      assert.ok(Math.abs(end - y) > 20, selector + " has room for a swipe");
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y, id: 1 }],
      });
      for (let i = 1; i <= 10; i++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y + ((end - y) * i) / 10, id: 1 }],
        });
        await page.waitForTimeout(18);
      }
      await page.waitForTimeout(80);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await page.waitForTimeout(100);
    };
    const reach = async (target, scroller, direction = 1) => {
      for (let i = 0; i < 24; i++) {
        const r = await exposed(target);
        if (r?.hit && r.full) return i;
        await swipe(scroller, direction);
      }
      assert.fail("Cannot reach " + target + " by touch in " + scroller);
    };
    const layouts = [];
    for (const [width, height] of [
      [900, 412],
      [640, 360],
      [568, 320],
      [360, 640],
      [320, 480],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => {
        const inv = FERAL.inventory;
        inv.slots.fill(null);
        inv.selectedSlot = 0;
        inv.add("woodpick", 1);
        inv.add("crystal", 20);
        inv.add("resin", 20);
        inv.add("essence", 20);
        inv.add("medicine", 4);
        inv.slots[9] = { id: "wood", count: 4 };
        inv.slots[35] = { id: "stone", count: 4 };
        inv.overflow = [{ id: "fiber", count: 3 }];
        inv.unlocks.delete("pulse");
        inv.revision++;
      });
      await tap("#inventoryBtn");
      await tap('[data-filter="all"]');
      await reach("[data-recipe]:first-child", "#recipeList", -1);
      const recipeIds = await page
        .locator("[data-recipe]")
        .evaluateAll((els) => els.map((e) => e.dataset.recipe));
      const reachable = new Set();
      for (let i = 0; i < 24; i++) {
        for (const id of recipeIds) {
          const r = await exposed(`[data-recipe="${id}"]`);
          if (r?.full && r.hit) reachable.add(id);
        }
        const last = await exposed("[data-recipe]:last-child");
        if (last?.hit && last.full) break;
        const before = await page.evaluate(() =>
          JSON.stringify(FERAL.inventory.slots),
        );
        // Start on an icon, not a convenient empty gap between buttons.
        const tile = await page.locator("#recipeList").evaluate((el) => {
          const r = el.getBoundingClientRect();
          return [...el.children].reverse().find((b) => {
            const t = b.getBoundingClientRect();
            return t.top >= r.top + 20 && t.bottom <= r.bottom - 3;
          })?.dataset.recipe;
        });
        await swipe(
          "#recipeList",
          1,
          tile ? `[data-recipe="${tile}"]` : undefined,
        );
        assert.equal(
          await page.evaluate(() => JSON.stringify(FERAL.inventory.slots)),
          before,
          "scrolling never crafts or moves items",
        );
      }
      assert.deepEqual(
        [...reachable].sort(),
        [...recipeIds].sort(),
        "every recipe can be exposed and hit-tested",
      );
      await tap('[data-recipe="pulse"]');
      assert.equal(
        await page.locator("#recipeName").textContent(),
        "강화 복셀 펄스",
      );
      const recipeScroll = await page
        .locator("#recipeList")
        .evaluate((e) => e.scrollTop);
      await reach("#craftOutput", ".inventoryBody", -1);
      const crystal = await page.evaluate(() =>
        FERAL.inventory.count("crystal"),
      );
      await tap("#craftOutput");
      assert.equal(
        await page.evaluate(() => FERAL.inventory.count("crystal")),
        crystal - 5,
      );
      assert.ok(
        await page.evaluate(() => FERAL.inventory.unlocks.has("pulse")),
      );
      assert.equal(
        await page.locator("#recipeList").evaluate((e) => e.scrollTop),
        recipeScroll,
        "selection and crafting keep recipe scroll position",
      );
      // Swipe beginning on an inventory slot must pan, not drag or select it.
      const slotsBefore = await page.evaluate(() =>
        JSON.stringify(FERAL.inventory.slots),
      );
      const firstVisible = await page.locator(".itemSlot").evaluateAll(
        (els) =>
          els.find((e) => {
            const r = e.getBoundingClientRect(),
              b = e.closest(".inventoryBody").getBoundingClientRect();
            return r.top >= b.top + 35 && r.bottom < b.bottom - 5;
          })?.dataset.slot,
      );
      assert.ok(firstVisible, "a slot is available to begin a scroll gesture");
      await swipe(".inventoryBody", 1, `[data-slot="${firstVisible}"]`);
      assert.equal(
        await page.evaluate(() => JSON.stringify(FERAL.inventory.slots)),
        slotsBefore,
      );
      assert.equal(
        await page.locator(".itemSlot.moving").count(),
        0,
        "swiping does not select a slot",
      );
      await reach('[data-slot="9"]', ".inventoryBody", -1);
      await tap('[data-slot="9"]');
      await reach('[data-slot="8"]', ".inventoryBody");
      assert.equal(
        await page.locator(".itemSlot.moving").getAttribute("data-slot"),
        "9",
        "scrolling keeps the selected source",
      );
      await tap('[data-slot="8"]');
      assert.equal(
        await page.evaluate(() => FERAL.inventory.slots[8]?.id),
        "wood",
      );
      assert.equal(await page.evaluate(() => FERAL.inventory.slots[9]), null);
      await reach('[data-slot="35"]', ".inventoryBody");
      await tap('[data-slot="35"]');
      await reach('[data-slot="7"]', ".inventoryBody");
      await tap('[data-slot="7"]');
      assert.equal(
        await page.evaluate(() => FERAL.inventory.slots[7]?.id),
        "stone",
      );
      assert.equal(await page.evaluate(() => FERAL.inventory.slots[35]), null);
      await reach("#reclaimItems", ".inventoryBody");
      await tap("#reclaimItems");
      assert.equal(
        await page.evaluate(() => FERAL.inventory.count("fiber")),
        3,
      );
      await page.screenshot({ path: `${out}/inventory-bottom-${width}.png` });
      await tap('[data-filter="gear"]');
      assert.equal(
        await page.locator("#recipeList").evaluate((e) => e.scrollTop),
        0,
        "changing a filter starts its list at the top",
      );
      await tap('[data-filter="all"]');
      await tap("#resumeBtn");
      // Vertical tab navigation and menu content are separate bounded scrollers.
      await tap("#menuBtn");
      const tabSwipes = await reach(
        '[data-tab="updates"]',
        "#pauseScreen .tabs",
      );
      await tap('[data-tab="updates"]');
      await reach('[data-tab="settings"]', "#pauseScreen .tabs", -1);
      await tap('[data-tab="settings"]');
      await reach("#leftHand", "#pauseScreen .menuContents");
      const checked = await page.locator("#leftHand").isChecked();
      await tap("#leftHand");
      assert.equal(await page.locator("#leftHand").isChecked(), !checked);
      await tap("#leftHand");
      await page.screenshot({ path: `${out}/settings-bottom-${width}.png` });
      await tap("#resumeBtn");
      // Status controls below the fold must be reached before consuming medicine.
      await page.evaluate(() => {
        FERAL.frontier.hp = 30;
      });
      await tap("#statusBtn");
      await reach("#useMedicine", "#frontierContent");
      const medicine = await page.evaluate(() =>
        FERAL.inventory.count("medicine"),
      );
      await tap("#useMedicine");
      assert.equal(
        await page.evaluate(() => FERAL.inventory.count("medicine")),
        medicine - 1,
      );
      await reach('[data-frontier-tab="machine"]', "#frontierPanel nav");
      await tap('[data-frontier-tab="machine"]');
      await reach("#frontierContent summary", "#frontierContent");
      await tap("#frontierContent summary");
      await swipe("#frontierContent");
      await page.screenshot({ path: `${out}/machine-guide-${width}.png` });
      await tap("#frontierClose");
      layouts.push({
        width,
        height,
        reachableRecipes: reachable.size,
        craftedAfterScroll: true,
        slotSwipeSafe: true,
        tapMove: true,
        reclaim: true,
        menuTabSwipes: tabSwipes,
        settings: true,
        status: true,
        machineGuide: true,
      });
    }
    // The editor inspector also needs a real swipe before its bottom controls work.
    await page.setViewportSize({ width: 568, height: 320 });
    await tap("#menuBtn");
    await reach('[data-tab="world"]', "#pauseScreen .tabs", -1);
    await tap('[data-tab="world"]');
    await reach("#editHudShortcut", "#pauseScreen .menuContents");
    await tap("#editHudShortcut");
    const editorPosition = await page.evaluate(() => [
      FERAL.player.x,
      FERAL.player.y,
      FERAL.player.z,
    ]);
    const editorSwipes = await reach("#hudResetAll", "#hudInspector");
    await tap("#hudResetAll");
    assert.deepEqual(
      await page.evaluate(() => [
        FERAL.player.x,
        FERAL.player.y,
        FERAL.player.z,
      ]),
      editorPosition,
    );
    await page.screenshot({ path: `${out}/editor-bottom.png` });
    await tap("#hudCancel");
    await tap("#resumeBtn");
    // Long world lists and dialogs in a shortened viewport (e.g. an open keyboard).
    await page.goto(base + "/worlds.html");
    await page.evaluate(async () => {
      const { createWorld } = await import("./world-slots.js");
      for (let i = 0; i < 8; i++)
        createWorld(localStorage, "스크롤 월드 " + i, "island", i + 1);
    });
    await page.reload();
    await page.setViewportSize({ width: 320, height: 480 });
    await reach("#worlds article:last-child button:nth-of-type(2)", "#worlds");
    await tap("#worlds article:last-child button:nth-of-type(2)");
    await tap("#renameName");
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText("마지막 월드 이름 변경");
    await tap("#renameForm button:not([type=button])");
    assert.equal(
      await page.locator("#worlds article:last-child b").textContent(),
      "마지막 월드 이름 변경",
    );
    await page.setViewportSize({ width: 568, height: 260 });
    await tap("#newWorld");
    await reach("#name", "#createDialog", -1);
    await tap("#name");
    await page.keyboard.insertText("스크롤 생성");
    const dialogSwipes = await reach(
      "#create button:not([type=button])",
      "#createDialog",
    );
    await page.screenshot({ path: `${out}/create-dialog-short.png` });
    await tap("#create button:not([type=button])");
    assert.equal(await page.locator("#createDialog").isVisible(), false);
    assert.equal(
      await page.locator("#worlds article:last-child b").textContent(),
      "스크롤 생성",
    );
    const extra = {
      editorSwipes,
      editorPaused: true,
      worldListRename: true,
      dialogSwipes,
      shortDialogCreate: true,
    };
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      `${out}/menu-reachability-results.json`,
      JSON.stringify({ layouts, extra, errors }, null, 2),
    );
    console.log(JSON.stringify({ layouts, extra, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
