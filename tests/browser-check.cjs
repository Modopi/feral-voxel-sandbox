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
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = [],
    warnings = [];
  page.setDefaultTimeout(12000);
  await page.addInitScript(() => {
    window.AndroidApp = {};
  });
  page.on(
    "pageerror",
    (e) => (errors.push(e.message), console.log("PAGE_ERROR", e.message)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
    else if (m.type() === "warning") warnings.push(m.text());
  });
  await page.goto(
    "file://" + process.cwd() + "/app/src/main/assets/index.html",
  );
  await page.waitForFunction(() => window.FERAL?.ready, { timeout: 60000 });
  await page.screenshot({ path: "build/title-screen.png" });
  await page.click("#startBtn");
  await page.waitForTimeout(1800);
  const initial = await page.evaluate(() => ({
    ...window.FERAL.stats(),
    player: { ...window.FERAL.player },
    surface: window.FERAL.world.surface(
      window.FERAL.player.x,
      window.FERAL.player.z,
    ),
  }));
  console.log("INITIAL", JSON.stringify(initial));
  await page.screenshot({ path: "build/gameplay.png" });
  await page.evaluate(() => {
    window.FERAL.player.yaw = 0.7;
    window.FERAL.player.pitch = -0.15;
  });
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(700);
  await page.keyboard.up("KeyW");
  const moved = await page.evaluate(() => ({ ...window.FERAL.player }));
  assert.ok(
    Math.hypot(moved.x - initial.player.x, moved.z - initial.player.z) > 0.1,
    "WASD movement",
  );
  await page.click(".slot:nth-child(3)");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 600, y: 200 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 550, y: 230 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const touch = await page.evaluate(() => ({ ...window.FERAL.player }));
  assert.notEqual(touch.yaw, moved.yaw, "touch look");
  const damage = await page.evaluate(() => {
    const f = window.FERAL;
    f.setCamera(
      77.5,
      f.world.surface(77, 84) + 1.66,
      84.5,
      -Math.atan2(0.35, 2.6),
      Math.atan2(-1.36, Math.hypot(0.35, 2.6)),
    );
    const others = f.ecology.entities;
    f.ecology.entities = [];
    const e = f.ecology.spawn(0, 77.5, 81.5);
    e.yaw = 0;
    e.speed = 0;
    e.targetX = e.x;
    e.targetZ = e.z;
    e.lastThink = f.world.time;
    f.ecology.rehash();
    f.selectTool(1);
    f.use();
    const result = { damage: Object.keys(e.damage).length, lost: e.lost };
    f.ecology.entities = [...others, e];
    f.ecology.rehash();
    return result;
  });
  assert.ok(damage.damage || damage.lost, "pulse damages creature");
  console.log("DAMAGE", JSON.stringify(damage));
  await page.evaluate(() => window.FERAL.save(true));
  const saveSize = await page.evaluate(
    () => localStorage.getItem("feral.world.v1").length,
  );
  console.log("MOVEMENT_OK");
  await page.click("#menuBtn");
  await page.click('[data-tab="life"]');
  await page.click("#stressBtn");
  await page.click("#backToGame");
  await page.waitForTimeout(6500);
  const stress = await page.evaluate(() => window.FERAL.stats());
  console.log("STRESS", JSON.stringify(stress));
  await page.screenshot({ path: "build/stress-3000.png" });
  await page.evaluate(() => window.FERAL.save(true));
  await page.reload();
  await page.waitForFunction(() => window.FERAL?.ready, { timeout: 60000 });
  await page.click("#continueBtn");
  await page.waitForTimeout(700);
  const restored = await page.evaluate(() => window.FERAL.stats());
  await page.click("#menuBtn");
  await page.click('[data-tab="settings"]');
  await page.selectOption("#quality", "low");
  await page.check("#leftHand");
  await page.click("#backToGame");
  await page.waitForTimeout(500);
  const settings = await page.evaluate(() => ({
    quality: window.FERAL.view.quality,
    leftHand: document.body.classList.contains("leftHand"),
  }));
  await page.setViewportSize({ width: 900, height: 412 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: "build/mobile-landscape.png" });
  await page.setViewportSize({ width: 412, height: 900 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "build/mobile-portrait.png" });
  assert.ok(stress.total > 2900, "thousands populated");
  assert.ok(restored.total > 2900, "save restores population");
  assert.equal(settings.quality, "low");
  assert.equal(settings.leftHand, true);
  const report = {
    initial,
    moved,
    touch,
    damage,
    saveSize,
    stress,
    restored,
    settings,
    errors,
    warnings: warnings.slice(0, 10),
  };
  fs.writeFileSync(
    "build/browser-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  if (errors.length) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
