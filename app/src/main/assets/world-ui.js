import * as T from "./vendor/three.module.js";

// Unity-style world-space canvases: fixed metre-sized meshes, rendered by the scene camera.
// Two reusable textures bound cost regardless of the number of animals or blocks in the world.
export class WorldUI {
  constructor(scene, camera) {
    this.camera = camera;
    this.labels = new Map();
    this.root = new T.Group();
    this.root.name = "world-space-ui";
    // Perspective stays world-space; this transparent group draws after world geometry.
    this.root.renderOrder = 1000;
    scene.add(this.root);
    this.right = new T.Vector3();
    this.up = new T.Vector3();
    this.delta = new T.Vector3();
    this.anchor = new T.Vector3();
    this.projected = new T.Vector3();
    for (const id of ["focus", "context"]) {
      const canvas = document.createElement("canvas");
      canvas.width = 512; canvas.height = 192;
      const texture = new T.CanvasTexture(canvas);
      texture.colorSpace = T.SRGBColorSpace;
      texture.minFilter = T.LinearFilter;
      texture.magFilter = T.LinearFilter;
      texture.generateMipmaps = false;
      const material = new T.MeshBasicMaterial({
        map: texture, transparent: true, depthTest: false, depthWrite: false,
        side: T.DoubleSide, toneMapped: false, fog: false,
      });
      const mesh = new T.Mesh(new T.PlaneGeometry(2.4, 0.9), material);
      mesh.name = `world-ui-${id}`;
      mesh.renderOrder = 1;
      mesh.visible = false;
      this.root.add(mesh);
      const line = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]),
        new T.LineBasicMaterial({ color: 0xc3e2c9, transparent: true, opacity: 0.65, depthTest: false, depthWrite: false, fog: false }));
      line.visible = false;
      this.root.add(line);
      this.labels.set(id, { mesh, line, canvas, texture, signature: "", data: null });
    }
  }
  set(id, data) {
    const label = this.labels.get(id);
    if (!label) return;
    label.data = data;
    if (!data) { label.mesh.visible = label.line.visible = false; return; }
    const signature = JSON.stringify([data.title, data.detail, data.hint, data.value, data.max, data.color]);
    if (signature === label.signature) return;
    label.signature = signature;
    const c = label.canvas.getContext("2d"), accent = data.color || "#b4ddbe";
    c.clearRect(0, 0, 512, 192);
    c.fillStyle = "rgba(12, 27, 24, .83)";
    c.fillRect(8, 8, 496, 176);
    c.fillStyle = accent;
    c.fillRect(8, 8, 4, 176); c.fillRect(8, 8, 42, 3); c.fillRect(462, 181, 42, 3);
    c.font = 'bold 36px Arial, "Noto Sans", sans-serif';
    c.fillStyle = "#f0f4df";
    c.fillText(data.title, 29, 49, 453);
    c.font = '28px Arial, "Noto Sans", sans-serif';
    c.fillStyle = accent;
    c.fillText(data.detail || "", 29, 89, 453);
    if (data.max > 0) {
      c.fillStyle = "#344840"; c.fillRect(29, 106, 453, 12);
      c.fillStyle = accent;
      c.fillRect(29, 106, 453 * Math.max(0, Math.min(1, data.value / data.max)), 12);
    }
    c.font = '25px Arial, "Noto Sans", sans-serif';
    c.fillStyle = "#c9d3bd";
    c.fillText(data.hint || "", 29, data.max > 0 ? 158 : 144, 453);
    label.texture.needsUpdate = true;
  }
  update() {
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    for (const label of this.labels.values()) {
      const { data, mesh, line } = label;
      const position = data?.follow?.() || (data?.follow ? null : data?.position);
      if (!position) { mesh.visible = line.visible = false; continue; }
      this.anchor.set(position.x, position.y, position.z);
      this.delta.copy(this.anchor).sub(this.camera.position);
      const distance = this.delta.length(), max = data.maxDistance || 9;
      this.projected.copy(this.anchor).project(this.camera);
      if (distance < 0.7 || distance > max || this.projected.z < -1 || this.projected.z > 1 ||
          Math.abs(this.projected.x) > 1.2 || Math.abs(this.projected.y) > 1.2) {
        mesh.visible = line.visible = false; continue;
      }
      const side = data.side || (this.projected.x > 0.3 ? -1 : 1);
      mesh.position.copy(this.anchor).addScaledVector(this.right, side * 1.3).addScaledVector(this.up, 0.57);
      mesh.quaternion.copy(this.camera.quaternion);
      const opacity = Math.min(1, (max - distance) / 1.5);
      mesh.material.opacity = opacity;
      mesh.visible = line.visible = true;
      line.material.opacity = opacity * 0.6;
      const points = line.geometry.attributes.position;
      points.setXYZ(0, this.anchor.x, this.anchor.y, this.anchor.z);
      this.delta.copy(mesh.position).addScaledVector(this.up, -0.45).addScaledVector(this.right, -side * 1.05);
      points.setXYZ(1, this.delta.x, this.delta.y, this.delta.z);
      points.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    }
  }
  clear() { for (const id of this.labels.keys()) this.set(id, null); }
  dispose() {
    for (const { mesh, line, texture } of this.labels.values()) {
      texture.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
      line.geometry.dispose(); line.material.dispose();
    }
    this.root.removeFromParent();
    this.labels.clear();
  }
}
