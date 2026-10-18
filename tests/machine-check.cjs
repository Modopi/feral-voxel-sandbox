const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.FERAL_CHROME ||
      "../toolchain/chrome-headless-shell-linux64/chrome-headless-shell",
    headless: true,
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--allow-file-access-from-files",
    ],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 900, height: 412 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const base = "file://" + process.cwd() + "/app/src/main/assets/";
    // The launcher (0.15.0) lists and makes worlds; the machine field opens through the game session entry.
    await page.goto(base + "index.html");
    await page.click("#openWorlds");
    await page.waitForSelector("article");
    assert.equal(await page.locator("article").count(), 3);
    await page.click("#newWorld");
    await page.selectOption("#preset", "machine");
    await page.fill("#worldName", "차량 시험 A");
    await page.click("#worldSubmit");
    assert.equal(await page.locator("article").count(), 4);
    await page.screenshot({ path: "build/legacy-worlds-0.3.0.png" });
    await page
      .locator("article")
      .filter({ hasText: "차량 시험 A" })
      .getByText("플레이", { exact: true })
      .click();
    await page.waitForFunction(
      () => window.FERAL_MACHINE?.evaluate().force === 600,
    );
    await page.selectOption("#layer", "1");
    await page.selectOption("#tool", "damage");
    await page.click('#grid button[data-x="0"][data-z="0"]');
    assert.equal(
      await page.evaluate(() => FERAL_MACHINE.evaluate().force),
      375,
    );
    await page.selectOption("#tool", "repair");
    await page.click('#grid button[data-x="0"][data-z="0"]');
    assert.equal(
      await page.evaluate(() => FERAL_MACHINE.evaluate().force),
      600,
    );
    await page.selectOption("#layer", "0");
    await page.selectOption("#tool", "add");
    await page.click('#grid button[data-x="0"][data-z="-2"]');
    assert.equal(
      await page.evaluate(() => FERAL_MACHINE.state.blueprint.length),
      9,
    );
    await page.screenshot({ path: "build/legacy-machine-build-0.3.0.png" });
    await page.click("#mode");
    await page.click("#recover");
    const pad = await page.locator('[data-key="ArrowUp"]').boundingBox();
    await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    assert.ok((await page.evaluate(() => FERAL_MACHINE.state.body.z)) < 4.9);
    const z = await page.evaluate(() => FERAL_MACHINE.state.body.z);
    // 실제 포인터 캡처와 키 입력으로 주행 검증
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(1200);
    await page.keyboard.up("KeyW");
    assert.ok(
      (await page.evaluate(() => FERAL_MACHINE.state.body.z)) < z - 0.2,
    );
    await page.click("#mode");
    await page.click("#save");
    await page.screenshot({ path: "build/legacy-machine-drive-0.3.0.png" });
    await page.reload();
    await page.waitForFunction(() => window.FERAL_MACHINE);
    assert.equal(
      await page.evaluate(() => FERAL_MACHINE.state.blueprint.length),
      9,
    );
    await page.click("header a");
    await page.click("#openWorlds");
    await page
      .locator("article")
      .filter({ hasText: "기계 베타 맵" })
      .getByText("플레이", { exact: true })
      .click();
    await page.waitForFunction(() => window.FERAL_MACHINE);
    assert.equal(
      await page.evaluate(() => FERAL_MACHINE.state.blueprint.length),
      8,
    );
    await page.setViewportSize({ width: 412, height: 900 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: "build/legacy-machine-portrait-0.3.0.png" });
    await page.setViewportSize({ width: 900, height: 412 });
    await page.click("header a");
    await page.click("#openWorlds");
    await page.click("#newWorld");
    await page.selectOption("#preset", "island");
    await page.fill("#worldName", "독립 섬");
    await page.fill("#worldSeed", "123");
    await page.click("#worldSubmit");
    await page.evaluate(() =>
      localStorage.setItem("feral.world.v1", "legacy sentinel"),
    );
    await page
      .locator("article")
      .last()
      .getByText("플레이", { exact: true })
      .click();
    await page.waitForFunction(
      () => window.FERAL?.ready && window.FERAL.stats().running,
      { timeout: 60000 },
    );
    // Island worlds run on the shared runtime from 0.14.0; the seed reaches the island generator.
    assert.equal(await page.evaluate(() => Number(FERAL.runtime.seed)), 123);
    assert.equal(await page.evaluate(() => FERAL.runtime.generator.id), "island");
    await page.click("#menuBtn");
    await page.click("#worldListBtn");
    await page.click("#openWorlds");
    await page.waitForSelector("article");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("feral.world.v1")),
      "legacy sentinel",
    );
    await page
      .locator("article")
      .last()
      .getByText("설정", { exact: true })
      .click();
    await page.fill("#worldName", "이름 바꾼 섬");
    await page.click("#worldSubmit");
    assert.equal(
      await page.locator("article").last().locator("b").textContent(),
      "이름 바꾼 섬",
    );
    await page
      .locator("article")
      .last()
      .getByText("삭제", { exact: true })
      .click();
    await page.click("#deleteNo");
    assert.equal(await page.locator("article").count(), 5);
    await page
      .locator("article")
      .last()
      .getByText("삭제", { exact: true })
      .click();
    await page.click("#deleteYes");
    assert.equal(await page.locator("article").count(), 4);
    assert.deepEqual(errors, []);
    console.log(
      "PASS world creation, independent saves, voxel edit, damage/repair, drive, reload, mobile layouts",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
