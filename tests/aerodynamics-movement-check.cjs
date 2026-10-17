const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const version = JSON.parse(fs.readFileSync("version.json", "utf8"));
const csp = fs
  .readFileSync("app/src/main/java/com/kgb/feral/MainActivity.java", "utf8")
  .match(/headers.put\("Content-Security-Policy", "([^"]+)"\)/)[1];
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
  fs.mkdirSync("verification/0.7.0", { recursive: true });
  try {
    const base = process.env.FERAL_BASE_URL || "http://127.0.0.1:8080";
    const probe = await browser.newPage();
    await probe.route("**/old-csp", (r) =>
      r.fulfill({
        contentType: "text/html",
        headers: {
          "Content-Security-Policy": csp.replace(" 'wasm-unsafe-eval'", ""),
        },
        body: "<html></html>",
      }),
    );
    await probe.goto(base + "/old-csp");
    assert.equal(
      await probe.evaluate(async () => {
        try {
          await WebAssembly.compile(
            new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
          );
          return false;
        } catch {
          return true;
        }
      }),
      true,
    );
    await probe.close();
    const context = await browser.newContext({
      viewport: { width: 900, height: 412 },
      hasTouch: true,
      isMobile: true,
    });
    await context.route("**/*", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), "Content-Security-Policy": csp },
      });
    });
    await context.addInitScript((v) => {
      window.__update = {
        nativeVersion: v.nativeVersion,
        runtimeCode: v.versionCode,
        pendingCode: 0,
        blockedCode: 600,
        failureReason: "unconfirmed",
        publicUpdates: true,
        automatic: true,
        phase: "recovered",
        message: "이전 게임과 저장으로 복구했습니다.",
      };
      window.__calls = { healthy: [], retried: 0 };
      window.AndroidApp = {
        updateStatus: () => JSON.stringify(__update),
        retryFailedUpdate: () => __calls.retried++,
        runtimeHealthy: (code) => __calls.healthy.push(code),
      };
    }, version);
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const ready = () =>
      page.waitForFunction(
        () => window.FERAL?.ready && FERAL.stats().running,
        null,
        { timeout: 60000 },
      );
    await page.goto(base + "/index.html?world=frontier");
    await ready();
    await page.waitForFunction(() => __calls.healthy.length > 0, null, {
      timeout: 30000,
    });
    assert.deepEqual(await page.evaluate(() => __calls.healthy), [
      version.versionCode,
    ]);
    await page.route("**/eval-probe.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: "try { new Function('return 1')(); window.evalBlocked = false; } catch { window.evalBlocked = true; }",
      }),
    );
    await page.evaluate(() => {
      const el = document.createElement("script");
      el.src = "/eval-probe.js";
      document.head.append(el);
    });
    await page.waitForFunction(() => window.evalBlocked !== undefined);
    assert.equal(
      await page.evaluate(() => evalBlocked),
      true,
      "ordinary dynamic JavaScript remains blocked by native CSP",
    );
    await page.click("#menuBtn");
    await page.click('[data-tab="updates"]');
    assert.equal(await page.locator("#retryFailedUpdate").isVisible(), true);
    await page.click("#retryFailedUpdate");
    assert.equal(await page.evaluate(() => __calls.retried), 1);
    await page.evaluate(() => {
      __update.busy = true;
      FeralUpdates.refresh();
    });
    assert.equal(await page.locator("#retryFailedUpdate").isDisabled(), true);
    await page.evaluate(() => {
      __update.busy = false;
      __update.failureReason = "interrupted";
      FeralUpdates.refresh();
    });
    assert.match(
      await page.locator("#retryFailedUpdate").textContent(),
      /중단/,
    );
    await page.screenshot({ path: "verification/0.7.0/retry-menu.png" });
    await page.evaluate(() => {
      __update.blockedCode = 0;
      FeralUpdates.refresh();
    });
    assert.equal(await page.locator("#retryFailedUpdate").isVisible(), false);
    await page.click("#resumeBtn");
    await page.evaluate(() => {
      const f = FERAL;
      f.ecology.entities = [];
      f.ecology.rehash();
      for (let x = 77; x < 90; x++)
        for (let z = 78; z < 92; z++) {
          for (let y = 12; y < 40; y++) f.world.set(x, y, z, 0);
          f.world.set(x, 11, z, 1);
        }
      for (let x = 164; x < 176; x++)
        for (let z = 164; z < 178; z++) f.world.setCell(x, 25, z, 1);
      f.setCamera(80.5, 13.36, 85.25, 0, 0);
      f.player.flying = false;
      f.view.rebuild(100);
      for (let i = 0; i < 60; i++) f.fixedStep({ side: 1 });
    });
    assert.ok(await page.evaluate(() => FERAL.player.x < 82));
    await page.tap("#crawlBtn");
    assert.equal(await page.evaluate(() => FERAL.player.stance), "crawl");
    await page.evaluate(() => {
      for (let i = 0; i < 90; i++) FERAL.fixedStep({ side: 1 });
    });
    assert.ok(await page.evaluate(() => FERAL.player.x > 82.5));
    await page.tap("#crawlBtn");
    assert.equal(await page.evaluate(() => FERAL.player.stanceBlocked), true);
    assert.equal(
      await page.locator("#crawlBtn").getAttribute("aria-pressed"),
      "true",
    );
    await page.screenshot({ path: "verification/0.7.0/crawling-tunnel.png" });
    await page.evaluate(() => FERAL.save(true));
    await page.reload();
    await ready();
    assert.equal(await page.evaluate(() => FERAL.player.stance), "crawl");
    assert.ok(
      await page.evaluate(
        () => FERAL.view.camera.position.y < FERAL.player.y + 0.51,
      ),
    );
    await page.evaluate(() => {
      FERAL.player.x = 80;
      FERAL.player.desiredStance = "stand";
      FERAL.fixedStep({});
    });
    await page.tap("#crouchBtn");
    assert.equal(await page.evaluate(() => FERAL.player.stance), "crouch");
    await page.tap("#sprintBtn");
    assert.equal(await page.evaluate(() => FERAL.player.stance), "stand");
    assert.equal(
      await page.locator("#sprintBtn").getAttribute("aria-pressed"),
      "true",
    );
    // Real simultaneous touch input: movement + jump; cancellation releases both.
    const cdp = await context.newCDPSession(page),
      stick = await page.locator("#stick").boundingBox(),
      jump = await page.locator("#jumpBtn").boundingBox();
    const touches = [
      { x: stick.x + stick.width / 2, y: stick.y + 6, id: 1 },
      { x: jump.x + jump.width / 2, y: jump.y + jump.height / 2, id: 2 },
    ];
    const before = await page.evaluate(() => FERAL.player.z);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: touches,
    });
    await page.waitForTimeout(350);
    assert.ok(await page.evaluate((z) => FERAL.player.z < z, before));
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    const stopped = await page.evaluate(() => [FERAL.player.x, FERAL.player.z]);
    await page.evaluate(() => {
      for (let i = 0; i < 120; i++) FERAL.fixedStep();
    });
    assert.deepEqual(
      await page.evaluate(() => [FERAL.player.x, FERAL.player.z]),
      stopped,
    );
    await cdp.detach();
    for (const [width, height, left] of [
      [900, 412, false],
      [360, 640, false],
      [360, 640, true],
      [900, 412, true],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate((left) => {
        document.body.classList.toggle("leftHand", left);
        window.dispatchEvent(new Event("resize"));
      }, left);
      for (const id of ["sprintBtn", "crouchBtn", "crawlBtn"]) {
        const r = await page.locator("#" + id).boundingBox();
        assert.ok(
          r &&
            r.width >= 44 &&
            r.height >= 44 &&
            r.x >= 0 &&
            r.y >= 0 &&
            r.x + r.width <= width &&
            r.y + r.height <= height,
          id,
        );
        assert.equal(
          await page.locator("#" + id).evaluate((el) => {
            const r = el.getBoundingClientRect();
            return el.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            );
          }),
          true,
          id + " is not covered",
        );
      }
      if (width < height) {
        const vitals = await page.locator("#vitals").boundingBox(),
          label = await page.locator("#toolLabel").boundingBox();
        for (const id of ["sprintBtn", "crouchBtn", "crawlBtn"]) {
          const r = await page.locator("#" + id).boundingBox();
          assert.ok(r.y + r.height <= vitals.y, id + " clears survival meters");
          assert.ok(
            r.x + r.width <= label.x ||
              label.x + label.width <= r.x ||
              r.y + r.height <= label.y ||
              label.y + label.height <= r.y,
            id + " clears item name",
          );
        }
      }
      await page.screenshot({
        path: `verification/0.7.0/movement-${width}-${left ? "left" : "right"}.png`,
      });
    }
    await page.setViewportSize({ width: 900, height: 412 });
    await page.evaluate(() => document.body.classList.remove("leftHand"));
    await page.click("#menuBtn");
    await page.click("#editHudShortcut");
    for (const id of [
      "crawlBtn",
      "crouchBtn",
      "sprintBtn",
      "descendBtn",
      "flightReadout",
    ]) {
      await page.selectOption("#hudElement", id);
      const r = await page.locator(`[data-hud-id="${id}"]`).boundingBox();
      assert.ok(r.width > 0 && r.height > 0, id + " has editable preview");
    }
    await page.selectOption("#hudElement", "crawlBtn");
    await page.locator("#hudScale").evaluate((el) => {
      el.value = "120";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.click("#hudSave");
    await page.click("#resumeBtn");
    assert.ok(
      Math.abs((await page.locator("#crawlBtn").boundingBox()).width - 57.6) <
        1,
    );
    await page.reload();
    await ready();
    assert.ok(
      Math.abs((await page.locator("#crawlBtn").boundingBox()).width - 57.6) <
        1,
    );
    await page.evaluate(async () => {
      const { createLab, TYPES } = await import("/machine/model.js"),
        { initialPose } = await import("/machine/assembly-state.js"),
        s = createLab();
      s.assembly = true;
      s.pose = initialPose(80, 30, 85);
      s.pose.velocity.z = -24;
      const add = (type, x, y, z) => {
        const p = { id: "p" + s.nextId++, type, x, y, z };
        s.blueprint.push(p);
        s.hp[p.id] = TYPES[type].hp;
      };
      for (let z = -2; z <= 3; z++) add("hull", 0, 0, z);
      add("motor", 0, 1, 0);
      add("propeller", 0, 0, -3);
      for (let x = -4; x <= 4; x++)
        if (x) for (const z of [-1, 0, 1]) add("wing", x, 0, z);
      for (const x of [-2, -1, 1, 2]) add("elevator", x, 0, 3);
      add("rudder", 0, 1, 3);
      FERAL.frontier.machine = s;
      FERAL.inventory.unlocks.add("aviation");
      FERAL.player.stance = "stand";
      FERAL.player.flying = true;
      FERAL.setCamera(82, 31.36, 85, Math.PI / 2, 0);
    });
    await page.waitForFunction(
      () => !document.getElementById("interactBtn").hidden,
    );
    await page.tap("#interactBtn");
    assert.equal(await page.evaluate(() => FERAL.frontier.riding), true);
    await page.waitForFunction(
      () => !document.getElementById("flyBtn").classList.contains("hidden"),
    );
    await page.tap("#flyBtn");
    assert.equal(await page.evaluate(() => FERAL.frontier.airborne), true);
    await page.waitForFunction(
      () => !document.getElementById("descendBtn").hidden,
    );
    assert.equal(await page.locator("#crawlBtn").isVisible(), false);
    assert.equal(await page.locator("#descendBtn").isVisible(), true);
    await page.evaluate(() => {
      for (let i = 0; i < 60; i++) FERAL.fixedStep({ forward: 1 });
    });
    await page.waitForFunction(() =>
      document.getElementById("flightReadout").textContent.includes("양력"),
    );
    assert.ok(
      await page.evaluate(
        () => FERAL.frontierUI.motion.physics.throttle >= 0.5,
      ),
    );
    const down = await page.locator("#descendBtn").boundingBox();
    await page.mouse.move(down.x + down.width / 2, down.y + down.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await page.mouse.up();
    const readout = await page.locator("#flightReadout").boundingBox();
    for (const id of [
      "toast",
      "jumpBtn",
      "descendBtn",
      "interactBtn",
      "flyBtn",
    ]) {
      const r = await page.locator("#" + id).boundingBox();
      assert.ok(
        r.x + r.width <= readout.x ||
          readout.x + readout.width <= r.x ||
          r.y + r.height <= readout.y ||
          readout.y + readout.height <= r.y,
        "flight instruments clear " + id,
      );
    }
    await page.screenshot({ path: "verification/0.7.0/flight-controls.png" });
    await page.evaluate(() => {
      const s = FERAL.frontier.machine;
      s.pose.anchored = true;
      FERAL.frontier.riding = FERAL.frontier.airborne = false;
      FERAL.fixedStep({});
      FERAL.player.flying = true;
      FERAL.setCamera(
        s.pose.position.x + 6,
        s.pose.position.y + 4,
        s.pose.position.z + 7,
        0.7,
        -0.3,
      );
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: "verification/0.7.0/aircraft.png" });
    assert.deepEqual(errors, []);
    const result = {
      nativeCspReproduction: true,
      wasmBoot: true,
      javascriptEvalBlocked: true,
      healthAck: true,
      failedVersionRetryButton: true,
      retryBusyState: true,
      interruptedLabel: true,
      crawlTunnel: true,
      ceilingClearance: true,
      stanceSaveRestore: true,
      multiTouchCancel: true,
      portraitLandscapeBothHands: true,
      hudEditor: true,
      flightControls: true,
      errors,
    };
    fs.writeFileSync(
      "verification/0.7.0/browser-results.json",
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
