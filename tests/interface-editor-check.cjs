const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.FERAL_CHROME || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  try {
    const context = await browser.newContext({ viewport: { width: 900, height: 412 }, hasTouch: true, isMobile: true });
    await context.addInitScript(() => window.AndroidApp = {});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const base = process.env.FERAL_BASE_URL || 'http://127.0.0.1:8080';
    const ready = () => page.waitForFunction(() => window.FERAL?.ready && FERAL.stats().running);
    const rect = id => page.locator('#' + id).boundingBox();
    const screenshot = name => page.screenshot({ path: `verification/interface-0.5.3-${name}.png` });
    const slider = (id, value) => page.locator('#' + id).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
    const open = async () => { await page.click('#menuBtn'); await page.click('#editHudShortcut'); };
    const resume = () => page.click('#resumeBtn');
    const drag = async (id, dx, dy, cancel = false) => {
      const box = await page.locator(`[data-hud-id="${id}"]`).boundingBox();
      const cdp = await context.newCDPSession(page);
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
      await cdp.detach();
    };
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => window.FERAL?.ready);
    await screenshot('title');
    await page.goto(base + '/index.html?world=frontier'); await ready();
    assert.deepEqual(await page.evaluate(() => [FERAL.miningSize, FERAL.buildSize]), [.5, .5]);
    const original = await rect('actBtn');
    await page.click('#menuBtn'); await screenshot('menu');
    await page.click('#editHudShortcut');
    assert.equal(await page.evaluate(() => FERAL.stats().paused), true);
    const position = await page.evaluate(() => [FERAL.player.x, FERAL.player.y, FERAL.player.z]);
    await drag('actBtn', -100, -60);
    let moved = await rect('actBtn');
    assert.ok(Math.abs(moved.x - original.x + 100) < 1 && Math.abs(moved.y - original.y + 60) < 1);
    assert.deepEqual(await page.evaluate(() => [FERAL.player.x, FERAL.player.y, FERAL.player.z]), position);
    await slider('hudScale', 120); await slider('hudOpacity', 75);
    moved = await rect('actBtn');
    assert.ok(Math.abs(moved.width - original.width * 1.2) < 1);
    assert.ok(await page.locator('#hudHide').isDisabled());
    assert.equal(await page.locator('#actBtn').evaluate(el => getComputedStyle(el).opacity), '0.75');
    await page.evaluate(() => FeralNative.pause());
    assert.equal(await page.locator('#pauseScreen').isVisible(), false);
    await screenshot('editor-landscape');
    await page.click('#hudSave');
    // A custom visibility style must not leak controls through paused game windows.
    assert.equal(await page.locator('#actBtn').isVisible(), false);
    const saved = await page.evaluate(() => localStorage.getItem('feral.ui.layout.v1'));
    assert.equal(JSON.parse(saved).profiles['landscape-right'].actBtn.opacity, .75);
    await resume();
    assert.deepEqual(await rect('actBtn'), moved);
    await open(); await page.click('#hudInspectorToggle');
    await drag('actBtn', -70, 40, true);
    assert.deepEqual(await rect('actBtn'), moved, 'pointercancel restores draft position');
    await drag('actBtn', -70, 40);
    await page.keyboard.press('Escape');
    await resume(); assert.deepEqual(await rect('actBtn'), moved, 'cancel restores saved layout');
    await page.reload(); await ready();
    assert.deepEqual(await rect('actBtn'), moved, 'saved layout survives reload');
    await open();
    await page.setViewportSize({ width: 360, height: 640 }); await page.waitForTimeout(600);
    assert.equal(await page.locator('#hudScale').inputValue(), '100', 'portrait has separate defaults');
    await page.selectOption('#hudElement', 'jumpBtn'); await slider('hudScale', 115);
    await screenshot('editor-portrait');
    await page.click('#hudSave'); await resume();
    const portrait = await rect('jumpBtn');
    await page.setViewportSize({ width: 900, height: 412 });
    await page.waitForFunction(() => document.getElementById('actBtn').style.transform === 'scale(1.2)');
    assert.deepEqual(await rect('actBtn'), moved);
    await open(); await page.selectOption('#hudElement', 'toolLabel'); await page.check('#hudHide');
    await page.selectOption('#hudTheme', 'sand'); await page.click('#hudSave');
    await screenshot('sand-menu'); await resume();
    assert.equal(await page.locator('#toolLabel').isVisible(), false);
    // Optional notifications retain their natural fade after customization.
    await open(); await page.selectOption('#hudElement', 'toast'); await slider('hudOpacity', 80);
    await page.click('#hudSave'); await resume();
    await page.evaluate(() => document.getElementById('toast').classList.remove('show'));
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#toast').evaluate(el => getComputedStyle(el).opacity), '0');
    await open(); await page.selectOption('#hudElement', 'actBtn');
    const durable = await page.evaluate(() => localStorage.getItem('feral.ui.layout.v1'));
    await slider('hudScale', 140);
    await page.evaluate(() => {
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v) { if (k === 'feral.ui.layout.v1') throw Error('quota'); return originalSetItem.call(this, k, v); };
    });
    await page.click('#hudSave');
    assert.ok(await page.locator('#hudEditor').isVisible());
    assert.match(await page.locator('#hudEditMessage').textContent(), /저장하지 못/);
    assert.equal(await page.evaluate(() => localStorage.getItem('feral.ui.layout.v1')), durable);
    await page.evaluate(() => { Storage.prototype.setItem = originalSetItem; FeralNative.back(); });
    await resume(); assert.deepEqual(await rect('actBtn'), moved);
    await open();
    const neighborInventory = await rect('inventoryBtn'), neighborMap = await rect('journalBtn');
    await drag('menuBtn', -60, 100); await drag('statusBtn', -80, 110);
    assert.deepEqual(await rect('inventoryBtn'), neighborInventory, 'moving a menu button leaves its neighbor anchored');
    assert.deepEqual(await rect('journalBtn'), neighborMap, 'moving status leaves map anchored');
    await page.click('#hudResetAll'); await page.click('#hudSave'); await resume();
    assert.deepEqual(await rect('actBtn'), original);
    await page.setViewportSize({ width: 360, height: 640 }); await page.waitForTimeout(600);
    assert.deepEqual(await rect('jumpBtn'), portrait, 'reset only affects active profile');
    await page.setViewportSize({ width: 900, height: 412 }); await page.waitForTimeout(100);
    // An explicit whole-block choice survives save; an older unmarked default migrates once.
    await page.evaluate(() => { FERAL.selectTool(2); FERAL.cycleRange(); FERAL.selectHotbar(2); FERAL.cycleRange(); FERAL.save(true); });
    await page.reload(); await ready();
    assert.deepEqual(await page.evaluate(() => [FERAL.miningSize, FERAL.buildSize]), [1, 1]);
    await page.addInitScript(() => {
      if (sessionStorage.getItem('legacyEditGrid')) {
        const k = 'feral.slot.frontier', s = JSON.parse(localStorage.getItem(k));
        delete s.editGridVersion; localStorage.setItem(k, JSON.stringify(s)); sessionStorage.removeItem('legacyEditGrid');
      }
    });
    await page.evaluate(() => sessionStorage.setItem('legacyEditGrid', 'yes'));
    await page.reload(); await ready();
    assert.deepEqual(await page.evaluate(() => [FERAL.miningSize, FERAL.buildSize]), [.5, .5]);
    await page.click('#inventoryBtn'); await screenshot('inventory'); await resume();
    await page.click('#menuBtn'); await page.click('#editHudShortcut'); await page.selectOption('#hudTheme', 'slate'); await page.click('#hudSave'); await resume();
    await page.click('#inventoryBtn'); await screenshot('inventory-slate'); await resume();
    await page.goto(base + '/worlds.html');
    assert.equal(await page.locator('html').getAttribute('data-ui-theme'), 'slate');
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false);
    await screenshot('worlds'); await page.click('#newWorld'); await screenshot('create-world');
    await page.fill('#name', '반 칸 작업장'); await page.click('#create button:not([type=button])');
    assert.equal(await page.locator('#worlds article').count(), 4);
    assert.equal(await page.locator('#createDialog').isVisible(), false);
    assert.deepEqual(errors, []);
    const result = { drag: true, touchCancel: true, isolation: true, scale: true, opacity: true, persistence: true, cancel: true,
      orientation: true, reset: true, quotaRecovery: true, migration: true, explicitGridSave: true, worldCreation: true, errors };
    fs.writeFileSync('verification/interface-results-0.5.3.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
