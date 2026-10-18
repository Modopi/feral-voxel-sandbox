const cache = new Map();
// The original sprites the design catalog reuses (DESIGN_ART below): colour, and whether they draw as a block
// or a tool. The old island and frontier item tables they came from are gone (0.17.0).
const SPRITES = {
  berry: { color: 0xb45765 }, herb: { color: 0xa5c9ab }, scrap: { color: 0x9f8e76 }, meat: { color: 0xc27670 },
  food: { color: 0xd9b76c }, iron: { color: 0xb8c4cf }, fiber: { color: 0x8eaf65 }, seed: { color: 0x98bf68 },
  stone: { color: 0x99a5a7, block: true }, wood: { color: 0x9f7849, block: true }, sand: { color: 0xd9c586, block: true }, plank: { color: 0xc5a071, block: true },
  wrench: { color: 0xbfcad1, assemblyTool: true }, grapple: { color: 0x83c8ba, assemblyTool: true },
  engineering: { color: 0xc9b77f, research: true },
};
// Original vector sprites: crisp voxel blocks and pixel tools, no external texture assets.
function itemArt(id) {
  if (cache.has(id)) return cache.get(id);
  const item = SPRITES[id];
  if (!item) return "";
  const color = "#" + item.color.toString(16).padStart(6, "0");
  let body = "";
  const rect = (x, y, w, h, c) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
  if (item.research) {
    body =
      rect(6, 4, 20, 25, "#c8c5a5") +
      rect(8, 6, 16, 21, "#536d6b") +
      rect(10, 10, 12, 2, "#b7cebb") +
      rect(10, 15, 9, 2, "#b7cebb") +
      rect(10, 20, 12, 2, "#b7cebb") +
      rect(4, 7, 3, 19, "#9e875e");
  } else if (id === "berry") {
    body =
      rect(7, 12, 9, 10, "#a24d65") +
      rect(17, 15, 9, 10, "#c76977") +
      rect(12, 7, 9, 10, "#b35770") +
      rect(9, 12, 3, 3, "#e39b9c") +
      rect(14, 4, 3, 7, "#789258") +
      rect(17, 3, 8, 4, "#a0b579");
  } else if (id === "herb") {
    body =
      rect(14, 8, 3, 22, "#759464") +
      rect(5, 13, 10, 5, "#b3d2a9") +
      rect(17, 7, 10, 5, "#88b59a") +
      rect(16, 20, 10, 4, "#96b397") +
      rect(10, 4, 9, 5, "#e2ddbb");
  } else if (id === "scrap") {
    body =
      rect(4, 10, 24, 5, "#9b8263") +
      rect(8, 6, 6, 20, "#8eaaac") +
      rect(18, 15, 8, 10, "#6e898b") +
      rect(10, 9, 2, 11, "#d4ded1") +
      rect(20, 18, 3, 3, "#223d40");
  } else if (item.block) {
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
  } else if (id === "grapple") {
    body =
      rect(13, 14, 6, 16, "#5b7875") +
      rect(10, 10, 12, 8, "#8ee5d0") +
      rect(4, 4, 5, 15, "#b6c6bd") +
      rect(23, 4, 5, 15, "#b6c6bd") +
      rect(7, 17, 18, 5, "#789d91") +
      rect(8, 3, 4, 4, "#d9c18c") +
      rect(20, 3, 4, 4, "#d9c18c");
  } else if (item.assemblyTool) {
    body =
      rect(13, 12, 6, 17, "#bfcad1") +
      rect(7, 4, 5, 11, "#bfcad1") +
      rect(21, 4, 5, 11, "#bfcad1") +
      rect(9, 12, 15, 6, "#bfcad1");
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
  else if (id === "iron")
    body =
      '<path d="M5 13L24 8 29 18 9 25 2 20Z" fill="#a6b9bf"/><path d="M5 13L24 8 26 13 8 19Z" fill="#dfebec"/>';
  else
    body = `<path d="M16 3L26 12 23 24 13 29 5 19 7 9Z" fill="${color}"/><path d="M16 3L17 17 7 9Z" fill="#fff" opacity=".4"/><path d="M17 17L23 24 13 29Z" fill="#000" opacity=".25"/>`;
  const svg = `<svg class="itemIcon" viewBox="0 0 32 32" aria-hidden="true" shape-rendering="crispEdges">${body}</svg>`;
  cache.set(id, svg);
  return svg;
}
// Design catalog items reuse the legacy sprite when the item is the same thing,
// otherwise they get a sprite in the same style by kind.
const DESIGN_ART = {
  wrench: "wrench",
  grapple: "grapple",
  berry: "berry",
  herb: "herb",
  meat: "meat",
  food: "food",
  seed: "seed",
  loose_stone: "stone",
  raw_timber: "wood",
  wood: "plank",
  sand: "sand",
  plant_fiber: "fiber",
  scrap_iron: "scrap",
  steel: "iron",
};
const TIER_COLORS = ["#9f7849", "#99a5a7", "#a7896b", "#b8c4cf", "#8fb7c2", "#a68fd0", "#d8c27a", "#e0a7c0", "#9fe0d0", "#f1e6b0"];
const FLUIDS = { water: "#4f93a8", acid_fluid: "#a7b04a", liquid_mana: "#8a7fe0", sap: "#d8a650", acid_sap: "#b9b84d", mana_sap: "#9d8fe6" };
function hue(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 32% 58%)`;
}
export function designItemArt(entry) {
  if (!entry) return "";
  if (DESIGN_ART[entry.id]) return itemArt(DESIGN_ART[entry.id]);
  if (entry.id.startsWith("blueprint:")) return itemArt("engineering");
  const key = "design:" + entry.id;
  if (cache.has(key)) return cache.get(key);
  const rect = (x, y, w, h, c) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
  const color = FLUIDS[entry.id] || (entry.tier ? TIER_COLORS[(entry.tier - 1) % 10] : hue(entry.id));
  let body;
  if (FLUIDS[entry.id])
    body = `<path d="M16 3C11 11 7 16 7 21a9 9 0 0 0 18 0c0-5-4-10-9-18Z" fill="${color}"/><path d="M12 20a4 4 0 0 0 4 5" stroke="#fff" stroke-width="2" opacity=".5" fill="none"/>`;
  else if (entry.kind === "material" || entry.kind === "item") {
    body = `<path d="M3 10L16 3 29 10 16 18Z" fill="${color}"/><path d="M3 10L16 18V30L3 22Z" fill="${color}"/><path d="M16 18L29 10V22L16 30Z" fill="${color}"/><path d="M3 10L16 18V30L3 22Z" fill="#fff" opacity=".16"/><path d="M16 18L29 10V22L16 30Z" fill="#000" opacity=".28"/>`;
    if (entry.kind === "item") body += rect(8, 15, 3, 3, "#ffffff70") + rect(20, 19, 3, 3, "#00000050");
  } else if (entry.kind === "station")
    body = rect(3, 11, 26, 6, "#a37f52") + rect(5, 17, 4, 12, "#6f5232") + rect(23, 17, 4, 12, "#6f5232") + rect(8, 6, 7, 5, "#99a5a7") + rect(18, 7, 8, 4, color);
  else if (entry.kind === "component")
    body = `<circle cx="16" cy="16" r="11" fill="${color}"/><circle cx="16" cy="16" r="4" fill="#263537"/>` + [0, 1, 2, 3].map((i) => rect(i % 2 ? 13 : 1 + i * 13, i % 2 ? (i === 1 ? 1 : 27) : 13, i % 2 ? 6 : 4, i % 2 ? 4 : 6, color)).join("");
  else if (entry.kind === "gear_baseline")
    body = `<path d="M16 3L27 7V16C27 23 22 27 16 30 10 27 5 23 5 16V7Z" fill="${color}"/><path d="M16 7L23 9.5V16C23 20.5 20 23.5 16 25.5Z" fill="#000" opacity=".22"/>`;
  else if (entry.kind === "tool")
    body = rect(12, 13, 5, 16, "#885d37") + rect(4, 5, 24, 5, color) + rect(24, 8, 4, 8, color);
  else
    body = `<path d="M16 3L26 12 23 24 13 29 5 19 7 9Z" fill="${color}"/><path d="M16 3L17 17 7 9Z" fill="#fff" opacity=".4"/>`;
  const svg = `<svg class="itemIcon" viewBox="0 0 32 32" aria-hidden="true" shape-rendering="crispEdges">${body}</svg>`;
  cache.set(key, svg);
  return svg;
}
