import {
  listWorlds,
  saveKey,
  worldURL,
  createWorld,
  deleteWorld,
  renameWorld,
} from "./world-slots.js";
import { VERSION } from "./version.js";
import { readLayout } from "./hud-layout.js";
document.documentElement.dataset.uiTheme = readLayout(localStorage).theme;
const $ = (id) => document.getElementById(id);
let deleting, renaming;
function run(fn) {
  try {
    fn();
  } catch (e) {
    $("status").textContent = e.message;
    const dialog = document.querySelector("dialog[open]");
    if (dialog) {
      let error = dialog.querySelector("[role=status]");
      if (!error) { error = document.createElement("p"); error.setAttribute("role", "status"); dialog.append(error); }
      error.textContent = e.message;
    }
  }
}
function draw() {
  const list = $("worlds");
  list.replaceChildren();
  for (const w of listWorlds(localStorage)) {
    const row = document.createElement("article"),
      info = document.createElement("div"),
      name = document.createElement("b"),
      desc = document.createElement("small"),
      glyph = document.createElement("span");
    glyph.className = "worldGlyph";
    glyph.textContent = w.type === "machine" ? "⚙" : w.type === "frontier" ? "⚑" : "◆";
    glyph.setAttribute("aria-hidden", "true");
    name.textContent = w.name;
    desc.textContent = `${w.type === "frontier" ? "개척 · 지역 탐험 / 공동체 / 보스" : w.type === "machine" ? "BETA · 기계 조립 시험장" : "기본 · 복셀 섬 / 시드 " + w.seed} · ${localStorage.getItem(saveKey(w)) ? "저장 있음" : "새 월드"}`;
    info.append(name, desc);
    row.append(glyph, info);
    for (const [text, fn] of [
      ["플레이", () => (location.href = worldURL(w))],
      [
        "이름 변경",
        () => {
          renaming = w.id;
          $("renameName").value = w.name;
          $("rename").showModal();
        },
      ],
      [
        "삭제",
        () => {
          deleting = w.id;
          $("confirmText").textContent =
            `“${w.name}” 월드와 저장을 삭제할까요?`;
          $("confirm").showModal();
        },
      ],
    ]) {
      const b = document.createElement("button");
      b.textContent = text;
      b.onclick = () => run(fn);
      row.append(b);
    }
    list.append(row);
  }
  if (!list.childNodes.length)
    list.textContent = "월드가 없습니다. 아래에서 만들어 주세요.";
}
$("newWorld").onclick = () => {
  $("createDialog").querySelector("[role=status]")?.remove();
  $("createDialog").showModal(); $("name").focus();
};
$("createCancel").onclick = () => $("createDialog").close();
$("create").onsubmit = (e) => {
  e.preventDefault();
  run(() => {
    createWorld(
      localStorage,
      $("name").value,
      $("type").value,
      Number($("seed").value),
    );
    $("name").value = "";
    $("createDialog").close();
    draw();
  });
};
$("deleteYes").onclick = () =>
  run(() => {
    deleteWorld(localStorage, deleting);
    $("confirm").close();
    draw();
  });
$("deleteNo").onclick = () => $("confirm").close();
$("renameForm").onsubmit = (e) => {
  e.preventDefault();
  run(() => {
    renameWorld(localStorage, renaming, $("renameName").value);
    $("rename").close();
    draw();
  });
};
$("renameNo").onclick = () => $("rename").close();
run(draw);
// 정상 목록 표시 후 네이티브 시작 검증 완료
let frames = 0,
  start = performance.now();
function healthy(now) {
  if (++frames >= 12 && now - start >= 3000)
    window.AndroidApp?.runtimeHealthy?.(VERSION.versionCode);
  else requestAnimationFrame(healthy);
}
requestAnimationFrame(healthy);
