const { chromium } = require("playwright");
const fs = require("node:fs");
const version = JSON.parse(fs.readFileSync("version.json", "utf8"));
const nextVersion = version.version.replace(/\d+$/, n => String(Number(n) + 1));
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
  await page.addInitScript((v) => {
    window.__update = {
      nativeVersion: v.nativeVersion,
      nativeCode: v.nativeCode,
      runtimeCode: v.versionCode,
      publicUpdates: true,
      pendingCode: 0,
      pendingVersion: "",
      configured: false,
      automatic: true,
      lastCheck: 0,
      busy: false,
      phase: "idle",
      message: "",
    };
    window.__calls = {
      connected: 0,
      checked: 0,
      applied: 0,
      chosen: 0,
      healthy: [],
    };
    window.AndroidApp = {
      updateStatus: () => JSON.stringify(window.__update),
      chooseVersions: () => window.__calls.chosen++,
      configureUpdates: () => window.__calls.connected++,
      checkUpdates: () => window.__calls.checked++,
      setAutoUpdates: (value) => {
        window.__update.automatic = value;
      },
      applyUpdate: () => window.__calls.applied++,
      runtimeHealthy: (code) => window.__calls.healthy.push(code),
    };
  }, version);
  await page.goto(
    "file://" + process.cwd() + "/app/src/main/assets/play.html?world=default",
  );
  await page.waitForFunction(() => window.FERAL?.ready, { timeout: 60000 });
  await page.waitForFunction(() => window.__calls.healthy.length > 0, {
    timeout: 30000,
  });
  assert.deepEqual(await page.evaluate(() => window.__calls.healthy), [
    version.versionCode,
  ]);
  // The default world (the basic island, on the shared runtime from 0.14.0) starts without a title button.
  if (await page.locator("#startBtn").isVisible()) await page.click("#startBtn");
  await page.click("#menuBtn");
  await page.click('[data-tab="updates"]');
  assert.equal(
    await page.locator("#gameVersion").textContent(),
    version.version,
  );
  assert.equal(await page.locator("#checkUpdates").isDisabled(), false);
  assert.match(
    await page.locator("#updateConnection").textContent(),
    /공개.*로그인 불필요/,
  );
  await page.click("#checkUpdates");
  assert.equal(await page.evaluate(() => window.__calls.checked), 1);
  await page.click("#chooseGameVersion");
  assert.equal(await page.evaluate(() => window.__calls.chosen), 1);
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
  await page.evaluate(({code, next}) => {
    Object.assign(window.__update, {
      pendingCode: code,
      pendingVersion: next,
      phase: "ready",
      message: `${next} 준비 완료 · 다음 실행에 적용합니다.`,
    });
    window.FeralUpdates.refresh();
  }, { code: version.versionCode + 1, next: nextVersion });
  assert.equal(await page.locator("#applyUpdate").isVisible(), true);
  // The shared runtime saves in two generations (feral.world.v1.a/.b); applying writes a newer one first.
  const generation = () =>
    page.evaluate(() =>
      Math.max(0, ...["a", "b"].map((slot) => JSON.parse(localStorage.getItem(`feral.world.v1.${slot}`) ?? "{}").sequence ?? 0)),
    );
  const before = await generation();
  await page.click("#applyUpdate");
  assert.equal(await page.evaluate(() => window.__calls.applied), 1);
  assert.ok((await generation()) > before, "the world is saved before the update is applied");
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
  await page.screenshot({ path: "verification/public-update-menu-0.3.2.png" });
  const result = {
    gameVersion: version.version,
    nativeVersion: version.nativeVersion,
    healthAck: [version.versionCode],
    noTokenCheck: true,
    versionSelection: true,
    check: true,
    automaticToggle: true,
    pendingVersion: nextVersion,
    savesBeforeApply: true,
    saveFailureBlocksApply: true,
    errors,
  };
  const preview = await context.newPage();
  await preview.goto(
    "file://" + process.cwd() + "/app/src/main/assets/play.html?world=default",
  );
  await preview.waitForFunction(() => window.FERAL?.ready, { timeout: 60000 });
  assert.equal(await preview.locator("#checkUpdates").isDisabled(), true);
  assert.equal(await preview.locator("#automaticUpdates").isDisabled(), true);
  result.webPreviewDisabled = true;
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    "verification/public-update-ui-results-0.3.2.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
