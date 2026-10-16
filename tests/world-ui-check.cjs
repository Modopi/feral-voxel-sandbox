const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.FERAL_CHROME || "/usr/bin/chromium", headless: true,
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 412 }, hasTouch: true, isMobile: true });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(() => window.AndroidApp = {});
    await page.goto((process.env.FERAL_BASE_URL || "http://127.0.0.1:8080") + "/index.html?world=frontier");
    await page.waitForFunction(() => window.FERAL?.ready && FERAL.stats().running, { timeout: 60000 });
    await page.evaluate(() => {
      const f = FERAL;
      f.ecology.entities = [];
      for (let x = 74; x <= 88; x++) for (let z = 70; z <= 85; z++) {
        for (let y = 12; y < 29; y++) f.world.set(x, y, z, 0);
        f.world.set(x, 11, z, 1);
      }
      // Keep the target still to isolate world-space geometry from animal AI.
      const e = f.ecology.spawn(0, 80, 76);
      e.y = 12; e.yaw = 0; e.speed = 0; e.moving = 0; e.age = 40;
      f.ecology.rehash(); f.ecology.update = () => {};
      window.subject = e;
      f.player.flying = true;
      f.setCamera(80, 13.36, 80, 0, Math.atan2(-0.58, 4));
      f.selectTool(1);
      f.view.rebuild(100);
    });
    await page.waitForFunction(() => FERAL.view.worldUI.labels.get("focus").data?.title.includes("이끼사슴") && FERAL.view.worldUI.labels.get("focus").mesh.visible, null, { timeout: 10000 }).catch(async e => {
      console.log(await page.evaluate(() => { const l = FERAL.view.worldUI.labels.get("focus"); return { data: l.data, occluded: l.occluded, mesh: l.mesh.position, camera: FERAL.view.camera.position, subject: { x: subject.x, y: subject.y, z: subject.z }, target: document.getElementById("target").innerText }; }));
      await page.screenshot({ path: "build/world-ui-failure.png" }); throw e;
    });
    const inspect = () => page.evaluate(() => {
      const ui = FERAL.view.worldUI, l = ui.labels.get("focus"), mesh = l.mesh;
      const p = mesh.position.clone().project(FERAL.view.camera);
      const halfWidth = mesh.geometry.parameters.width / 2;
      const left = mesh.position.clone().addScaledVector(ui.right, -halfWidth).project(FERAL.view.camera);
      const right = mesh.position.clone().addScaledVector(ui.right, halfWidth).project(FERAL.view.camera);
      return { visible: mesh.visible, width: (right.x - left.x) * innerWidth / 2,
        x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2,
        title: l.data.title, hp: l.data.value, depthTest: mesh.material.depthTest,
        sceneParent: ui.root.parent === FERAL.view.scene, domHidden: getComputedStyle(document.getElementById("target")).display === "none",
        planes: ui.labels.size };
    });
    const near = await inspect();
    assert.ok(near.sceneParent && near.depthTest && near.domHidden && near.planes === 2);
    await page.screenshot({ path: "verification/world-ui-0.5.2-near.png" });
    await page.evaluate(() => FERAL.setCamera(80, 13.36, 82, 0, Math.atan2(-0.58, 6)));
    await page.waitForTimeout(350);
    const far = await inspect();
    assert.ok(near.width > far.width * 1.35, JSON.stringify({ near, far }));
    await page.screenshot({ path: "verification/world-ui-0.5.2-far.png" });
    const follow = await page.evaluate(() => {
      const ui = FERAL.view.worldUI, l = ui.labels.get("focus"), before = l.mesh.position.x;
      subject.x += 0.4; ui.update();
      const delta = l.mesh.position.x - before;
      subject.x -= 0.4; ui.update();
      const texture = l.texture;
      ui.set("focus", { ...l.data, value: l.data.value - 1 });
      return { delta, reusedTexture: texture === l.texture };
    });
    assert.ok(Math.abs(follow.delta - 0.4) < 0.001 && follow.reusedTexture);
    const occlusion = await page.evaluate(() => {
      const f = FERAL, ui = f.view.worldUI, l = ui.labels.get("focus");
      for (let x = 79; x <= 81; x++) for (let y = 12; y <= 15; y++) f.world.set(x, y, 79, 3);
      ui.update(); const hidden = !l.mesh.visible && l.occluded;
      for (let x = 79; x <= 81; x++) for (let y = 12; y <= 15; y++) f.world.set(x, y, 79, 0);
      ui.update(); return { hidden, restored: l.mesh.visible };
    });
    assert.deepEqual(occlusion, { hidden: true, restored: true });
    await page.evaluate(() => { FERAL.setCamera(80, 13.36, 79, 0, Math.atan2(-0.58, 3)); FERAL.use(); });
    await page.waitForTimeout(250);
    const hit = await inspect();
    assert.ok(hit.hp < near.hp, JSON.stringify(hit));
    const dead = await page.evaluate(() => {
      subject.dead = true; FERAL.view.worldUI.update();
      return !FERAL.view.worldUI.labels.get("focus").mesh.visible;
    });
    assert.ok(dead, "dead targets disappear immediately");

    await page.evaluate(() => {
      const f = FERAL;
      f.ecology.entities = [];
      f.world.set(80, 12, 76, 3); f.world.set(80, 13, 76, 3);
      f.view.rebuild(100); f.setCamera(80.25, 13.36, 79, 0, -0.08); f.selectTool(2);
    });
    await page.waitForFunction(() => FERAL.view.worldUI.labels.get("focus").data?.title === "돌");
    const action = await page.locator("#actBtn").boundingBox();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: action.x + action.width / 2, y: action.y + action.height / 2, id: 1 }] });
    await page.waitForFunction(() => FERAL.view.worldUI.labels.get("focus").data?.value > 0);
    const mining = await page.evaluate(() => FERAL.view.worldUI.labels.get("focus").data.value);
    await page.screenshot({ path: "verification/world-ui-0.5.2-mining.png" });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    await page.evaluate(() => {
      const f = FERAL, v = f.frontier.region.villages[0], y = f.world.surface(v.x, v.z);
      f.setCamera(v.x, y + 1.36, v.z + 4, 0, Math.atan2(1.04, 4));
      window.villageName = v.name;
    });
    await page.waitForFunction(() => { const l = FERAL.view.worldUI.labels.get("context"); return l.data?.title === villageName && l.mesh.visible; }, null, { timeout: 10000 });
    await page.screenshot({ path: "verification/world-ui-0.5.2-village.png" });
    await page.tap("#interactBtn");
    assert.equal(await page.locator("#frontierPanel").getAttribute("data-page"), "society");
    await page.tap("#frontierClose");

    const layouts = [];
    for (const [width, height] of [[900, 412], [412, 900], [360, 640]]) {
      await page.setViewportSize({ width, height });
      await page.tap("#statusBtn");
      const layout = await page.evaluate(() => {
        const frame = document.querySelector(".gameWindow"), content = document.getElementById("frontierContent");
        const rect = frame.getBoundingClientRect(), supplies = document.getElementById("supplies").getBoundingClientRect();
        return { frameFits: rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
          noOuterScroll: frame.scrollHeight <= frame.clientHeight, noHorizontalScroll: content.scrollWidth <= content.clientWidth,
          suppliesVisible: supplies.top > rect.top && supplies.bottom < rect.bottom,
          paused: !FERAL.stats().running || document.body.classList.contains("menuOpen") };
      });
      assert.ok(Object.values(layout).every(Boolean), JSON.stringify({ width, layout }));
      layouts.push({ width, height, ...layout });
      await page.screenshot({ path: `verification/game-status-0.5.2-${width}.png` });
      await page.tap("#frontierClose");
    }
    // Supply slots act on the same survival state and inventory, not display-only UI.
    await page.evaluate(() => { FERAL.frontier.hp = 40; });
    await page.tap("#statusBtn");
    const medicines = await page.evaluate(() => FERAL.inventory.count("medicine"));
    await page.tap("#useMedicine");
    assert.equal(await page.evaluate(() => FERAL.inventory.count("medicine")), medicines - 1);
    assert.ok(await page.evaluate(() => FERAL.frontier.hp > 40));
    await page.tap("#frontierBag");
    assert.ok(await page.locator("#pauseScreen").evaluate(e => e.classList.contains("inventoryMode") && !e.classList.contains("hidden")));
    await page.tap("#resumeBtn");
    await page.tap("#menuBtn");
    await page.tap('[data-tab="settings"]');
    await page.screenshot({ path: "verification/game-menu-0.5.2.png" });
    await page.tap("#resumeBtn");
    assert.deepEqual(errors, []);
    const result = { near, far, follow, occlusion, damage: near.hp - hit.hp, dead, mining, villageLabelAndInteraction: true, layouts, supplyUse: true, inventoryTransition: true, errors };
    fs.writeFileSync("verification/world-ui-results-0.5.2.json", JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
