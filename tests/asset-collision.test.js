import test from 'node:test';
import assert from 'node:assert/strict';
import R from '../app/src/main/assets/vendor/rapier/rapier.js';
import { AssetCollisionWorld } from '../tools/asset-pipeline/physics.mjs';

await R.init();
const cube = [{ center: [0, 0, 0], size: [1, 1, 1] }];
const make = (gravity = { x: 0, y: 0, z: 0 }) => {
  const world = new R.World(gravity);
  const adapter = new AssetCollisionWorld(R, world);
  return { world, adapter, dispose() { adapter.dispose(); world.free(); } };
};
const tick = (a, steps = 180) => { for (let i = 0; i < steps; i++) a.step(1 / 120); };
const mover = (a, ownerId, x, velocity, partId = 'body') => {
  const e = a.addBody({ ownerId, partId, boxes: cube, type: 'dynamic', position: [x, 0, 0], mass: 2, friction: 0 });
  e.body.lockRotations(true, true);
  e.body.setLinvel({ x: velocity, y: 0, z: 0 }, true);
  return e;
};

test('actual Rapier: distinct owners collide and exchange impulses', () => {
  const s = make();
  try {
    const left = mover(s.adapter, 'left', -2, 3);
    const right = mover(s.adapter, 'right', 2, -3);
    tick(s.adapter);
    assert(left.body.translation().x < right.body.translation().x, 'independent entities must not pass through');
    assert(Math.abs(right.body.translation().x - left.body.translation().x) > .95);
    assert(Math.abs(left.body.linvel().x) < .1, 'contact solver must stop the incoming motion');
    assert(Math.abs(right.body.linvel().x) < .1);
    assert.equal(left.body.isCcdEnabled(), true);
  } finally { s.dispose(); }
});

test('actual Rapier: articulated child bodies of one owner pass through each other', () => {
  const s = make();
  try {
    const left = mover(s.adapter, 'one-machine', -2, 3, 'left-wing');
    const right = mover(s.adapter, 'one-machine', 2, -3, 'right-wing');
    tick(s.adapter);
    assert(left.body.translation().x > 2, 'same-owner articulated body should cross the other body');
    assert(right.body.translation().x < -2);
    assert(Math.abs(left.body.linvel().x - 3) < .001);
    assert(Math.abs(right.body.linvel().x + 3) < .001);
    assert.equal(s.adapter.collisionEnabledBetween(left.colliders[0], right.colliders[0]), false);
  } finally { s.dispose(); }
});

test('actual Rapier: same-owner colliders on one rigid body do not self-resolve', () => {
  const s = make();
  try {
    const e = s.adapter.addBody({ ownerId: 'overlapping-voxels', boxes: [
      { center: [-.1, 0, 0], size: [1, 1, 1] },
      { center: [.1, 0, 0], size: [1, 1, 1] },
    ], mass: 7 });
    e.body.setLinvel({ x: 1, y: 0, z: 0 }, true);
    tick(s.adapter, 120);
    assert(Math.abs(e.body.translation().x - 1) < .001);
    assert(Math.abs(e.body.linvel().x - 1) < .001);
    assert(Math.abs(e.body.mass() - 7) < .001, 'total body mass is distributed, not repeated for each voxel');
    assert.equal(s.adapter.collisionEnabledBetween(...e.colliders), false);
  } finally { s.dispose(); }
});

test('actual Rapier: registered terrain and external terrain support dynamic assets', () => {
  for (const registered of [true, false]) {
    const s = make({ x: 0, y: -9.81, z: 0 });
    try {
      if (registered) s.adapter.addBody({ ownerId: 'terrain', type: 'fixed', boxes: [{ center: [0, -.5, 0], size: [20, 1, 20] }] });
      else s.world.createCollider(R.ColliderDesc.cuboid(10, .5, 10).setTranslation(0, -.5, 0));
      const e = s.adapter.addBody({ ownerId: 'falling-entity', boxes: cube, position: [0, 4, 0], mass: 3 });
      tick(s.adapter, 600);
      assert(Math.abs(e.body.translation().y - .5) < .025, `terrain contact must support the body (${registered})`);
      assert(Math.abs(e.body.linvel().y) < .05);
    } finally { s.dispose(); }
  }
});

