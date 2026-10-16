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
    await page.goto(base + "worlds.html");
    await page.waitForSelector("article");
    assert.equal(await page.locator("article").count(), 3);
    await page.click("#newWorld");
    await page.fill("#name", "차량 시험 A");
    await page.selectOption("#type", "machine");
    await page.click("#create button:not([type=button])");
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
    await page.click("#newWorld");
    await page.fill("#name", "독립 섬");
    await page.selectOption("#type", "island");
    await page.fill("#seed", "123");
    await page.click("#create button:not([type=button])");
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
    assert.equal(await page.evaluate(() => FERAL.world.seed), 123);
    await page.click("#menuBtn");
    await page.click("#worldListBtn");
    await page.waitForSelector("article");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("feral.world.v1")),
      "legacy sentinel",
    );
    await page
      .locator("article")
      .last()
      .getByText("이름 변경", { exact: true })
      .click();
    await page.fill("#renameName", "이름 바꾼 섬");
    await page.locator("#renameForm button").first().click();
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
