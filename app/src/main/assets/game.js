// The single game entry. Every world opens index.html; the world's map type decides what runs
// on the shared screen. The frontier and the machine test field move onto the one runtime in later steps.
import { listWorlds, DEFAULTS } from "./world-slots.js";

const loading = window.FeralLoading;
const id = new URLSearchParams(location.search).get("world");
let world = null;
try {
  world = id
    ? listWorlds(localStorage).find((w) => w.id === id)
    : DEFAULTS.find((w) => w.type === "island");
} catch (e) {
  loading.fail(e.message);
}
if (!world) {
  if (!loading.failed) loading.fail("이 월드를 찾을 수 없습니다. 월드 목록에서 다시 선택하세요.");
} else if (world.type === "machine") {
  location.replace(`machine.html${location.search}`);
} else {
  document.body.dataset.map = world.type;
  // The basic island and the content expedition run on the one runtime; the frontier moves next.
  import(["expedition", "island"].includes(world.type) ? "./content-runtime/game.js" : "./main.js").catch(
    (e) => {
      console.error(e);
      loading.fail(`게임 파일을 불러오지 못했습니다: ${e.message}`);
    },
  );
}
