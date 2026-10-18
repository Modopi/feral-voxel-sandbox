const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const out = "verification/0.9.1";
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
    const ready = () =>
      page.waitForFunction(
        () => window.FERAL?.ready && FERAL.stats().running,
        null,
        { timeout: 60000 },
      );
    await page.goto(
      (process.env.FERAL_BASE_URL || "http://127.0.0.1:8080") +
        "/play.html?world=frontier",
    );
    await ready();
    const tap = async (selector) => {
      const r = await page.locator(selector).evaluate((el) => {
        const b = el.getBoundingClientRect(),
          x = b.x + b.width / 2,
          y = b.y + b.height / 2;
        return {
          x,
          y,
          width: b.width,
          height: b.height,
          visible:
            b.left >= 0 &&
            b.top >= 0 &&
            b.right <= innerWidth &&
            b.bottom <= innerHeight &&
            el.contains(document.elementFromPoint(x, y)),
        };
      });
      assert.ok(r.visible, selector + JSON.stringify(r));
      await page.touchscreen.tap(r.x, r.y);
      return r;
    };
    // Real touch rotation and pose selection in the inventory, including cancel.
    await tap("#inventoryBtn");
    await page.evaluate(async () => {
      const { mountCharacterPortrait } = await import(
        "./character-portrait.js"
      );
      window.portraitTest = mountCharacterPortrait(
        document.querySelector(".avatarPanel"),
        { held: "pick" },
      );
    });
    const cdp = await context.newCDPSession(page),
      r = await page.locator(".characterPortrait").boundingBox();
    const yaw = await page.evaluate(() => portraitTest.yaw),
      x = r.x + r.width * 0.25,
      y = r.y + r.height * 0.65;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1 }],
    });
    for (let i = 1; i <= 5; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + i * 8, y, id: 1 }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    assert.ok(
      Math.abs((await page.evaluate(() => portraitTest.yaw)) - yaw) > 0.3,
    );
    assert.equal(await page.evaluate(() => portraitTest.pointer), null);
    const actions = [];
    for (let i = 0; i < 6; i++) {
      const size = await tap(".avatarPanel .portraitAction");
      assert.ok(
        size.width >= 43.9 && size.height >= 43.9,
        JSON.stringify(size),
      );
      actions.push(await page.evaluate(() => portraitTest.action));
    }
    assert.deepEqual(actions, [
      "walk",
      "run",
      "crouch",
      "crawl",
      "wave",
      "idle",
    ]);
    await page.screenshot({ path: out + "/inventory-mobile.png" });
    await tap("#resumeBtn");
    await tap("#statusBtn");
    assert.equal(await page.locator("canvas.characterPortrait").count(), 1);
    assert.equal(
      await page.evaluate(() =>
        portraitTest.host.classList.contains("characterStage"),
      ),
      true,
    );
    await page.screenshot({ path: out + "/character-sheet-mobile.png" });
    await tap("#frontierClose");
    await tap("#inventoryBtn");
    assert.equal(await page.locator(".portraitAction").count(), 1);
    assert.equal(await page.locator("canvas.characterPortrait").count(), 1);
    await page.setViewportSize({ width: 360, height: 740 });
    await tap(".avatarPanel .portraitAction");
    await page.screenshot({ path: out + "/inventory-portrait.png" });
    await tap("#resumeBtn");
    await page.setViewportSize({ width: 900, height: 412 });
    const npc = await page.evaluate(() => {
      const f = FERAL,
        n = f.frontierUI.npcs[0];
      f.player.flying = true;
      f.player.x = 77;
      f.player.z = 87;
      f.frontier.time = 2;
      n.lastTime = null;
      f.frontierUI.updateTargets();
      f.frontier.time = 2.1;
      f.frontierUI.updateTargets();
      const before = {
        phase: n.phase,
        rotation: n.rig.bones.legL.rotation.x,
        action: n.rig.state.action,
      };
      f.frontierUI.updateTargets();
      return {
        before,
        after: {
          phase: n.phase,
          rotation: n.rig.bones.legL.rotation.x,
          action: n.rig.state.action,
        },
      };
    });
    assert.equal(npc.before.action, "walk");
    assert.deepEqual(npc.after, npc.before);
    // All three real NPC meshes remain aimable and stop/face the nearby player.
    const roles = [];
    for (let i = 0; i < 3; i++) {
      await page.evaluate((i) => {
        const f = FERAL,
          n = f.frontierUI.npcs[i],
          p = n.group.position;
        f.ecology.entities = [];
        f.ecology.rehash();
        f.setCamera(p.x, p.y + 1.7, p.z + 2.5, 0, Math.atan2(-0.8, 2.5));
      }, i);
      await page.waitForTimeout(250);
      const hit = await page.evaluate(() => FERAL.frontierUI.objectTarget());
      assert.equal(hit?.kind, "npc");
      assert.equal(hit?.role, i);
      roles.push(hit.role);
      await tap("#interactBtn");
      assert.ok(await page.locator("#frontierPanel").isVisible());
      await tap("#frontierClose");
    }
    await page.evaluate(() => {
      FERAL.inventory.slots[8] = null;
      FERAL.selectHotbar(8);
    });
    await tap("#inventoryBtn");
    assert.equal(await page.evaluate(() => portraitTest.rig.held), null);
    await tap("#resumeBtn");
    await page.evaluate(() => {
      FERAL.inventory.unlocks.add("armor");
      FERAL.selectHotbar(0);
    });
    await tap("#inventoryBtn");
    assert.equal(
      await page.evaluate(() =>
        portraitTest.rig.model.bones
          .find((b) => b.id === "torso")
          .boxes.some((b) => b.texture === "plate"),
      ),
      true,
    );
    await tap("#resumeBtn");
    assert.equal(await page.evaluate(() => FERAL.view.characterArmored), true);
    await page.screenshot({ path: out + "/first-person-mobile.png" });
    // Controlled closeups use production geometry/materials, never mockup art.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(async () => {
      FERAL.pause(true);
      const T = await import("./vendor/three.module.js"),
        { CharacterRig } = await import("./character-view.js");
      const overlay = document.createElement("div");
      overlay.style =
        "position:fixed;inset:0;z-index:999999;background:#20363c";
      document.body.append(overlay);
      const canvas = document.createElement("canvas");
      overlay.append(canvas);
      const renderer = new T.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(innerWidth, innerHeight);
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      const scene = new T.Scene();
      scene.background = new T.Color(0x20363c);
      scene.add(new T.HemisphereLight(0xe0f3ed, 0x777264, 2));
      const sun = new T.DirectionalLight(0xffe6c4, 3);
      sun.position.set(-3, 4, 6);
      scene.add(sun);
      const camera = new T.PerspectiveCamera(
        34,
        innerWidth / innerHeight,
        0.05,
        100,
      );
      camera.position.set(0, 1.75, 6.6);
      camera.lookAt(0, 0.85, 0);
      const floor = new T.Mesh(
        new T.PlaneGeometry(30, 30),
        new T.MeshStandardMaterial({ color: 0x263f44, roughness: 1 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.01;
      scene.add(floor);
      const labels = document.createElement("div");
      labels.style =
        "position:absolute;left:12%;right:12%;bottom:13%;display:flex;justify-content:space-around;color:#efdfbc;font:18px sans-serif";
      overlay.append(labels);
      const roles = ["explorer", "quartermaster", "herbalist", "mechanic"];
      const rigs = roles.map((role, i) => {
        const rig = new CharacterRig(role, i);
        rig.root.position.x = (i - 1.5) * 1.1;
        rig.root.rotation.y = 0.3;
        rig.animate({ time: 1.1, action: "idle", seed: i });
        if (i === 0) rig.equip("pick");
        scene.add(rig.root);
        return rig;
      });
      labels.innerHTML = ["개척자", "보급 담당", "약초사", "정비사"]
        .map((t) => "<span>" + t + "</span>")
        .join("");
      renderer.render(scene, camera);
      window.artGallery = {
        T,
        CharacterRig,
        renderer,
        scene,
        camera,
        labels,
        rigs,
      };
    });
    await page.screenshot({ path: out + "/characters.png" });
    const stats = await page.evaluate(() => {
      const g = artGallery;
      g.rigs.forEach((r) => {
        r.root.visible = false;
      });
      g.poseRigs = ["run", "crouch", "crawl", "wave"].map((action, i) => {
        const r = new g.CharacterRig("explorer");
        r.root.position.x = (i - 1.5) * 1.1;
        r.root.rotation.y = action === "crawl" ? -0.7 : 0.3;
        r.animate({ time: 1.1, phase: 1.3, action });
        g.scene.add(r.root);
        return r;
      });
      g.labels.innerHTML = ["달리기", "웅크리기", "기어가기", "인사"]
        .map((t) => "<span>" + t + "</span>")
        .join("");
      g.renderer.render(g.scene, g.camera);
      return {
        drawCalls: g.renderer.info.render.calls,
        triangles: g.renderer.info.render.triangles,
      };
    });
    await page.screenshot({ path: out + "/poses.png" });
    const animals = await page.evaluate(async () => {
      const g = artGallery;
      g.poseRigs.forEach((r) => (r.root.visible = false));
      const v = FERAL.view;
      v.camera.position.copy(g.camera.position);
      v.camera.quaternion.copy(g.camera.quaternion);
      const entities = [0, 1, 2].map((type, i) => ({
        id: i,
        type,
        x: (i - 1) * 1.6,
        y: 0,
        z: 0,
        yaw: Math.PI - 0.4,
        phase: 0,
        speed: 0,
        moving: 0,
        lost: 0,
        damage: {},
        dead: false,
      }));
      v.entities({ entities, debris: [] }, 0);
      g.scene.add(v.nearMesh, v.farMesh);
      g.labels.innerHTML = ["이끼사슴", "구리여우", "청금딱정"]
        .map((t) => "<span>" + t + "</span>")
        .join("");
      g.renderer.render(g.scene, g.camera);
      return { near: v.nearCount, details: v.farCount };
    });
    await page.screenshot({ path: out + "/animals.png" });
    assert.deepEqual(errors, []);
    const report = {
      touchRotationAndCancel: true,
      poses: actions,
      portraitContextReused: true,
      portraitViewport: [360, 740],
      armorAndHands: true,
      emptyHandPreview: true,
      npcRoles: roles,
      repeatTargetPassPreservesWalk: true,
      closeupRender: stats,
      animalInstances: animals,
      errors,
    };
    fs.writeFileSync(
      out + "/character-art.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(report);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
