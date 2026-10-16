import { ITEMS } from "./inventory.js";
const cache = new Map();
// Original vector sprites: crisp voxel blocks and pixel tools, no external texture assets.
export function itemArt(id) {
  if (cache.has(id)) return cache.get(id);
  const item = ITEMS[id];
  if (!item) return "";
  const color = "#" + item.color.toString(16).padStart(6, "0");
  let body = "";
  const rect = (x, y, w, h, c) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
  if (item.block) {
    body = `<path d="M3 10L16 3 29 10 16 18Z" fill="${color}"/><path d="M3 10L16 18V30L3 22Z" fill="${color}"/><path d="M16 18L29 10V22L16 30Z" fill="${color}"/><path d="M3 10L16 18V30L3 22Z" fill="#fff" opacity=".16"/><path d="M16 18L29 10V22L16 30Z" fill="#000" opacity=".28"/>`;
    for (let n = 0; n < 6; n++)
      body += rect(
        5 + (n % 3) * 3,
        14 + Math.floor(n / 3) * 5 + (n % 3) * 1.5,
        2,
        2,
        n % 2 ? "#ffffff40" : "#00000040",
      );
    if (id === "wood" || id === "plank")
      body +=
        '<path d="M6 15v9m4-7v9m11-9v8m4-10v8" stroke="#503a25" stroke-width="1.5"/>';
  } else if (item.gear) {
    const metal = ["sword", "battleaxe", "ironpick", "crystalbow"].includes(id)
      ? "#d1e6e4"
      : "#929c99";
    if (id === "pulse")
      body =
        rect(4, 11, 22, 10, "#567970") +
        rect(10, 21, 6, 8, "#845e3f") +
        rect(24, 13, 6, 6, "#bd9b54") +
        rect(8, 12, 8, 3, "#89e9d4");
    else if (id === "bow" || id === "crystalbow")
      body =
        '<path d="M9 3L18 9V23L9 29M9 3V29M4 16H28" stroke="#b58953" stroke-width="3" fill="none"/>' +
        rect(25, 14, 4, 4, metal) +
        (id === "crystalbow" ? rect(8, 12, 12, 7, "#5faeb9") : "");
    else {
      body = rect(12, 13, 5, 16, "#885d37") + rect(13, 14, 2, 14, "#bd9258");
      if (id.includes("pick"))
        body +=
          rect(4, 5, 24, 5, metal) +
          rect(24, 8, 4, 8, metal) +
          rect(4, 8, 4, 4, metal);
      else if (id === "axe" || id === "battleaxe")
        body += rect(9, 4, 16, 12, metal) + rect(21, 7, 6, 10, metal);
      else if (id === "shovel")
        body += rect(8, 3, 14, 11, metal) + rect(10, 14, 10, 3, metal);
      else if (id === "club")
        body += rect(9, 4, 12, 13, metal) + rect(7, 7, 16, 6, metal);
      else
        body +=
          rect(12, 2, 5, 16, metal) +
          rect(8, 17, 13, 3, "#d3ae5d") +
          rect(13, 0, 3, 3, metal);
    }
  } else if (id === "seed" || id === "fiber")
    body =
      rect(14, 10, 3, 19, "#7e9653") +
      rect(7, 7, 9, 6, "#adca66") +
      rect(16, 3, 9, 7, "#88af4d") +
      rect(5, 18, 10, 5, "#628a40");
  else if (id === "meat")
    body =
      rect(5, 10, 22, 14, "#9a4e4b") +
      rect(8, 7, 16, 14, "#d58a7f") +
      rect(10, 12, 9, 5, "#f4d4b3");
  else if (id === "food")
    body =
      rect(4, 12, 24, 13, "#9c652f") +
      rect(7, 8, 18, 12, "#dbac59") +
      rect(10, 6, 12, 6, "#edc677") +
      rect(9, 11, 2, 8, "#b4833b") +
      rect(18, 10, 2, 8, "#b4833b");
  else if (id === "medicine")
    body =
      rect(11, 3, 10, 5, "#ad8954") +
      rect(9, 8, 14, 20, "#98c6bd") +
      rect(11, 17, 10, 8, "#d78481") +
      rect(13, 12, 6, 3, "#e9e2c4") +
      rect(15, 10, 2, 7, "#e9e2c4");
  else if (id === "arrow")
    body =
      '<path d="M5 27L26 6" stroke="#c9ad7e" stroke-width="3"/>' +
      rect(23, 3, 6, 6, "#c1d5d3") +
      rect(3, 23, 6, 6, "#e6e5d0");
  else if (id === "iron")
    body =
      '<path d="M5 13L24 8 29 18 9 25 2 20Z" fill="#a6b9bf"/><path d="M5 13L24 8 26 13 8 19Z" fill="#dfebec"/>';
  else
    body = `<path d="M16 3L26 12 23 24 13 29 5 19 7 9Z" fill="${color}"/><path d="M16 3L17 17 7 9Z" fill="#fff" opacity=".4"/><path d="M17 17L23 24 13 29Z" fill="#000" opacity=".25"/>`;
  const svg = `<svg class="itemIcon" viewBox="0 0 32 32" aria-hidden="true" shape-rendering="crispEdges">${body}</svg>`;
  cache.set(id, svg);
  return svg;
}
