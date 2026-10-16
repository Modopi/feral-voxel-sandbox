import { LAYOUT_KEY, HUD_ELEMENTS, OPTIONAL_HUD, cleanEntry, cleanLayout, readLayout, layoutProfile, placement, clamp } from "./hud-layout.js";
const $ = id => document.getElementById(id);
const props = ["position", "left", "top", "right", "bottom", "transform", "transform-origin", "opacity", "filter", "visibility", "transition"];

export class HudEditor {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.saved = readLayout(localStorage);
    this.editing = false;
    this.original = new Map();
    this.placeholders = new Map();
    this.selected = "actBtn";
    this.handles = new Map();
    const panel = document.createElement("section");
    panel.id = "hudEditor"; panel.hidden = true;
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-label", "UI 배치 편집");
    panel.innerHTML = `<div id="hudHandles"></div><header class="editorToolbar"><b>UI 편집 <small id="hudProfile"></small></b><button id="hudInspectorToggle" aria-expanded="true">조절</button><button id="hudCancel">취소</button><button id="hudSave" class="accentButton">저장</button></header><aside id="hudInspector"><label>편집할 요소<select id="hudElement"></select></label><p>테두리를 끌어 이동 · 방향키로 미세 조절</p><label>크기 <output id="hudScaleValue"></output><input id="hudScale" type="range" min="65" max="150" step="5"></label><label>불투명도 <output id="hudOpacityValue"></output><input id="hudOpacity" type="range" min="40" max="100" step="5"></label><label class="hideHudOption"><input id="hudHide" type="checkbox">이 정보 숨기기</label><label>게임 창 색상<select id="hudTheme"><option value="slate">흑요석</option><option value="sand">사암</option></select></label><div class="editorReset"><button id="hudResetItem">선택 복원</button><button id="hudResetAll">현재 배치 초기화</button></div><p id="hudEditMessage" role="status"></p></aside>`;
    document.body.append(panel);
    for (const [id, label] of Object.entries(HUD_ELEMENTS)) {
      const element = $(id); if (!element) continue;
      this.original.set(id, props.map(p => [p, element.style.getPropertyValue(p), element.style.getPropertyPriority(p)]));
      const option = document.createElement("option"); option.value = id; option.textContent = label; $("hudElement").append(option);
      const handle = document.createElement("button"); handle.className = "hudHandle"; handle.dataset.hudId = id;
      handle.setAttribute("aria-label", label + " 위치 조절");
      const name = document.createElement("span"); name.textContent = label; handle.append(name);
      $("hudHandles").append(handle); this.handles.set(id, handle);
      handle.onpointerdown = e => this.dragStart(e, id);
      handle.onpointermove = e => this.dragMove(e);
      handle.onpointerup = e => this.dragEnd(e, false);
      handle.onpointercancel = e => this.dragEnd(e, true);
      handle.onlostpointercapture = e => this.dragEnd(e, true);
      handle.onclick = () => this.select(id);
      handle.onfocus = () => this.select(id);
      handle.onkeydown = e => {
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
        e.preventDefault();
        const r = $(id).getBoundingClientRect(), n = e.shiftKey ? 10 : 2;
        this.move(id, r.left + (e.key === "ArrowRight" ? n : e.key === "ArrowLeft" ? -n : 0), r.top + (e.key === "ArrowDown" ? n : e.key === "ArrowUp" ? -n : 0));
      };
    }
    $("hudElement").onchange = () => this.select($("hudElement").value);
    for (const [id, field] of [["hudScale", "scale"], ["hudOpacity", "opacity"]]) $(id).oninput = () => {
      const entry = this.entry(this.selected); entry[field] = +$(id).value / 100; this.profile()[this.selected] = entry; this.apply(); this.controls();
    };
    $("hudHide").onchange = () => { const e = this.entry(this.selected); e.hidden = $("hudHide").checked; this.profile()[this.selected] = e; this.apply(); };
    $("hudTheme").onchange = () => { this.draft.theme = $("hudTheme").value; this.apply(); };
    $("hudResetItem").onclick = () => { delete this.profile()[this.selected]; this.apply(); this.controls(); };
    $("hudResetAll").onclick = () => { this.draft.profiles[this.key()] = {}; this.apply(); this.controls(); };
    $("hudSave").onclick = () => this.save(); $("hudCancel").onclick = () => this.cancel();
    $("hudInspectorToggle").onclick = () => { $("hudInspector").hidden = !$("hudInspector").hidden; $("hudInspectorToggle").setAttribute("aria-expanded", String(!$("hudInspector").hidden)); };
    panel.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); this.cancel(); }
      if (e.key === "Tab") {
        const visible = [...panel.querySelectorAll("button,select,input")].filter(b => !b.disabled && b.getClientRects().length);
        if (e.shiftKey && document.activeElement === visible[0]) { e.preventDefault(); visible.at(-1)?.focus(); }
        else if (!e.shiftKey && document.activeElement === visible.at(-1)) { e.preventDefault(); visible[0]?.focus(); }
      }
    });
    window.addEventListener("resize", () => { this.drag = null; this.apply(); if (this.editing) this.controls(); });
    this.apply();
  }
  key() { return layoutProfile(innerWidth, innerHeight, document.body.classList.contains("leftHand")); }
  profile() { return this.draft.profiles[this.key()] ||= {}; }
  entry(id) {
    if (this.profile()[id]) return cleanEntry(this.profile()[id]);
    const r = $(id).getBoundingClientRect();
    return cleanEntry({ x: (r.left - 8) / Math.max(1, innerWidth - 16 - r.width), y: (r.top - 8) / Math.max(1, innerHeight - 16 - r.height) });
  }
  restore(id) {
    const el = $(id);
    for (const [p, value, priority] of this.original.get(id)) value ? el.style.setProperty(p, value, priority) : el.style.removeProperty(p);
  }
  apply() {
    const data = this.editing ? this.draft : this.saved;
    document.documentElement.dataset.uiTheme = data.theme;
    for (const [id] of this.original) this.restore(id);
    for (const placeholder of this.placeholders.values()) placeholder.remove();
    this.placeholders.clear();
    for (const [id] of this.original) {
      const el = $(id), e = data.profiles[this.key()]?.[id];
      if (!e) continue;
      el.classList.add("hudMeasure");
      const r = el.getBoundingClientRect(); el.classList.remove("hudMeasure");
      if (!r.width || !r.height) continue;
      // Keep neighboring flex buttons anchored when one is moved out of the row.
      const style = getComputedStyle(el);
      if (style.position === "static" || style.position === "relative") {
        const placeholder = document.createElement("span");
        placeholder.setAttribute("aria-hidden", "true");
        Object.assign(placeholder.style, { display: "block", visibility: "hidden", pointerEvents: "none", boxSizing: "border-box", width: r.width + "px", height: r.height + "px", flex: `0 0 ${r.width}px`, margin: style.margin });
        el.before(placeholder); this.placeholders.set(id, placeholder);
      }
      const p = placement(e, innerWidth, innerHeight, r.width, r.height);
      for (const [k, v] of Object.entries({ position: "fixed", left: p.left + "px", top: p.top + "px", right: "auto", bottom: "auto", transform: `scale(${p.scale})`, "transform-origin": "0 0", transition: "none" })) el.style.setProperty(k, String(v), "important");
      // Toast owns its opacity animation; vitals keep their damage flash filter.
      el.style.setProperty(id === "toast" ? "filter" : "opacity", id === "toast" ? `opacity(${e.opacity})` : String(e.opacity), "important");
      if (e.hidden && !this.editing) el.style.setProperty("visibility", "hidden", "important");
    }
    if (this.editing) {
      $("hudProfile").textContent = (innerWidth >= innerHeight ? "가로" : "세로") + " · " + (document.body.classList.contains("leftHand") ? "왼손" : "오른손");
      for (const [id, handle] of this.handles) {
        const r = $(id).getBoundingClientRect();
        Object.assign(handle.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
        handle.classList.toggle("selected", id === this.selected);
      }
    }
  }
  open() {
    this.callbacks.open(); this.draft = structuredClone(this.saved); this.editing = true;
    document.body.classList.add("layoutEditing"); $("hudEditor").hidden = false;
    $("hudInspector").hidden = false; $("hudInspectorToggle").setAttribute("aria-expanded", "true");
    $("hudEditMessage").textContent = "가로·세로와 왼손 배치를 따로 저장합니다.";
    this.apply(); this.select(this.selected); $("hudElement").focus();
  }
  select(id) { this.selected = id; this.apply(); this.controls(); }
  controls() {
    const e = this.entry(this.selected); $("hudElement").value = this.selected;
    $("hudScale").value = Math.round(e.scale * 100); $("hudScaleValue").textContent = Math.round(e.scale * 100) + "%";
    $("hudOpacity").value = Math.round(e.opacity * 100); $("hudOpacityValue").textContent = Math.round(e.opacity * 100) + "%";
    $("hudHide").checked = e.hidden; $("hudHide").disabled = !OPTIONAL_HUD.has(this.selected); $("hudTheme").value = this.draft.theme;
  }
  dragStart(e, id) {
    if (e.button !== 0 || this.drag) return;
    e.preventDefault(); this.select(id);
    const r = $(id).getBoundingClientRect();
    this.drag = { id, pointer: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top, key: this.key(), before: this.profile()[id] ? { ...this.profile()[id] } : null };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  dragMove(e) { const d = this.drag; if (!d || d.pointer !== e.pointerId) return; this.move(d.id, d.left + e.clientX - d.x, d.top + e.clientY - d.y); }
  dragEnd(e, cancelled) {
    const d = this.drag; if (!d || d.pointer !== e.pointerId) return; this.drag = null;
    if (cancelled) { if (d.before) this.draft.profiles[d.key][d.id] = d.before; else delete this.draft.profiles[d.key][d.id]; this.apply(); }
  }
  move(id, left, top) {
    const e = this.entry(id), r = $(id).getBoundingClientRect();
    e.x = clamp((left - 8) / Math.max(1, innerWidth - 16 - r.width), 0, 1);
    e.y = clamp((top - 8) / Math.max(1, innerHeight - 16 - r.height), 0, 1);
    this.profile()[id] = e; this.apply();
  }
  save() {
    const value = cleanLayout(this.draft);
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(value)); }
    catch { $("hudEditMessage").textContent = "저장하지 못했습니다. 공간을 확인하거나 취소해 주세요."; return; }
    this.saved = value; this.finish();
  }
  cancel() { if (this.editing) this.finish(); }
  finish() {
    this.drag = null; this.editing = false; $("hudEditor").hidden = true; document.body.classList.remove("layoutEditing");
    this.apply(); this.callbacks.close(); $("editHudBtn")?.focus();
  }
}
