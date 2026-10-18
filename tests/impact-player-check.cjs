const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
(async () => {
  const b = await chromium.launch({
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
    const p = await b.newPage({ viewport: { width: 900, height: 412 } }),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.addInitScript(() => (window.AndroidApp = {}));
    await p.goto(
      (process.env.FERAL_BASE_URL || "http://127.0.0.1:8080") +
        "/play.html?world=frontier",
    );
    await p.waitForFunction(
      () => window.FERAL?.ready && FERAL.stats().running,
      null,
      { timeout: 60000 },
    );
    const result = await p.evaluate(() => {
      const f = FERAL;
      f.ecology.entities = [];
      f.ecology.rehash();
      const w = f.world,
        x = 75,
        z = 83;
      for (let xx = x - 1; xx <= x + 1; xx++)
        for (let zz = z - 1; zz <= z + 1; zz++) {
          for (let y = 12; y < 40; y++) w.set(xx, y, zz, 0);
          w.set(xx, 11, zz, 1);
        }
      f.frontier.hp = 100;
      f.player.flying = false;
      f.setCamera(x + 0.5, 13.36, z + 0.5, 0, 0);
      for (let i = 0; i < 5; i++) f.fixedStep({});
      const start = f.frontier.hp;
      f.fixedStep({ jump: true });
      for (let i = 0; i < 110; i++) f.fixedStep({});
      const jump = f.frontier.hp;
      f.setCamera(x + 0.5, 21.36, z + 0.5, 0, 0);
      for (let i = 0; i < 150; i++) f.fixedStep({});
      return {
        start,
        jump,
        fall: f.frontier.hp,
        y: f.player.y,
        grounded: f.player.grounded,
      };
    });
    assert.equal(result.start, result.jump);
    assert.ok(result.fall < result.jump - 20);
    assert.ok(result.grounded);
    assert.deepEqual(errors, []);
    fs.mkdirSync("verification/0.10.0", { recursive: true });
    fs.writeFileSync(
      "verification/0.10.0/player-impact.json",
      JSON.stringify({ result, errors }, null, 2),
    );
    console.log(result);
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
