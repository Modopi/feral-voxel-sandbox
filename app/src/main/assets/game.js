// Game session entry (docs/ARCHITECTURE.md §6): play.html?world=<id> starts one world from the launcher's list.
// This router is the only place that still picks an old engine: the machine field, until it moves onto the
// one runtime (docs/ROADMAP.md S3).
import { findWorld, touchWorld, syncVault, PRESETS } from "./world-slots.js";

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
  const engine = PRESETS[world.type].engine;
  // Every world but the machine field plays on the one runtime (since 0.16.0 the frontier too).
  if (engine === "machine") location.replace(`machine.html?world=${encodeURIComponent(world.id)}`);
  else
    import("./content-runtime/game.js").then((m) => m.start(world)).catch((e) => {
      console.error(e);
      loading.fail(`게임 파일을 불러오지 못했습니다: ${e.message}`);
    });
}
