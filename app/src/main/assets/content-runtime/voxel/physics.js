/**
 * Reusable Rapier cuboid adapter for authored assets, independent of the game.
 * The caller initializes Rapier and owns the supplied World. Each body may be
 * one rigid asset or one articulated part. ownerId identifies the whole entity;
 * partId identifies a child. Owner identity is not encoded into a 16-bit mask.
 */
const vector = (value, label) => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new TypeError(`${label} must contain three finite numbers`);
  }
  return [...value];
};
const scalar = (value, label, { positive = false, maximum = Infinity } = {}) => {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0) || value > maximum) {
    throw new TypeError(`${label} must be a finite ${positive ? 'positive' : 'nonnegative'} number`);
  }
  return value;
};
const quaternion = (value, label) => {
  if (value === undefined) return { x: 0, y: 0, z: 0, w: 1 };
  const q = Array.isArray(value) ? value : [value?.x, value?.y, value?.z, value?.w];
  if (q.length !== 4 || !q.every(Number.isFinite)) throw new TypeError(`${label} must be a finite quaternion`);
  const norm = Math.hypot(...q);
  if (!Number.isFinite(norm) || norm === 0) throw new TypeError(`${label} must have a nonzero finite norm`);
  const [x, y, z, w] = q.map((v) => v / norm);
  return { x, y, z, w };
};
const colliderHandle = (value) => typeof value === 'number' ? value : value?.handle;

export class AssetCollisionWorld {
  constructor(R, world) {
    // Bumped whenever a body is added or removed; step() records the value it saw,
    // so callers can tell whether scene queries need a broad-phase refresh.
    this.revision = 0; this.steppedRevision = 0;
    if (!R?.ColliderDesc || !R?.RigidBodyDesc || !world?.createRigidBody) {
      throw new TypeError('Initialized Rapier module and a caller-owned World are required');
    }
    this.R = R;
    this.world = world;
    this.entries = [];
    this.colliderOwners = new Map();
    this.disposed = false;
    // In the vendored Rapier build hooks are dispatched through stepWithEvents;
    // world.step(undefined, hooks) silently skips them. Always supply a queue.
    this.eventQueue = new R.EventQueue(true);
    this.hooks = {
      filterContactPair: (first, second) => this.collisionEnabledBetween(first, second)
        ? R.SolverFlags.COMPUTE_IMPULSE : null,
      filterIntersectionPair: (first, second) => this.collisionEnabledBetween(first, second),
    };
  }

  assertAlive() {
    if (this.disposed) throw new Error('AssetCollisionWorld has been disposed');
  }

  /** Returns immutable ownership metadata, or undefined for external terrain. */
  ownershipForCollider(handleOrCollider) {
    return this.colliderOwners.get(colliderHandle(handleOrCollider));
  }

  /** The default for an unregistered external collider is collision enabled. */
  collisionEnabledBetween(first, second) {
    const firstHandle = colliderHandle(first), secondHandle = colliderHandle(second);
    if (firstHandle !== undefined && firstHandle === secondHandle) return false;
    const a = this.colliderOwners.get(firstHandle), b = this.colliderOwners.get(secondHandle);
    if (!a || !b) return true;
    return a.ownerId !== b.ownerId && a.bodyHandle !== b.bodyHandle;
  }

