import * as T from "./vendor/three.module.js";
import { CharacterRig } from "./character-view.js";
import { PORTRAIT_ACTIONS, ACTION_NAMES } from "./character-model.js";
let portrait;
class Portrait {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "characterPortrait";
    this.canvas.setAttribute("aria-label", "개척자 3D 모습 · 좌우로 끌어 회전");
    this.canvas.setAttribute("role", "img");
    this.renderer = new T.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.scene = new T.Scene();
    this.scene.add(new T.HemisphereLight(0xe5f3ef, 0x76726a, 2));
    const sun = new T.DirectionalLight(0xffe3b5, 3);
    sun.position.set(-3, 5, 4);
    this.scene.add(sun);
    this.camera = new T.PerspectiveCamera(32, 1, 0.05, 20);
    this.yaw = 0.4;
    this.action = "idle";
    this.last = 0;
    this.phase = 0;
    this.canvas.onpointerdown = (e) => {
      e.stopPropagation();
      this.pointer = {
        id: e.pointerId,
        x: e.clientX,
        startX: e.clientX,
        startY: e.clientY,
        dragging: false,
      };
      this.canvas.setPointerCapture(e.pointerId);
    };
    this.canvas.onpointermove = (e) => {
      if (this.pointer?.id !== e.pointerId) return;
      if (!this.pointer.dragging) {
        const dx = e.clientX - this.pointer.startX,
          dy = e.clientY - this.pointer.startY;
        if (Math.abs(dx) < 6 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
        this.pointer.dragging = true;
      }
      this.yaw += (e.clientX - this.pointer.x) * 0.018;
      this.pointer.x = e.clientX;
      e.stopPropagation();
    };
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
      this.canvas.addEventListener(name, (e) => {
        if (e.pointerId === this.pointer?.id) this.pointer = null;
      });
    this.canvas.ondblclick = () => (this.yaw = 0.4);
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }
  mount(host, { armored = false, held = null, stance = "stand" } = {}) {
    if (!this.rig || this.armored !== armored) {
      this.rig?.dispose();
      this.rig = new CharacterRig("explorer", 0, armored);
      this.armored = armored;
      this.scene.add(this.rig.root);
    }
    this.rig.equip(held);
    if (this.host !== host) {
      this.control?.remove();
      this.host = host;
      host.prepend(this.canvas);
      this.action = stance === "stand" ? "idle" : stance;
      const control = document.createElement("button");
      control.type = "button";
      control.className = "portraitAction";
      control.title = "캐릭터 자세 미리보기";
      control.setAttribute("aria-label", "캐릭터 자세 미리보기 변경");
      control.onclick = () => {
        this.action =
          PORTRAIT_ACTIONS[
            (PORTRAIT_ACTIONS.indexOf(this.action) + 1) %
              PORTRAIT_ACTIONS.length
          ];
        control.textContent = ACTION_NAMES[this.action] + " ↻";
      };
      control.textContent = ACTION_NAMES[this.action] + " ↻";
      host.append(control);
      this.control = control;
    }
    this.render(performance.now() / 1000);
  }
  frame(now) {
    requestAnimationFrame(this.frame);
    if (
      !this.host?.isConnected ||
      this.host.closest(".hidden,[hidden]") ||
      !this.host.getClientRects().length
    )
      return;
    if (now - this.last < 80) return;
    this.last = now;
    this.render(now / 1000);
  }
  render(time) {
    const r = this.host.getBoundingClientRect(),
      width = Math.max(1, Math.round(r.width)),
      height = Math.max(1, Math.round(r.height - 20));
    if (this.width !== width || this.height !== height) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.width = width;
      this.height = height;
    }
    const crawl = this.action === "crawl";
    this.camera.position.set(0, crawl ? 0.8 : 1.05, crawl ? 3.5 : 3.3);
    this.camera.lookAt(0, crawl ? 0.6 : 0.85, 0);
    this.rig.root.rotation.y = this.yaw;
    this.rig.animate({
      time,
      phase: time * (this.action === "run" ? 8 : 4.6),
      action: this.action,
    });
    this.renderer.render(this.scene, this.camera);
  }
}
export function mountCharacterPortrait(host, options) {
  if (!host) return;
  portrait ||= new Portrait();
  portrait.mount(host, options);
  return portrait;
}
