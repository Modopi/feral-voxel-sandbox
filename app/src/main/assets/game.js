// Game session entry (docs/ARCHITECTURE.md §6): play.html?world=<id> starts one world from the launcher's list.
// Every world plays on the one runtime (content-runtime/, since 0.17.0 the machine field too): no engine choice.
import { findWorld, touchWorld, syncVault } from "./world-slots.js";

const loading = window.FeralLoading;
const id = new URLSearchParams(location.search).get("world");
let world = null;
try {
  world = id ? findWorld(localStorage, id) : null;
} catch (e) {
  loading.fail(e.message);
}
if (!world) {
  if (!loading.failed) loading.fail("이 월드를 찾을 수 없습니다. 런처에서 다시 선택하세요.");
} else {
  try {
    touchWorld(localStorage, world.id);
    syncVault();
  } catch (e) {
    console.warn("마지막 플레이 시각을 기록하지 못했습니다", e);
  }
  import("./content-runtime/game.js").then((m) => m.start(world)).catch((e) => {
    console.error(e);
    loading.fail(`게임 파일을 불러오지 못했습니다: ${e.message}`);
  });
}
