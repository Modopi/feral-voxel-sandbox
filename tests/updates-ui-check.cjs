const { chromium } = require("playwright");
const fs = require("node:fs");
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
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__update = {
      nativeVersion: "0.2.5",
      nativeCode: 205,
      runtimeCode: 205,
      pendingCode: 0,
      pendingVersion: "",
      configured: false,
      automatic: true,
      lastCheck: 0,
      busy: false,
      phase: "setup",
      message: "GitHub 연결 필요",
    };
    window.__calls = { connected: 0, checked: 0, applied: 0, healthy: [] };
    window.AndroidApp = {
      updateStatus: () => JSON.stringify(window.__update),
      configureUpdates: () => window.__calls.connected++,
      checkUpdates: () => window.__calls.checked++,
      setAutoUpdates: (value) => {
        window.__update.automatic = value;
      },
      applyUpdate: () => window.__calls.applied++,
      runtimeHealthy: (code) => window.__calls.healthy.push(code),
    };
  });
  await page.goto(
    "file://" + process.cwd() + "/app/src/main/assets/index.html",
  );
  await page.waitForFunction(() => window.FERAL?.ready, { timeout: 60000 });
  await page.waitForFunction(() => window.__calls.healthy.length > 0, {
    timeout: 30000,
  });
  assert.deepEqual(await page.evaluate(() => window.__calls.healthy), [205]);
  await page.click("#startBtn");
  await page.click("#menuBtn");
  await page.click('[data-tab="updates"]');
  assert.equal(await page.locator("#gameVersion").textContent(), "0.2.5");
  assert.equal(await page.locator("#checkUpdates").isDisabled(), true);
  await page.click("#connectUpdates");
  assert.equal(await page.evaluate(() => window.__calls.connected), 1);
  await page.evaluate(() => {
    Object.assign(window.__update, {
      configured: true,
      message: "최신 버전입니다.",
      lastCheck: Date.now(),
    });
    window.FeralUpdates.refresh();
  });
  await page.click("#checkUpdates");
  await page.uncheck("#automaticUpdates");
  assert.equal(await page.evaluate(() => window.__update.automatic), false);
  await page.evaluate(() => {
    Object.assign(window.__update, {
      pendingCode: 206,
      pendingVersion: "0.2.6",
      phase: "ready",
      message: "0.2.6 준비 완료 · 다음 실행에 적용합니다.",
    });
    window.FeralUpdates.refresh();
  });
  assert.equal(await page.locator("#applyUpdate").isVisible(), true);
  await page.click("#applyUpdate");
  assert.equal(await page.evaluate(() => window.__calls.applied), 1);
  assert.ok(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("feral.world.v1")).inventory,
    ),
  );
  await page.evaluate(() => {
    window.__originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw Error("quota");
    };
  });
  await page.click("#applyUpdate");
  assert.equal(
    await page.evaluate(() => window.__calls.applied),
    1,
    "save failure prevents reload",
  );
  assert.match(
    await page.locator("#updateMessage").textContent(),
    /저장하지 못해/,
  );
  await page.evaluate(() => {
    Storage.prototype.setItem = window.__originalSet;
  });
  await page.screenshot({ path: "build/update-menu-0.2.5.png" });
  const result = {
    gameVersion: "0.2.5",
    healthAck: [205],
    githubConnect: true,
    check: true,
    automaticToggle: true,
    pendingVersion: "0.2.6",
    savesBeforeApply: true,
    saveFailureBlocksApply: true,
    errors,
  };
  const preview = await context.newPage();
  await preview.goto(
    "file://" + process.cwd() + "/app/src/main/assets/index.html",
  );
  await preview.waitForFunction(() => window.FERAL?.ready, { timeout: 60000 });
  assert.equal(await preview.locator("#checkUpdates").isDisabled(), true);
  assert.equal(await preview.locator("#automaticUpdates").isDisabled(), true);
  result.webPreviewDisabled = true;
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    "build/updates-ui-results-0.2.5.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