test('actual Rapier: local cuboid holes remain empty instead of using a combined AABB', () => {
  const s = make({ x: 0, y: -9.81, z: 0 });
  try {
    s.adapter.addBody({ ownerId: 'two-pillars', type: 'fixed', boxes: [
      { center: [-2, 1, 0], size: [1, 2, 1] },
      { center: [2, 1, 0], size: [1, 2, 1] },
    ] });
    const falling = s.adapter.addBody({ ownerId: 'probe', boxes: [{ center: [0, 0, 0], size: [.5, .5, .5] }], position: [0, 4, 0] });
    tick(s.adapter, 180);
    assert(falling.body.translation().y < -3, 'the gap between authored cuboids must be physically empty');
  } finally { s.dispose(); }
});

test('actual Rapier: more than sixteen independent owners have no collision-mask aliases', () => {
  const s = make();
  try {
    // Register every left owner first. Corresponding right owners then have
    // indices 32 apart, which catches both 16- and 32-bit wrapping aliases.
    const leftBodies = Array.from({ length: 32 }, (_, lane) => {
      const entry = mover(s.adapter, `owner-${lane}`, -2, 3);
      entry.body.setTranslation({ x: -2, y: lane * 3, z: 0 }, true);
      return entry;
    });
    const pairs = leftBodies.map((left, lane) => {
      const right = mover(s.adapter, `owner-${lane + 32}`, 2, -3);
      right.body.setTranslation({ x: 2, y: lane * 3, z: 0 }, true);
      return [left, right];
    });
    tick(s.adapter);
    for (const [left, right] of pairs) {
      assert(left.body.translation().x < right.body.translation().x);
      assert(Math.abs(left.body.linvel().x) < .1);
      assert(Math.abs(right.body.linvel().x) < .1);
    }
    assert.equal(s.adapter.entries.length, 64);
  } finally { s.dispose(); }
});

test('actual Rapier: kinematic external bodies push dynamics while same-owner parts are ignored', () => {
  for (const sameOwner of [true, false]) {
    const s = make();
    try {
      const kinematic = s.adapter.addBody({ ownerId: 'platform', type: 'kinematic', boxes: cube, position: [-2, 0, 0] });
      const dynamic = s.adapter.addBody({ ownerId: sameOwner ? 'platform' : 'other', boxes: cube, position: [0, 0, 0] });
      dynamic.body.lockRotations(true, true);
      for (let i = 1; i <= 240; i++) {
        kinematic.body.setNextKinematicTranslation({ x: -2 + i / 60, y: 0, z: 0 });
        s.adapter.step(1 / 120);
      }
      if (sameOwner) assert(Math.abs(dynamic.body.translation().x) < .001);
      else assert(dynamic.body.translation().x > 2.5, 'external kinematics must transfer contact impulse');
    } finally { s.dispose(); }
  }
});

test('ownership cleanup is selective and handle reuse does not inherit removed ownership', () => {
  const s = make();
  try {
    const a = mover(s.adapter, 'discard', -2, 3, 'left');
    mover(s.adapter, 'discard', 2, -3, 'right');
    const keep = s.adapter.addBody({ ownerId: 'keep', type: 'fixed', boxes: cube, position: [20, 0, 0] });
    const oldHandle = a.colliders[0].handle;
    assert.equal(s.adapter.removeOwner('discard'), 2);
    assert.equal(s.adapter.ownershipForCollider(oldHandle), undefined);
    assert.equal(s.adapter.entries.length, 1);
    assert.equal(s.adapter.ownershipForCollider(keep.colliders[0]).ownerId, 'keep');
    const newBody = mover(s.adapter, 'replacement', -2, 3);
    assert.equal(s.adapter.ownershipForCollider(newBody.colliders[0]).ownerId, 'replacement');
    assert.equal(s.adapter.removeOwner('missing'), 0);
    s.adapter.dispose();
    assert.equal(s.adapter.entries.length, 0);
    assert.equal(s.world.bodies.len(), 0);
    assert.throws(() => s.adapter.step(), /disposed/);
    s.adapter.dispose();
  } finally { s.dispose(); }
});

test('invalid mass, shape, pose and friction are rejected without leaving physics bodies', () => {
  const s = make();
  try {
    for (const invalid of [
      { mass: NaN }, { mass: -1 }, { mass: 0 }, { friction: Infinity }, { friction: -1 },
      { position: [NaN, 0, 0] }, { rotation: [0, 0, 0, 0] }, { type: 'sensor' },
      { boxes: [] }, { boxes: [{ center: [0, 0, 0], size: [0, 1, 1] }] },
      { boxes: [{ center: [0, 0, 0], size: [1, 1, 1], friction: NaN }] },
    ]) assert.throws(() => s.adapter.addBody({ ownerId: 'invalid', boxes: cube, ...invalid }), TypeError);
    assert.equal(s.world.bodies.len(), 0);
    assert.equal(s.adapter.entries.length, 0);
  } finally { s.dispose(); }
});
