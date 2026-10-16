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
    const panel = document.querySelector('[data-panel="bag"]');
    panel.innerHTML = `<div class="survivalInventory"><aside class="recipeBook"><h3>제작법</h3><div class="recipeFilters"><button data-filter="all">전체</button><button data-filter="gear">장비</button><button data-filter="supplies">재료</button></div><div id="recipeList"></div></aside><div class="inventoryBody"><div class="inventoryTop"><div class="avatarPanel" aria-label="플레이어 장비"><div class="voxelAvatar"><i class="head"></i><i class="body"></i><i class="arm a"></i><i class="arm b"></i><i class="leg a"></i><i class="leg b"></i></div><span id="equippedName"></span></div><div class="craftBench"><h3 id="recipeName">제작</h3><div class="craftFlow"><div id="craftIngredients"></div><b>→</b><button id="craftOutput" aria-label="제작 결과"></button></div><p id="craftFeedback" role="status"></p></div></div><div class="slotHeading"><span>인벤토리 <small id="bagTotal"></small></span><button id="splitStack" aria-pressed="false">나누기</button><button id="cancelMove">선택 취소</button></div><div id="inventoryGrid" role="group" aria-label="보관함 27칸"></div><div id="inventoryHotbar" role="group" aria-label="핫바 9칸"></div><div id="itemDetail" aria-live="polite"></div><button id="reclaimItems" hidden>이전 보관품 받기</button><p class="slotGuide">아이템 → 목적지 탭으로 이동 · 나누기: 절반 이동 · 하단 9칸은 탐험 핫바</p></div></div>`;
    document.querySelectorAll("[data-filter]").forEach(
      (b) =>
        (b.onclick = () => {
          this.filter = b.dataset.filter;
          this.render();
        }),
    );
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
      this.split = true;
      this.tap(index);
    };
    // Drag and tap share one atomic move operation; cancellation never removes an item.
    b.onpointerdown = (e) => {
      if (e.button !== 0) return;
      this.drag = { index, x: e.clientX, y: e.clientY, id: e.pointerId };
      b.setPointerCapture(e.pointerId);
    };
    b.onpointerup = (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) < 12) return;
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
    b.onpointercancel = () => {
      this.drag = null;
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
      text.textContent = `${ITEMS[s.id].name} · ${s.count}개${GEAR[s.id]?.durability ? ` · 내구 ${inv.wear[s.id]}/${GEAR[s.id].durability}` : ""}${this.source !== null ? " · 옮길 칸을 누르세요" : ""}`;
      detail.append(text);
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
        (this.filter === "all" ||
          (this.filter === "gear" ? !!GEAR[r.id] : !GEAR[r.id])),
    );
    const list = document.getElementById("recipeList");
    list.replaceChildren();
    for (const r of recipes) {
      const id = Object.keys(r.give || {})[0] || r.id,
        b = document.createElement("button");
      b.className = "recipeTile" + (r.id === this.recipe ? " selected" : "");
      b.dataset.recipe = r.id;
      b.setAttribute("aria-label", r.name);
      b.title = r.name;
      b.innerHTML = itemArt(id) || `<span class="researchIcon">✦</span>`;
      if (!inv.canCraft(r)) b.classList.add("unavailable");
      b.onclick = () => {
        this.recipe = r.id;
        this.render();
      };
      list.append(b);
    }
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
    document.getElementById("craftFeedback").textContent =
      r.description +
      (r.requires && !inv.unlocks.has(r.requires) ? " · 선행 연구 필요" : "") +
      (inv.canCraft(r)
        ? " · 결과를 눌러 제작"
        : " · 재료·빈 칸·보유 상태 확인");
    this.c.renderHotbar();
  }
}
