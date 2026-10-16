import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLayout, readLayout, placement, layoutProfile } from '../app/src/main/assets/hud-layout.js';
import { restoreEditGrid, EDIT_GRID_VERSION } from '../app/src/main/assets/edit-grid.js';

test('new and legacy worlds use half cells; explicit newer choices survive reload', () => {
  assert.deepEqual(restoreEditGrid(null), { miningSize: .5, buildSize: .5 });
  assert.deepEqual(restoreEditGrid({ miningSize: 1, buildSize: 1 }), { miningSize: .5, buildSize: .5 });
  assert.deepEqual(restoreEditGrid({ miningSize: 2, buildSize: 1 }, true), { miningSize: 2, buildSize: .5 });
  const saved = { editGridVersion: EDIT_GRID_VERSION, miningSize: 1, buildSize: 1 };
  assert.deepEqual(restoreEditGrid(saved), { miningSize: 1, buildSize: 1 });
  assert.equal(restoreEditGrid({ ...saved, miningSize: 2 }, false).miningSize, .5);
});

test('damaged HUD preferences cannot hide core controls or inject unknown elements', () => {
  const prefs = cleanLayout({ version: 1, theme: 'bad', profiles: {
    'landscape-right': { actBtn: { x: Infinity, y: -3, scale: 50, opacity: 0, hidden: true }, toast: { hidden: true }, unknown: {} },
    unknown: { stick: {} }
  }});
  assert.equal(prefs.theme, 'slate');
  assert.deepEqual(prefs.profiles['landscape-right'].actBtn, { x: .5, y: 0, scale: 1.5, opacity: .4, hidden: false });
  assert.equal(prefs.profiles['landscape-right'].toast.hidden, true);
  assert.equal(prefs.profiles['landscape-right'].unknown, undefined);
  assert.equal(prefs.profiles.unknown, undefined);
  assert.deepEqual(readLayout({ getItem() { return '{broken'; } }), cleanLayout(null));
  assert.deepEqual(readLayout({ getItem() { throw Error('denied'); } }), cleanLayout(null));
});

test('custom HUD positions fit resized screens and keep touch buttons usable', () => {
  for (const [width, height] of [[900, 412], [360, 640], [640, 360]]) {
    for (const [w, h] of [[68, 68], [450, 58], [34, 34]]) {
      const p = placement({ x: 1, y: 1, scale: 1.5 }, width, height, w, h);
      assert.ok(p.left >= 8 && p.top >= 8);
      assert.ok(p.left + p.width <= width - 7.99 && p.top + p.height <= height - 7.99);
    }
    assert.ok(placement({ scale: .65 }, width, height, 48, 48).width >= 36);
  }
});

test('orientation and handedness select independent layouts', () => {
  assert.equal(layoutProfile(900, 412, false), 'landscape-right');
  assert.equal(layoutProfile(900, 412, true), 'landscape-left');
  assert.equal(layoutProfile(360, 640, false), 'portrait-right');
  assert.equal(layoutProfile(360, 640, true), 'portrait-left');
});
