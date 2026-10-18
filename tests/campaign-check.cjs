const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const out = "verification/0.9.0";
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
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const base = process.env.FERAL_BASE_URL || "http://127.0.0.1:8080";
    await page.goto(base + "/play.html?world=frontier");
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
    let lastUse = -Infinity;
    const tap = async (selector) => {
      if (selector === "#useBtn" && Number.isFinite(lastUse))
        await page.waitForFunction(
          (t) => FERAL.world.time >= t + 0.55,
          lastUse,
        );
      const r = await exposed(selector);
      assert.ok(
        r?.hit && r.full,
        `${selector} must be exposed before tapping: ${JSON.stringify(r)}`,
      );
      await page.touchscreen.tap(r.x, r.y);
      await page.waitForTimeout(140);
      if (selector === "#useBtn")
        lastUse = await page.evaluate(() => FERAL.world.time);
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
        if (r?.hit && r.full) {
          await page.waitForTimeout(300);
          return i;
        }
        await swipe(scroller, direction);
      }
      assert.fail("Cannot reach " + target + " by touch in " + scroller);
    };
    const ready = () =>
      page.waitForFunction(
        () => window.FERAL?.ready && FERAL.stats().running,
        null,
        { timeout: 60000 },
      );
    const aim = async (kind, id) => {
      await page.evaluate(
        ({ kind, id }) => {
          const f = FERAL;
          f.player.flying = true;
          f.frontierUI.draw();
          let node;
          if (kind === "resource")
            node = f.frontierUI.resourceMeshes.find(
              (n) => n.site.id === id,
            ).root;
          if (kind === "crop") node = f.frontierUI.campaignUI.plants[id];
          if (kind === "survey") node = f.frontierUI.campaignUI.markers[id];
          if (kind === "boss") node = f.frontierUI.boss;
          const p = node.getWorldPosition(node.position.clone());
          const y = p.y + (kind === "boss" ? 1.8 : kind === "survey" ? 1 : 0.6);
          f.setCamera(p.x, y + 1, p.z + 2.7, 0, Math.atan2(-1, 2.7));
        },
        { kind, id },
      );
      await page.waitForTimeout(300);
      const hit = await page.evaluate(
        () => FERAL.frontierUI.objectTarget()?.kind,
      );
      assert.equal(hit, kind, `ray targets ${kind}`);
    };
    const camp = () =>
      page.evaluate(() => {
        const f = FERAL;
        Object.assign(f.player, {
          x: 77.5,
          z: 84.5,
          y: f.world.surface(77, 84),
          flying: false,
          vy: 0,
        });
        f.renderCamera(1);
      });
    const close = () => tap("#frontierClose");
    const actionSelector = (action, arg = "") =>
      `[data-campaign="${action}"][data-arg="${arg}"]`;
    const action = async (name, arg = "") => {
      const target = actionSelector(name, arg);
      await reach(target, "#frontierContent");
      await tap(target);
    };
    // Fresh-game resources and actual exposed touch controls: no grants for this onboarding path.
    for (const id of ["wood:0", "berry:0", "herb:0"]) {
      await aim("resource", id);
      await tap("#useBtn");
      await page.waitForFunction(
        (id) => FERAL.frontier.region.resources[id] !== undefined,
        id,
      );
    }
    await camp();
    await tap("#journeyHUD");
    await action("claim", "gather");
    assert.ok(
      await page.evaluate(() =>
        FERAL.frontier.journey.claimed.includes("gather"),
      ),
    );
    await tap('[data-campaign-page="camp"]');
    await action("build", "garden");
    await action("plant", "0:berry");
    assert.equal(
      await page.evaluate(() => FERAL.frontier.region.outpost.plots[0].crop),
      "berry",
    );
    await close();
    // Advance the real campaign clock, not the crop's ready timestamp.
    await page.evaluate(() => {
      for (let i = 0; i < 365; i++)
        FERAL.frontier.tick(0.25, { x: 77.5, z: 84.5 }, FERAL.inventory);
    });
    const berries = await page.evaluate(() => FERAL.inventory.count("berry"));
    await aim("crop", 0);
    await tap("#useBtn");
    await page.waitForFunction(
      (n) => FERAL.inventory.count("berry") === n + 6,
      berries,
    );
    await camp();
    await tap("#journeyHUD");
    await action("claim", "roots");
    await close();
    await tap("#inventoryBtn");
    await tap("#recipeSearch");
    await page.keyboard.insertText("스튜");
    assert.equal(await page.locator("[data-recipe]").count(), 1);
    await tap('[data-recipe="stew"]');
    await reach("#craftOutput", ".inventoryBody", -1);
    await tap("#craftOutput");
    assert.equal(await page.evaluate(() => FERAL.inventory.count("stew")), 1);
    await tap("#recipeSearch");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("iron i");
    assert.ok(
      await page.locator("#pauseScreen").isVisible(),
      "typing i does not close the inventory",
    );
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await tap("#craftableOnly");
    assert.equal(await page.locator("#recipeList .unavailable").count(), 0);
    await page.screenshot({ path: out + "/crafting-search.png" });
    await tap("#craftableOnly");
    await tap("#resumeBtn");
    assert.equal(await page.evaluate(() => FERAL.save(true)), true);
    await page.reload();
    await ready();
    assert.equal(await page.evaluate(() => FERAL.frontier.journey.harvests), 1);
    // Layout fixtures expose every command, including late-game branches. Model tests separately
    // complete these prerequisites from an empty bag; these fixtures do not claim to be a playthrough.
    const layouts = [];
    for (const [width, height] of [
      [900, 412],
      [640, 360],
      [360, 640],
      [390, 844],
      [1280, 720],
    ]) {
      await page.setViewportSize({ width, height });
      await camp();
      await page.evaluate(() => {
        const s = FERAL.frontier,
          o = s.region.outpost;
        o.projects = ["garden", "kitchen", "workshop"];
        o.plots = [{ crop: "herb", ready: s.time - 1 }, null];
        o.signal = null;
        s.region.cacheClaimed = true;
        s.region.boss.defeated = true;
        s.region.contracts = ["a", "b"];
        s.allies = [s.region.villages[0].faction];
        s.journey.completedAt = null;
      });
      await tap("#journeyHUD");
      let exposedButtons = 0;
      for (const name of ["journey", "camp", "network", "sorties"]) {
        await tap(`[data-campaign-page="${name}"]`);
        const selectors = await page
          .locator(".journeySection:not([hidden]) [data-campaign]")
          .evaluateAll((els) =>
            els.map(
              (el) =>
                `[data-campaign="${el.dataset.campaign}"][data-arg="${el.dataset.arg}"]`,
            ),
          );
        for (const selector of selectors) {
          await reach(selector, "#frontierContent");
          const r = await exposed(selector);
          assert.ok(r.full && r.hit);
          exposedButtons++;
        }
        await page.screenshot({ path: `${out}/${name}-${width}.png` });
      }
      await close();
      const hud = await exposed("#journeyHUD");
      assert.ok(hud.full && hud.hit);
      layouts.push({ width, height, exposedButtons });
    }
    await page.setViewportSize({ width: 900, height: 412 });
    await camp();
    await page.evaluate(() => {
      const s = FERAL.frontier;
      s.journey.completedAt = s.time;
      s.region.outpost.signal = { channel: 0, route: "explorer" };
      s.region.outpost.sortie = null;
      s.region.outpost.nextSortie = 0;
    });
    await tap("#journeyHUD");
    await tap('[data-campaign-page="sorties"]');
    await action("startSortie", "survey");
    await close();
    for (let i = 0; i < 3; i++) {
      await aim("survey", i);
      await tap("#useBtn");
    }
    assert.equal(
      await page.evaluate(() => FERAL.frontier.region.outpost.sortie.done),
      true,
    );
    await camp();
    await tap("#journeyHUD");
    await tap('[data-campaign-page="sorties"]');
    await action("claimSortie");
    assert.equal(await page.evaluate(() => FERAL.frontier.journey.sorties), 1);
    await close();
    await page.evaluate(() => {
      const s = FERAL.frontier;
      for (let i = 0; i < 250; i++)
        s.tick(0.25, { x: 77.5, z: 84.5 }, FERAL.inventory);
    });
    await tap("#journeyHUD");
    await tap('[data-campaign-page="sorties"]');
    await action("startSortie", "hunt");
    await close();
    console.log("touch campaign: onboarding, five layouts and survey passed");
    await aim("boss");
    await page.evaluate(() => FERAL.selectHotbar(1));
    const attack = await exposed("#actBtn");
    assert.ok(attack.hit && attack.full);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: attack.x, y: attack.y, id: 4 }],
    });
    try {
      await page.waitForFunction(
        () => FERAL.frontier.activeBoss.defeated,
        null,
        { timeout: 60000 },
      );
    } catch (e) {
      console.log(
        await page.evaluate(() => ({
          boss: FERAL.frontier.activeBoss,
          held: FERAL.inventory.selected,
          hit: FERAL.frontierUI.objectTarget()?.kind,
          toast: document.querySelector("#toast")?.textContent,
          time: FERAL.world.time,
        })),
      );
      await page.screenshot({ path: out + "/combat-failure.png" });
      throw e;
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    assert.equal(
      await page.evaluate(() => FERAL.frontier.region.outpost.sortie.done),
      true,
    );
    await camp();
    await tap("#journeyHUD");
    await tap('[data-campaign-page="sorties"]');
    await action("claimSortie");
    await close();
    assert.equal(await page.evaluate(() => FERAL.frontier.journey.sorties), 2);
    // Inspect graphics in all quality modes. SwiftShader timings are diagnostic, not phone FPS.
    const graphics = [];
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => {
      FERAL.player.flying = true;
      FERAL.setCamera(83, 22, 103, 0.15, -0.12);
    });
    for (const quality of ["low", "balanced", "high"]) {
      await page.evaluate((q) => FERAL.view.qualitySet(q), quality);
      await page.waitForTimeout(800);
      const result = await page.evaluate(async () => {
        const frames = [];
        let previous = performance.now();
        for (let i = 0; i < 30; i++)
          await new Promise((resolve) =>
            requestAnimationFrame((now) => {
              frames.push(now - previous);
              previous = now;
              resolve();
            }),
          );
        frames.sort((a, b) => a - b);
        return {
          ...FERAL.view.stats(),
          medianFrameMs: frames[15],
          p95FrameMs: frames[28],
          geometries: FERAL.view.renderer.info.memory.geometries,
          textures: FERAL.view.renderer.info.memory.textures,
          shadow: FERAL.view.renderer.shadowMap.enabled,
        };
      });
      graphics.push({ quality, ...result });
      await page.screenshot({ path: `${out}/world-${quality}.png` });
    }
    await page.evaluate(() => {
      FERAL.world.time = 960;
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: out + "/world-night.png" });
    await page.evaluate(() => FERAL.view.qualitySet("balanced"));
    // Inspect the real ground mesh: diagonal charge telegraphs must match the hit zone.
    const chargeAligned = await page.evaluate(() => {
      const f = FERAL,
        b = f.frontier.activeBoss;
      return [1, -1].every((sign) => {
        Object.assign(b, {
          defeated: false,
          phase: b.phase + 1,
          warning: 10,
          pattern: "charge",
          x: 100,
          z: 100,
          originX: 100,
          originZ: 100,
          aimX: 104,
          aimZ: 100 + sign * 7,
        });
        f.frontierUI.draw();
        const mesh = f.frontierUI.warningGroup.children[0];
        mesh.updateMatrixWorld(true);
        const angle = Math.atan2(4, sign * 7),
          length = Math.hypot(4, 7) + 3;
        const point = mesh.position.clone();
        point.x += Math.sin(angle) * length * 0.3;
        point.z += Math.cos(angle) * length * 0.3;
        const local = mesh.worldToLocal(point);
        return (
          Math.abs(local.x) < 0.00001 &&
          Math.abs(Math.abs(local.y) - length * 0.3) < 0.00001
        );
      });
    });
    assert.equal(
      chargeAligned,
      true,
      "diagonal telegraph aligns with the authoritative hit zone",
    );
    assert.deepEqual(errors, []);
    const report = {
      layouts,
      onboarding: {
        gathers: 3,
        constructedGarden: true,
        plantedAndHarvested: true,
        craftedStew: true,
        saveReload: true,
      },
      sorties: { survey: true, hunt: true },
      graphics,
      chargeAligned,
      errors,
    };
    fs.writeFileSync(
      out + "/campaign-browser.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