  /**
   * boxes use body-local centers and full dimensions, never a combined AABB.
   * Optional box.rotation is a local quaternion. mass is TOTAL body mass,
   * distributed by cuboid volume; friction may be overridden on each box.
   * Kinematic bodies use setNextKinematicTranslation/Rotation on entry.body.
   * Rapier kinematics follow commanded motion; movement obstruction requires a
   * caller-side shape cast/controller, not a hidden dynamic-body substitution.
   */
  addBody({ ownerId, partId = 'body', boxes, type = 'dynamic', position = [0, 0, 0],
    rotation, mass = type === 'fixed' ? 0 : 1, friction = .7, restitution = 0 } = {}) {
    this.assertAlive();
    if (!((typeof ownerId === 'string' && ownerId.length > 0)
      || (typeof ownerId === 'number' && Number.isFinite(ownerId)))) {
      throw new TypeError('ownerId must be a nonempty string or finite number');
    }
    if (typeof partId !== 'string' || !partId) throw new TypeError('partId must be a nonempty string');
    if (!['fixed', 'dynamic', 'kinematic'].includes(type)) throw new TypeError('Unknown rigid body type');
    if (!Array.isArray(boxes) || boxes.length === 0) throw new TypeError('At least one cuboid is required');
    const bodyPosition = vector(position, 'position');
    const bodyRotation = quaternion(rotation, 'rotation');
    scalar(mass, 'mass', { positive: type === 'dynamic' });
    scalar(friction, 'friction');
    scalar(restitution, 'restitution', { maximum: 1 });
    const normalized = boxes.map((source, index) => {
      const center = vector(source.center, `boxes[${index}].center`);
      const size = vector(source.size, `boxes[${index}].size`);
      size.forEach((v) => scalar(v, `boxes[${index}].size`, { positive: true }));
      const volume = size.reduce((a, b) => a * b, 1);
      scalar(volume, `boxes[${index}].volume`, { positive: true });
      return {
        center, size, volume,
        rotation: quaternion(source.rotation, `boxes[${index}].rotation`),
        friction: scalar(source.friction ?? friction, `boxes[${index}].friction`),
        restitution: scalar(source.restitution ?? restitution, `boxes[${index}].restitution`, { maximum: 1 }),
      };
    });
    const volume = normalized.reduce((sum, b) => sum + b.volume, 0);
    scalar(volume, 'total volume', { positive: true });
    const R = this.R;
    const desc = type === 'fixed' ? R.RigidBodyDesc.fixed()
      : type === 'kinematic' ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic();
    desc.setTranslation(...bodyPosition).setRotation(bodyRotation);
    if (type === 'dynamic') desc.setCcdEnabled(true);
    const body = this.world.createRigidBody(desc);
    const colliders = [];
    const entry = { ownerId, partId, type, body, colliders, mass };
    try {
      for (const shape of normalized) {
        const colliderDesc = R.ColliderDesc.cuboid(...shape.size.map((v) => v / 2))
          .setTranslation(...shape.center)
          .setRotation(shape.rotation)
          .setFriction(shape.friction)
          .setRestitution(shape.restitution)
          .setMass(mass * (shape.volume / volume))
          .setActiveHooks(R.ActiveHooks.FILTER_CONTACT_PAIRS | R.ActiveHooks.FILTER_INTERSECTION_PAIRS)
          .setActiveCollisionTypes((R.ActiveCollisionTypes.ALL & ~R.ActiveCollisionTypes.FIXED_FIXED));
        const collider = this.world.createCollider(colliderDesc, body);
        colliders.push(collider);
        this.colliderOwners.set(collider.handle, Object.freeze({ ownerId, partId, bodyHandle: body.handle }));
      }
      this.entries.push(entry); this.revision++;
      return entry;
    } catch (error) {
      for (const collider of colliders) this.colliderOwners.delete(collider.handle);
      this.world.removeRigidBody(body);
      throw error;
    }
  }

  /** Advance the actual Rapier world with ownership filtering enabled. */
  step(dt = 1 / 60) {
    this.assertAlive();
    scalar(dt, 'dt', { positive: true });
    this.world.timestep = dt;
    this.world.step(this.eventQueue, this.hooks);
    this.steppedRevision = this.revision;
  }

  /** Removes every articulated body belonging to the entity, not other owners. */
  removeOwner(ownerId) {
    this.assertAlive();
    let removed = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry.ownerId !== ownerId) continue;
      for (const collider of entry.colliders) this.colliderOwners.delete(collider.handle);
      if (this.world.getRigidBody(entry.body.handle)) this.world.removeRigidBody(entry.body);
      this.entries.splice(i, 1);
      removed++; this.revision++;
    }
    return removed;
  }

  /** Releases adapter-owned bodies and queue; caller still owns world.free(). */
  dispose() {
    if (this.disposed) return;
    for (const owner of new Set(this.entries.map((entry) => entry.ownerId))) this.removeOwner(owner);
    this.eventQueue.free();
    this.colliderOwners.clear();
    this.disposed = true;
  }
}
