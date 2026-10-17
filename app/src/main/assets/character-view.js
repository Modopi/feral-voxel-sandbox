import * as T from "./vendor/three.module.js";
import { characterModel, characterPose, PIXEL } from "./character-model.js";
const textures = [
  "plain",
  "cloth",
  "seam",
  "leather",
  "pocket",
  "skin",
  "hair",
  "metal",
  "plate",
  "glass",
  "leaf",
  "patch",
  "boot",
];
const cache = new Map();
let material;
function atlas() {
  const size = 128,
    data = new Uint8Array(size * size * 4);
  for (let index = 0; index < 16; index++)
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const kind = textures[index],
          xx = x % 16,
          yy = y % 16;
        let v = 255;
        if (kind === "cloth")
          v =
            (xx === 2 && yy % 7 < 3) || (yy === 10 && xx > 8 && xx < 13)
              ? 224
              : (xx + yy) % 13 === 0
                ? 247
                : 239;
        if (kind === "seam")
          v = yy % 6 === 1 ? (xx % 3 === 0 ? 251 : 196) : 237;
        if (kind === "leather")
          v = xx === 1 || yy === 1 ? 180 : (xx + yy) % 11 < 2 ? 220 : 243;
        if (kind === "pocket")
          v =
            ((xx === 2 || xx === 12) && yy < 12) ||
            (yy === 3 && xx > 2 && xx < 12)
              ? 173
              : yy === 11 && xx > 2 && xx < 12
                ? 251
                : 230;
        if (kind === "skin")
          v = yy < 2 ? 235 : (xx === 2 || xx === 10) && yy === 5 ? 247 : 255;
        if (kind === "hair") v = xx % 4 === 0 ? 195 : xx % 4 === 1 ? 233 : 215;
        if (kind === "metal" || kind === "plate")
          v = xx < 2 || yy < 2 ? 174 : xx === 3 || yy === 12 ? 255 : 228;
        if (kind === "glass") v = xx === yy || xx === yy + 1 ? 255 : 210;
        if (kind === "leaf") v = xx === 7 ? 247 : xx < 7 ? 222 : 197;
        if (kind === "patch") v = xx % 4 === 0 || yy % 4 === 0 ? 187 : 239;
        if (kind === "boot")
          v =
            yy < 2
              ? 155
              : (yy === 4 || yy === 6) && xx > 1 && xx < 5
                ? 246
                : 217;
        const at =
          ((Math.floor(index / 4) * 32 + y) * size + (index % 4) * 32 + x) * 4;
        data.set([v, v, v, 255], at);
      }
  const texture = new T.DataTexture(data, size, size);
  texture.colorSpace = T.SRGBColorSpace;
  texture.magFilter = T.NearestFilter;
  texture.minFilter = T.NearestMipmapNearestFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  texture.name = "FERAL original 32px-per-metre character surfaces";
  return texture;
}
export function characterMaterial() {
  if (!material)
    material = new T.MeshStandardMaterial({
      map: atlas(),
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.03,
    });
  return material;
}
export function boxesGeometry(boxes) {
  const positions = [],
    normals = [],
    colors = [],
    uvs = [];
  for (const b of boxes) {
    const indexed = new T.BoxGeometry(...b.size),
      cube = indexed.toNonIndexed();
    indexed.dispose();
    cube.translate(...b.at);
    const pos = cube.getAttribute("position"),
      nor = cube.getAttribute("normal"),
      uv = cube.getAttribute("uv"),
      color = new T.Color(b.color);
    const tile = Math.max(0, textures.indexOf(b.texture)),
      ox = (tile % 4) * 32,
      oy = Math.floor(tile / 4) * 32;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      colors.push(color.r, color.g, color.b);
      const axis =
        Math.abs(nor.getX(i)) > 0.5 ? 0 : Math.abs(nor.getY(i)) > 0.5 ? 1 : 2;
      const width = Math.min(28, b.size[axis === 0 ? 2 : 0] / PIXEL),
        height = Math.min(28, b.size[axis === 1 ? 2 : 1] / PIXEL);
      uvs.push(
        (ox + 1 + uv.getX(i) * width) / 128,
        (oy + 1 + uv.getY(i) * height) / 128,
      );
    }
    cube.dispose();
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}
export class CharacterRig {
  constructor(role = "explorer", variant = 0, armored = false) {
    const key = `${role}/${variant % 3}/${armored}`;
    if (!cache.has(key)) {
      const model = characterModel(role, variant, armored);
      cache.set(key, {
        model,
        geometries: new Map(
          model.bones
            .filter((b) => b.boxes.length)
            .map((b) => [b.id, boxesGeometry(b.boxes)]),
        ),
      });
    }
    const asset = cache.get(key);
    this.model = asset.model;
    this.root = new T.Group();
    this.bones = {};
    this.meshes = [];
    for (const b of asset.model.bones) {
      const group = new T.Group();
      group.name = b.id;
      group.position.fromArray(b.pivot);
      group.userData.rest = [...b.pivot];
      this.bones[b.id] = group;
      (b.parent ? this.bones[b.parent] : this.root).add(group);
      if (b.boxes.length) {
        const mesh = new T.Mesh(
          asset.geometries.get(b.id),
          characterMaterial(),
        );
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
        this.meshes.push(mesh);
      }
    }
  }
  animate(state) {
    const pose = characterPose(state);
    for (const [id, bone] of Object.entries(this.bones)) {
      const p = pose[id];
      bone.rotation.set(...(p?.rotation || [0, 0, 0]));
      bone.scale.set(...(p?.scale || [1, 1, 1]));
      bone.position.fromArray(bone.userData.rest);
      if (p?.y) bone.position.y += p.y;
    }
    this.state = { ...state };
  }
  detail(distance) {
    // Small facial features and rear props do not add draw calls at distant village views.
    for (const id of [
      "eyeL",
      "eyeR",
      "browL",
      "browR",
      "mouth",
      "braid",
      "prop",
    ])
      if (this.bones[id]) this.bones[id].visible = distance < 25;
  }
  equip(id) {
    if (this.heldId === id) return;
    this.heldId = id;
    if (this.held) {
      this.bones.handR.remove(this.held);
      this.held.geometry.dispose();
      this.held = null;
    }
    if (!id) return;
    const boxes = [],
      add = (at, size, color, texture = "metal") =>
        boxes.push({
          at: at.map((v) => v * PIXEL),
          size: size.map((v) => v * PIXEL),
          color,
          texture,
        });
    if (/pick|axe|sword|club|wrench/.test(id)) {
      add([0, 2, 3], [2, 12, 2], 0x876343, "leather");
      if (/sword/.test(id)) {
        add([0, 12, 3], [3, 12, 1], 0xc1d7d4);
        add([0, 6, 3], [7, 1, 2], 0xd0a967);
      } else {
        add([0, 9, 3], [10, 3, 3], 0xa4b7b5);
        add([-5, 7, 3], [2, 4, 3], 0x809a9c);
      }
    } else if (id === "pulse") {
      add([0, 0, 6], [5, 4, 10], 0x536e70);
      add([0, 2.5, 7], [4, 1, 6], 0xd5b779);
      add([0, 0, 12], [3, 3, 2], 0x99d5c4);
    } else if (/bow/.test(id)) {
      add([0, 3, 4], [2, 15, 2], 0xa17b50, "leather");
      for (const y of [-4, 10]) add([0, y, 6], [2, 2, 5], 0xb69462, "leather");
      add([0, 3, 8], [0.5, 14, 0.5], 0xd9d5bd, "plain");
    } else add([0, -1, 4], [5, 5, 5], 0xbda174, "cloth");
    this.held = new T.Mesh(boxesGeometry(boxes), characterMaterial());
    this.bones.handR.add(this.held);
  }
  dispose() {
    if (this.held) this.held.geometry.dispose();
    this.root.removeFromParent();
  }
}
export function firstPersonHands(armored = false) {
  const model = characterModel("explorer", 0, armored),
    root = new T.Group();
  for (const side of ["R", "L"]) {
    const fore = model.bones.find((b) => b.id === "forearm" + side),
      hand = model.bones.find((b) => b.id === "hand" + side);
    const boxes = [
      ...fore.boxes,
      ...hand.boxes.map((b) => ({
        ...b,
        at: b.at.map((v, i) => v + hand.pivot[i]),
      })),
    ];
    // Sleeve shares the character's cuff and leather palette.
    boxes.push({
      at: [0, 0.06, 0],
      size: [0.17, 0.12, 0.19],
      color: armored ? 0x9cafaf : model.palette.coat,
      texture: armored ? "plate" : "cloth",
    });
    const mesh = new T.Mesh(boxesGeometry(boxes), characterMaterial());
    mesh.name = "hand" + side;
    mesh.position.set(side === "R" ? 0.395 : -0.29, -0.23, -0.334);
    mesh.rotation.set(
      1.12,
      side === "R" ? -0.15 : 0.15,
      side === "R" ? -0.12 : 0.12,
    );
    mesh.scale.setScalar(0.72);
    root.add(mesh);
  }
  return root;
}
