const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const out = "verification/0.8.0";
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
    const ready = () =>
      page.waitForFunction(
        () => window.FERAL?.ready && FERAL.stats().running,
        null,
        { timeout: 60000 },
      );
    await page.goto(
      (process.env.FERAL_BASE_URL || "http://127.0.0.1:8080") +
        "/index.html?world=frontier",
    );
    await ready();
    page.setDefaultTimeout(10000);
    global.debugPage = page;
    const cdp = await context.newCDPSession(page);
    const tap = async (selector) => {
      const r = await page.locator(selector).evaluate((el) => {
        const b = el.getBoundingClientRect(),
          x = b.x + b.width / 2,
          y = b.y + b.height / 2;
        let visible =
          b.top >= 0 &&
          b.bottom <= innerHeight &&
          b.left >= 0 &&
          b.right <= innerWidth;
        for (let p = el.parentElement; p; p = p.parentElement) {
          const c = getComputedStyle(p),
            r = p.getBoundingClientRect();
          if (
            /auto|scroll|hidden|clip/.test(c.overflowY) &&
            (b.top < r.top || b.bottom > r.bottom)
          )
            visible = false;
        }
        return {
          x,
          y,
          visible,
          hit: el.contains(document.elementFromPoint(x, y)),
        };
      });
      assert.ok(
        r.visible && r.hit,
        selector + " must be exposed: " + JSON.stringify(r),
      );
      await page.touchscreen.tap(r.x, r.y);
    };
    const swipe = async (selector) => {
      const r = await page.locator(selector).boundingBox();
      const x = r.x + Math.min(60, r.width / 2),
        y = Math.min(390, r.y + r.height) - 20,
        end = Math.max(r.y + 10, y - 180);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y, id: 1 }],
      });
      for (let i = 1; i <= 10; i++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y + ((end - y) * i) / 10, id: 1 }],
        });
        await page.waitForTimeout(20);
      }
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await page.waitForTimeout(160);
    };
    const reach = async (selector, scroller) => {
      for (let n = 0; n < 24; n++) {
        const b = await page.locator(selector).boundingBox(),
          s = await page.locator(scroller).boundingBox();
        if (b && b.y >= s.y && b.y + b.height <= Math.min(412, s.y + s.height))
          return;
        await swipe(scroller);
      }
      assert.fail("unreachable " + selector);
    };
    await page.evaluate(() => {
      const f = FERAL;
      f.ecology.entities = [];
      f.ecology.rehash();
      for (let x = 89; x <= 92; x++)
        for (let z = 87; z <= 93; z++)
          for (let y = 14; y <= 19; y++) f.world.set(x, y, z, 0);
      // Mining persistence is tested on supported terrain; floating cells now become bodies.
      for (let y = 1; y <= 15; y++) f.world.set(90, y, 88, 3);
      f.player.flying = true;
      f.setCamera(90.25, 15.25, 91, 0, 0);
      f.selectHotbar(0);
    });
    await tap("#actBtn");
    await page.waitForFunction(
      () => FERAL.world.damageAt({ hx: 180, hy: 30, hz: 177 }) > 0,
    );
    const partial = await page.evaluate(() =>
      FERAL.world.damageAt({ hx: 180, hy: 30, hz: 177 }),
    );
    await page.evaluate(() => {
      FERAL.setCamera(90.25, 15.25, 91, Math.PI, 0);
      FERAL.selectHotbar(1);
    });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      FERAL.selectHotbar(0);
      FERAL.setCamera(90.25, 15.25, 91, 0, 0);
    });
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(() =>
        FERAL.world.damageAt({ hx: 180, hy: 30, hz: 177 }),
      ),
      partial,
    );
    assert.match(
      await page.evaluate(
        () => FERAL.view.worldUI.labels.get("focus").data.detail,
      ),
      /파손/,
    );
    await page.screenshot({ path: out + "/persistent-damage.png" });
    assert.equal(await page.evaluate(() => FERAL.save(true)), true);
    await page.reload();
    await ready();
    assert.equal(
      await page.evaluate(() =>
        FERAL.world.damageAt({ hx: 180, hy: 30, hz: 177 }),
      ),
      partial,
    );
    // Use visible geometry; actions are actual exposed touch buttons, never direct model calls.
    const aim = async (kind, id) => {
      const result = await page.evaluate(
        ({ kind, id }) => {
          const f = FERAL;
          f.player.flying = true;
          f.frontierUI.draw();
          let x, y, z;
          if (kind === "resource") {
            const n = f.frontierUI.resourceMeshes.find((n) => n.site.id === id);
            ({ x, y, z } = n.root.position);
            y += 0.5;
          }
          if (kind === "relay") {
            const n = f.frontierUI.relayMeshes[id];
            ({ x, y, z } = n.root.position);
            y += 0.7;
          }
          if (kind === "ruin") {
            ({ x, y, z } = f.frontierUI.cache.position);
          }
          if (kind === "npc") {
            ({ x, y, z } = f.frontierUI.npcs[0].group.position);
            y += 0.85;
          }
          f.setCamera(x, y + 1, z + 2.7, 0, Math.atan2(-1, 2.7));
          return { x, y, z };
        },
        { kind, id },
      );
      await page.waitForTimeout(220);
      const found = await page.evaluate(
        () => FERAL.frontierUI.objectTarget()?.kind,
      );
      assert.equal(found, kind, JSON.stringify({ kind, id, result, found }));
      return result;
    };
    await page.evaluate(() => {
      FERAL.ecology.entities = [];
      FERAL.ecology.rehash();
      FERAL.selectHotbar(3);
    });
    await aim("resource", "berry:0");
    await tap("#useBtn");
    await page.waitForFunction(() => FERAL.inventory.count("berry") === 3);
    await page.waitForTimeout(900);
    await tap("#useBtn");
    assert.equal(await page.evaluate(() => FERAL.inventory.count("berry")), 3);
    await aim("resource", "herb:0");
    await page.waitForTimeout(800);
    await tap("#useBtn");
    await page.waitForFunction(() => FERAL.inventory.count("herb") === 2);
    await aim("resource", "scrap:0");
    await page.waitForTimeout(800);
    await tap("#useBtn");
    await page.waitForFunction(() => FERAL.inventory.count("scrap") === 3);
    await aim("resource", "wood:0");
    await page.waitForTimeout(800);
    const timber = await page.evaluate(() => FERAL.inventory.count("wood"));
    await tap("#useBtn");
    await page.waitForFunction(
      (n) => FERAL.inventory.count("wood") === n + 4,
      timber,
    );
    await page.screenshot({ path: out + "/field-gathering.png" });
    await aim("npc");
    await page.waitForTimeout(600);
    await tap("#useBtn");
    await page.waitForFunction(
      () => !document.getElementById("frontierPanel").hidden,
    );
    assert.equal(await page.locator("[data-contract]").count(), 6);
    await page.evaluate(() => FERAL.inventory.add("berry", 3));
    const quest = '.villageRow:first-child [data-contract="forage"]';
    await reach(quest, "#frontierContent");
    await page.waitForTimeout(350);
    await tap(quest);
    await page.waitForFunction(
      () => FERAL.frontier.region.contracts.length === 1,
    );
    assert.match(await page.locator("#frontierFeedback").innerText(), /완료/);
    assert.equal(await page.locator(quest).isDisabled(), true);
    await page.screenshot({ path: out + "/village-contract.png" });
    await tap("#frontierClose");
    // A solid terrain wall blocks the rendered cube, and cannot be interacted through.
    const core = await aim("ruin");
    await page.evaluate(({ x, y, z }) => {
      for (let xx = Math.floor(x) - 1; xx <= Math.floor(x) + 1; xx++)
        for (let yy = Math.floor(y); yy <= Math.floor(y) + 3; yy++)
          FERAL.world.set(xx, yy, Math.floor(z) + 2, 3);
    }, core);
    assert.equal(
      await page.evaluate(() => FERAL.frontierUI.objectTarget()?.kind),
      undefined,
    );
    await page.evaluate(({ x, y, z }) => {
      for (let xx = Math.floor(x) - 1; xx <= Math.floor(x) + 1; xx++)
        for (let yy = Math.floor(y); yy <= Math.floor(y) + 3; yy++)
          FERAL.world.set(xx, yy, Math.floor(z) + 2, 0);
    }, core);
    for (let n = 0; n < 3; n++) {
      await aim("relay", n);
      await page.waitForTimeout(700);
      await tap("#useBtn");
      await page.waitForFunction(
        (n) => FERAL.frontier.region.relays.length === n + 1,
        n,
      );
    }
    await aim("ruin");
    await page.screenshot({ path: out + "/ruin-unlocked.png" });
    await page.waitForTimeout(700);
    await tap("#useBtn");
    await page.waitForFunction(() => FERAL.frontier.region.cacheClaimed);
    assert.equal(await page.evaluate(() => FERAL.inventory.count("relic")), 1);
    // Animal observation/feeding/healing use the same secondary control with different held items.
    await page.evaluate(() => {
      const f = FERAL;
      for (let x = 90; x <= 96; x++)
        for (let z = 80; z <= 88; z++) {
          for (let y = 12; y < 20; y++) f.world.set(x, y, z, 0);
          f.world.set(x, 11, z, 1);
        }
      const e = f.ecology.spawn(0, 93, 83);
      Object.assign(e, { y: 12, yaw: 0, speed: 0, moving: 0, age: 40, hp: 20 });
      f.ecology.update = () => {};
      f.ecology.rehash();
      window.subject = e;
      f.selectHotbar(3);
      f.setCamera(93, 13.36, 86, 0, Math.atan2(-0.58, 3));
    });
    await page.waitForTimeout(800);
    await tap("#useBtn");
    await page.waitForFunction(() => FERAL.frontier.region.studies.includes(0));
    const observation = await page.evaluate(() =>
      FERAL.inventory.count("knowledge"),
    );
    await page.waitForTimeout(800);
    await tap("#useBtn");
    assert.equal(
      await page.evaluate(() => FERAL.inventory.count("knowledge")),
      observation,
    );
    await page.evaluate(() => {
      const f = FERAL,
        idx = f.inventory.slots.findIndex((s) => s?.id === "seed");
      f.inventory.move(idx, 8);
      f.selectHotbar(8);
    });
    await page.waitForTimeout(800);
    const seeds = await page.evaluate(() => FERAL.inventory.count("seed"));
    await tap("#useBtn");
    await page.waitForFunction(() => subject.fedUntil > 0);
    assert.equal(
      await page.evaluate(() => FERAL.inventory.count("seed")),
      seeds - 1,
    );
    await page.evaluate(() => {
      const f = FERAL,
        idx = f.inventory.slots.findIndex((s) => s?.id === "medicine");
      f.inventory.move(idx, 7);
      f.selectHotbar(7);
    });
    await page.waitForTimeout(800);
    const meds = await page.evaluate(() => FERAL.inventory.count("medicine"));
    await tap("#useBtn");
    await page.waitForFunction(() => subject.hp === subject.maxHP);
    assert.equal(
      await page.evaluate(() => FERAL.inventory.count("medicine")),
      meds - 1,
    );
    await page.screenshot({ path: out + "/animal-interaction.png" });
    await page.evaluate(() => FERAL.save(true));
    await page.reload();
    await ready();
    assert.deepEqual(
      await page.evaluate(() => ({
        relays: FERAL.frontier.region.relays,
        claimed: FERAL.frontier.region.cacheClaimed,
        contracts: FERAL.frontier.region.contracts.length,
        studies: FERAL.frontier.region.studies,
        berry: FERAL.frontier.region.resources["berry:0"] > 0,
      })),
      {
        relays: [0, 1, 2],
        claimed: true,
        contracts: 1,
        studies: [0],
        berry: true,
      },
    );
    assert.deepEqual(errors, []);
    const report = {
      partialDamage: partial,
      aimInterruptionAndReload: true,
      resources: 4,
      exposedNpcContract: true,
      wallOcclusion: true,
      relays: 3,
      ruinRewardOnce: true,
      animalObserveFeedHeal: true,
      contentSaveReload: true,
      errors,
    };
    fs.writeFileSync(
      out + "/interactions.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(report);
  } catch (e) {
    if (global.debugPage) {
      console.log(
        await global.debugPage.evaluate(() => ({
          feedback: document.getElementById("frontierFeedback").textContent,
          toast: document.getElementById("toast")?.textContent,
          items: FERAL.inventory.items,
          contracts: FERAL.frontier.region.contracts,
          player: FERAL.player,
          conversation: FERAL.frontierUI.conversation,
        })),
      );
      await global.debugPage.screenshot({ path: out + "/failure.png" });
    }
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
