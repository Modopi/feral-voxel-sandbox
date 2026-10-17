import { mountCharacterPortrait } from "./character-portrait.js";
import { sourceHints } from "./acquisition.js";
import { ITEMS, RECIPES } from "./inventory.js";
import { GEAR } from "./equipment.js";
import { itemArt } from "./item-art.js";
export class InventoryUI {
  constructor(ctx) {
    this.c = ctx;
    this.source = null;
    this.split = false;
    this.recipe = "planks";
    this.filter = "all";
    this.query = "";
    this.craftableOnly = false;
    const panel = document.querySelector('[data-panel="bag"]');
    panel.innerHTML = `<div class="survivalInventory"><aside class="recipeBook"><h3>제작법 <small>↕ 밀어서 더 보기</small></h3><div class="recipeFilters"><button data-filter="all">전체</button><button data-filter="gear">장비</button><button data-filter="supplies">재료</button></div><div class="recipeSearch"><input id="recipeSearch" type="search" maxlength="40" placeholder="제작법 찾기" aria-label="제작법 또는 결과 아이템 이름 검색"><button id="craftableOnly" aria-pressed="false" aria-label="지금 제작 가능한 것만">✓</button></div><div id="recipeList" tabindex="0" role="region" aria-label="제작법 목록 · 위아래로 스크롤"></div></aside><div class="inventoryBody" tabindex="0" role="region" aria-label="인벤토리 · 위아래로 스크롤"><div class="inventoryTop"><div class="avatarPanel" aria-label="플레이어 장비"><span id="equippedName"></span></div><div class="craftBench"><h3 id="recipeName">제작</h3><div class="craftFlow"><div id="craftIngredients"></div><b>→</b><button id="craftOutput" aria-label="제작 결과"></button></div><p id="craftFeedback" role="status"></p></div></div><div class="slotHeading"><span>인벤토리 <small id="bagTotal"></small></span><button id="splitStack" aria-pressed="false">나누기</button><button id="cancelMove">선택 취소</button></div><div id="inventoryGrid" role="group" aria-label="보관함 27칸"></div><div id="inventoryHotbar" role="group" aria-label="핫바 9칸"></div><div id="itemDetail" aria-live="polite"></div><button id="reclaimItems" hidden>이전 보관품 받기</button><p class="slotGuide">아이템 → 목적지 탭으로 이동 · 나누기: 절반 이동 · 하단 9칸은 탐험 핫바</p></div></div>`;
    document.querySelectorAll("[data-filter]").forEach(
      (b) =>
        (b.onclick = () => {
          this.filter = b.dataset.filter;
          document.getElementById("recipeList").scrollTop = 0;
          this.render();
        }),
    );
    document.getElementById("recipeSearch").oninput = (e) => {
      this.query = e.target.value;
      document.getElementById("recipeList").scrollTop = 0;
      this.render();
    };
    document.getElementById("craftableOnly").onclick = () => {
      this.craftableOnly = !this.craftableOnly;
      document.getElementById("recipeList").scrollTop = 0;
      this.render();
    };
    document.getElementById("splitStack").onclick = () => {
      this.split = !this.split;
      this.render();
    };
    document.getElementById("cancelMove").onclick = () => {
      this.source = null;
      this.render();
    };
    document.getElementById("reclaimItems").onclick = () => {
      this.c.inventory.reclaim();
      this.render();
    };
    document.getElementById("craftOutput").onclick = () =>
      this.c.craft(this.recipe);
  }
  slot(index, hotbar = false) {
    const inv = this.c.inventory,
      s = inv.slots[index],
      b = document.createElement("button");
    b.className =
      "itemSlot" +
      (this.source === index ? " moving" : "") +
      (inv.selectedSlot === index ? " equipped" : "");
    b.dataset.slot = index;
    b.dataset.item = s?.id || "";
    b.setAttribute(
      "aria-label",
      `${index < 9 ? "핫바" : "보관함"} ${index < 9 ? index + 1 : index - 8} · ${s ? `${ITEMS[s.id].name} ${s.count}개` : "빈 칸"}`,
    );
    b.innerHTML = s
      ? itemArt(s.id) +
        (s.count > 1 ? `<b class="stackCount">${s.count}</b>` : "") +
        (GEAR[s.id]?.durability
          ? `<progress class="durability" max="${GEAR[s.id].durability}" value="${inv.wear[s.id] || 0}"></progress>`
          : "")
      : "";
    if (hotbar) b.innerHTML += `<span class="slotNumber">${index + 1}</span>`;
    b.onclick = () => this.tap(index);
    b.oncontextmenu = (e) => {
      e.preventDefault();
      if (e.pointerType === "touch") return;
      this.split = true;
      this.tap(index);
    };
    // Touch uses tap-to-move so a swipe on any slot can scroll the inventory.
    // Mouse drag shares the same atomic move operation.
    b.onpointerdown = (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      this.drag = { index, x: e.clientX, y: e.clientY, id: e.pointerId };
      b.setPointerCapture(e.pointerId);
    };
    b.onpointerup = (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 12) return;
      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest("[data-slot]");
      if (target) {
        inv.move(d.index, +target.dataset.slot, this.split);
        this.source = null;
        this.c.changed();
        this.render();
      }
    };
    b.onpointercancel = b.onlostpointercapture = (e) => {
      if (this.drag?.id === e.pointerId) this.drag = null;
    };
    return b;
  }
  tap(index) {
    const inv = this.c.inventory;
    if (this.source === null) {
      if (!inv.slots[index]) return;
      this.source = index;
    } else if (this.source === index) this.source = null;
    else {
      inv.move(this.source, index, this.split);
      this.source = null;
      this.c.changed();
    }
    this.render();
  }
  render() {
    const inv = this.c.inventory;
    const body = document.querySelector(".inventoryBody"),
      inventoryScroll = body.scrollTop;
    document
      .getElementById("inventoryGrid")
      .replaceChildren(
        ...Array.from({ length: 27 }, (_, i) => this.slot(i + 9)),
      );
    document
      .getElementById("inventoryHotbar")
      .replaceChildren(
        ...Array.from({ length: 9 }, (_, i) => this.slot(i, true)),
      );
    document
      .getElementById("splitStack")
      .setAttribute("aria-pressed", String(this.split));
    const s = inv.slots[this.source ?? inv.selectedSlot],
      detail = document.getElementById("itemDetail");
    detail.replaceChildren();
    if (s) {
      const text = document.createElement("span");
      text.textContent = `${ITEMS[s.id].name} · ${s.count}개${GEAR[s.id]?.durability ? ` · 내구 ${inv.wear[s.id]}/${GEAR[s.id].durability}` : ""}${GEAR[s.id]?.attackMode ? (GEAR[s.id].attackMode === "pierce" ? " · 공격: 내부 관통" : " · 공격: 충격 전달") : ""}${this.source !== null ? " · 옮길 칸을 누르세요" : ""}`;
      detail.append(text);
      const source = document.createElement("small");
      source.className = "itemSource";
      source.textContent =
        "얻는 곳: " +
        sourceHints(s.id, !!this.c.frontier).slice(0, 3).join(" / ");
      detail.append(source);
      if (GEAR[s.id]?.durability) {
        const b = document.createElement("button");
        b.textContent = "수리";
        b.disabled = inv.wear[s.id] >= GEAR[s.id].durability;
        b.onclick = () => {
          this.c.toast(
            inv.repair(s.id) ? "수리 완료" : "재료 부족 · 제작 재료 절반 필요",
          );
          this.c.changed();
          this.render();
        };
        detail.append(b);
      }
    } else detail.textContent = "빈 손 · 아이템을 핫바에 놓아 사용하세요.";
    mountCharacterPortrait(document.querySelector(".avatarPanel"), {
      armored: inv.unlocks.has("armor"),
      held: inv.slots[inv.selectedSlot]?.id,
    });
    document.getElementById("equippedName").textContent =
      ITEMS[inv.slots[inv.selectedSlot]?.id]?.name || "빈 손";
    document.getElementById("bagTotal").textContent =
      `${inv.slots.filter(Boolean).length}/36칸`;
    const reclaim = document.getElementById("reclaimItems");
    reclaim.hidden = !inv.overflow.length;
    reclaim.textContent = `보관품 ${inv.overflow.reduce((n, s) => n + s.count, 0)}개 받기 · 빈 칸 필요`;
    const recipes = RECIPES.filter(
      (r) =>
        (!r.frontier || this.c.frontier) &&
        (!this.craftableOnly || inv.canCraft(r)) &&
        (!this.query.trim() ||
          [
            r.name,
            ...Object.keys(r.give || {}).map((id) => ITEMS[id].name),
          ].some((name) =>
            name
              .toLocaleLowerCase()
              .includes(this.query.trim().toLocaleLowerCase()),
          )) &&
        (this.filter === "all" ||
          (this.filter === "gear"
            ? !!GEAR[r.id] || Object.keys(r.give || {}).some((id) => GEAR[id])
            : !GEAR[r.id] &&
              !Object.keys(r.give || {}).some((id) => GEAR[id]))),
    );
    document
      .getElementById("craftableOnly")
      .setAttribute("aria-pressed", String(this.craftableOnly));
    document
      .querySelectorAll("[data-filter]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.filter === this.filter),
        ),
      );
    const list = document.getElementById("recipeList");
    const recipeScroll = list.scrollTop;
    list.replaceChildren();
    for (const r of recipes) {
      const id = Object.keys(r.give || {})[0] || r.id,
        b = document.createElement("button");
      b.className = "recipeTile" + (r.id === this.recipe ? " selected" : "");
      b.dataset.recipe = r.id;
      b.setAttribute("aria-label", r.name);
      b.title = r.name;
      b.innerHTML = itemArt(id) || `<span class="researchIcon">✦</span>`;
      const label = document.createElement("small");
      label.textContent = r.name;
      b.append(label);
      if (!inv.canCraft(r)) b.classList.add("unavailable");
      b.onclick = () => {
        this.recipe = r.id;
        this.render();
      };
      list.append(b);
    }
    if (!recipes.length) {
      const empty = document.createElement("p");
      empty.className = "recipeEmpty";
      empty.textContent = "맞는 제작법이 없습니다. 검색어나 ✓ 필터를 바꾸세요.";
      list.append(empty);
    }
    list.scrollTop = recipeScroll;
    const r = RECIPES.find((r) => r.id === this.recipe) || RECIPES[0];
    this.recipe = r.id;
    document.getElementById("recipeName").textContent = r.name;
    const costs = Object.entries(r.cost),
      grid = document.getElementById("craftIngredients");
    grid.replaceChildren();
    for (let i = 0; i < 4; i++) {
      const d = document.createElement("div");
      d.className = "ingredient";
      if (costs[i]) {
        const [id, n] = costs[i];
        d.innerHTML = itemArt(id) + `<small>${inv.count(id)}/${n}</small>`;
        d.classList.toggle("missing", inv.count(id) < n);
        d.title = ITEMS[id].name;
      }
      grid.append(d);
    }
    const output = document.getElementById("craftOutput"),
      id = Object.keys(r.give || {})[0] || r.id;
    output.innerHTML =
      (itemArt(id) || "<span>✦</span>") + `<b>${r.give?.[id] || 1}</b>`;
    output.disabled = !inv.canCraft(r);
    output.setAttribute("aria-label", `${r.name} 제작`);
    const missing = Object.entries(r.cost)
      .filter(([id, n]) => inv.count(id) < n)
      .map(([id, n]) => `${ITEMS[id].name} ${n - inv.count(id)}`);
    const blocked =
      r.requires && !inv.unlocks.has(r.requires)
        ? `${RECIPES.find((p) => p.unlock === r.requires)?.name || r.requires} 먼저 연구`
        : missing.length
          ? `부족: ${missing.join(" · ")}`
          : r.unlock && (inv.unlocks.has(r.unlock) || inv.count(r.id))
            ? "이미 보유·연구 완료"
            : "결과 아이템을 놓을 빈 칸이 필요합니다";
    document.getElementById("craftFeedback").textContent =
      r.description +
      (inv.canCraft(r) ? " · 결과를 눌러 제작" : " · " + blocked);
    const previousGuide = document.getElementById("sourceGuide"),
      wasOpen = previousGuide?.open;
    previousGuide?.remove();
    const guide = document.createElement("details");
    guide.id = "sourceGuide";
    guide.open = !!wasOpen;
    const summary = document.createElement("summary");
    summary.textContent = "재료 얻는 곳 · 채집과 제작 경로";
    guide.append(summary);
    for (const [id] of costs) {
      const line = document.createElement("p");
      line.textContent =
        ITEMS[id].name + ": " + sourceHints(id, !!this.c.frontier).join(" / ");
      guide.append(line);
    }
    document.querySelector(".craftBench").append(guide);
    this.c.renderHotbar();
    body.scrollTop = inventoryScroll;
  }
}
