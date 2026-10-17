const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const out = "verification/0.7.1";
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
      FERAL.ecology.entities = [];
      FERAL.ecology.rehash();
      FERAL.player.flying = true;
      FERAL.setCamera(80, 45, 80, 0, 0);
      FERAL.selectTool(2);
      window.actions = { attack: 0, use: 0 };
      let kick = 0;
      Object.defineProperty(FERAL.view, "toolKick", {
        get: () => kick,
        set: (value) => {
          kick = value;
          if (value === 1) actions.attack++;
        },
      });
      const consume = FERAL.frontier.consume.bind(FERAL.frontier);
      FERAL.frontier.consume = (...args) => {
        actions.use++;
        return consume(...args);
      };
      const step = FERAL.controller.step.bind(FERAL.controller);
      FERAL.controller.step = (dt, input) => {
        window.lastInput = { ...input };
        return step(dt, input);
      };
    });
    await page.waitForFunction(() => window.lastInput !== undefined);
    const cdp = await page.context().newCDPSession(page);
    const send = (type, touchPoints) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    const point = async (id, pointerId = 1) => {
      const r = await page.locator("#" + id).boundingBox();
      assert.ok(r && r.width >= 44 && r.height >= 44, id);
      const hit = await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.closest("button, #stick")?.id,
        { x: r.x + r.width / 2, y: r.y + r.height / 2 },
      );
      if (hit !== id)
        await page.screenshot({ path: `${out}/touch-failure.png` });
      assert.equal(hit, id, id + " is not covered");
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: pointerId };
    };
    const state = () =>
      page.evaluate(() => ({
        yaw: FERAL.player.yaw,
        pitch: FERAL.player.pitch,
        y: FERAL.player.y,
        input: lastInput,
        actions: { ...actions },
        held: [...document.querySelectorAll("#hud .held")].map((el) => el.id),
      }));
    const results = [];
    for (const [width, height, left] of [
      [900, 412, false],
      [900, 412, true],
      [360, 640, false],
      [360, 640, true],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate((left) => {
        document.body.classList.toggle("leftHand", left);
        window.dispatchEvent(new Event("resize"));
      }, left);
      for (const id of ["actBtn", "useBtn", "jumpBtn", "descendBtn"]) {
        await page.evaluate((id) => {
          FERAL.setCamera(80, 45, 80, 0, 0);
          if (id === "useBtn") {
            FERAL.inventory.add("food", 4);
            FERAL.frontier.hunger = 0;
            const index = FERAL.inventory.slots.findIndex(
              (s) => s?.id === "food",
            );
            if (index >= 9) FERAL.inventory.move(index, 8);
            FERAL.selectHotbar(index < 9 ? index : 8);
          } else FERAL.selectTool(2);
        }, id);
        const start = await point(id),
          before = await state();
        assert.equal(
          await page
            .locator("#" + id)
            .evaluate((el) => getComputedStyle(el).touchAction),
          "none",
        );
        await send("touchStart", [start]);
        const end = {
          ...start,
          x: start.x + (start.x > width / 2 ? -100 : 100),
          y: start.y - 28,
        };
        await send("touchMove", [end]);
        const moved = await state();
        assert.ok(
          Math.abs(moved.yaw - before.yaw) > 0.2 &&
            moved.pitch > before.pitch + 0.05,
          id +
            " turns with held finger " +
            JSON.stringify({ width, height, left, before, moved }),
        );
        assert.deepEqual(
          moved.held,
          [id],
          id + " stays held outside the button",
        );
        if (id === "actBtn" || id === "useBtn") {
          const action = id === "actBtn" ? "attack" : "use";
          await page.waitForFunction(
            ({ action, count }) => actions[action] >= count + 2,
            { action, count: before.actions[action] },
          );
        } else {
          await page.waitForFunction(
            ({ up, y }) =>
              up ? FERAL.player.y > y + 0.3 : FERAL.player.y < y - 0.3,
            { up: id === "jumpBtn", y: before.y },
          );
          assert.equal(
            (await state()).input[id === "jumpBtn" ? "jump" : "down"],
            true,
          );
        }
        await send("touchEnd", []);
        const released = await state();
        assert.deepEqual(released.held, []);
        await page.evaluate(() => FERAL.fixedStep());
        const input = (await state()).input;
        assert.ok(!input.jump && !input.down);
        await page.waitForTimeout(500);
        assert.deepEqual(
          (await state()).actions,
          released.actions,
          "released action stops repeating",
        );
        results.push({
          width,
          height,
          left,
          id,
          yaw: moved.yaw,
          pitch: moved.pitch,
          heldDuringDrag: true,
          repeatedAction: true,
          released: true,
        });
      }
    }
    await page.setViewportSize({ width: 900, height: 412 });
    await page.evaluate(() => {
      document.body.classList.remove("leftHand");
      window.dispatchEvent(new Event("resize"));
      FERAL.setCamera(80, 45, 80, 0, 0);
    });
    await page.evaluate(() => {
      window.pointerTrace = [];
      for (const type of [
        "pointerdown",
        "pointerup",
        "pointercancel",
        "lostpointercapture",
      ])
        document.addEventListener(
          type,
          (e) => pointerTrace.push([e.type, e.pointerId, e.target.id]),
          true,
        );
    });
    // A second finger released from the same button must not release the owner.
    const jump = await point("jumpBtn"),
      second = { ...jump, x: jump.x + 4, id: 2 };
    await send("touchStart", [jump]);
    await send("touchStart", [jump, second]);
    await send("touchEnd", [second]);
    assert.deepEqual(
      (await state()).held,
      ["jumpBtn"],
      JSON.stringify(await page.evaluate(() => pointerTrace)),
    );
    await send("touchMove", [{ ...jump, x: jump.x - 90 }]);
    assert.ok((await state()).yaw > 0.2);
    await send("touchCancel", []);
    await page.waitForFunction(
      () =>
        !document.querySelector("#hud .held") &&
        document.getElementById("knob").style.transform === "",
    );
    await page.evaluate(() => FERAL.fixedStep());
    assert.ok(!(await state()).input.jump);
    // Joystick + attack drag + independent screen look; cancel releases all.
    const stick = await point("stick", 3),
      act = await point("actBtn", 4);
    const screen = { x: 450, y: 170, id: 5 };
    await send("touchStart", [stick, act, screen]);
    await send("touchMove", [
      { ...stick, y: stick.y - 35 },
      { ...act, x: act.x - 80 },
      { ...screen, y: screen.y - 30 },
    ]);
    await page.evaluate(() => FERAL.fixedStep());
    assert.ok((await state()).input.forward > 0.5);
    assert.deepEqual((await state()).held, ["actBtn"]);
    await page.screenshot({ path: `${out}/held-action-look.png` });
    await send("touchCancel", []);
    await page.waitForFunction(
      () =>
        !document.querySelector("#hud .held") &&
        document.getElementById("knob").style.transform === "",
    );
    await page.evaluate(() => FERAL.fixedStep());
    assert.equal(
      (await state()).input.forward,
      0,
      JSON.stringify(await page.evaluate(() => pointerTrace)),
    );
    assert.deepEqual((await state()).held, []);
    // Pausing mid-gesture clears capture; an old finger cannot move the resumed camera.
    const hold = await point("actBtn");
    await send("touchStart", [hold]);
    await page.evaluate(() => {
      FERAL.pause(true);
      FERAL.pause(false);
    });
    const resumed = await state();
    await send("touchMove", [{ ...hold, x: hold.x - 90 }]);
    assert.deepEqual((await state()).held, []);
    assert.equal((await state()).yaw, resumed.yaw);
    await send("touchEnd", []);
    // Use can intentionally open a menu: that transition releases the hold too.
    await page.evaluate(() => FERAL.selectTool(2));
    const use = await point("useBtn");
    await send("touchStart", [use]);
    assert.equal(await page.evaluate(() => FERAL.stats().paused), true);
    assert.deepEqual((await state()).held, []);
    await send("touchEnd", []);
    await page.tap("#frontierClose");
    // Actual capture loss releases flight input even without pointerup.
    await page.evaluate(() =>
      document
        .getElementById("jumpBtn")
        .addEventListener(
          "pointerdown",
          (e) => (window.jumpPointer = e.pointerId),
          { once: true },
        ),
    );
    const captured = await point("jumpBtn");
    await send("touchStart", [captured]);
    await send("touchMove", [{ ...captured, x: captured.x - 1 }]);
    await page.evaluate(() =>
      document
        .getElementById("jumpBtn")
        .dispatchEvent(
          new PointerEvent("lostpointercapture", { pointerId: 999 }),
        ),
    );
    assert.deepEqual(
      (await state()).held,
      ["jumpBtn"],
      "unrelated capture loss is ignored",
    );
    await page.evaluate(() =>
      document.getElementById("jumpBtn").releasePointerCapture(jumpPointer),
    );
    await send("touchMove", [{ ...captured, x: captured.x - 2 }]);
    await page.evaluate(() => FERAL.fixedStep());
    assert.ok(!(await state()).input.jump);
    assert.deepEqual((await state()).held, []);
    await send("touchEnd", []);
    assert.deepEqual(errors, []);
    const result = {
      gestures: results,
      sameButtonMultiTouch: true,
      joystickAndLook: true,
      cancellation: true,
      pauseReset: true,
      menuInteractionReset: true,
      captureLoss: true,
      errors,
    };
    fs.writeFileSync(
      `${out}/touch-look-results.json`,
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
