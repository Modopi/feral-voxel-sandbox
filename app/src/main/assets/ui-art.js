// A single original line-icon vocabulary, independent of platform emoji fonts.
const paths = {
  journey: '<path d="m12 2 8 10-8 10L4 12Z"/><path d="m12 7 4 5-4 5-4-5Z"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z"/><path d="M9 3v16M15 5v16"/>',
  person:
    '<circle cx="12" cy="6" r="3"/><path d="M7 21v-6H4l3-5h10l3 5h-3v6M9 15h6"/>',
  village:
    '<path d="m2 12 6-6 6 6M4 11v10h8V11M14 8V2l7 3-7 3M14 21h7V11h-5"/>',
  tools:
    '<path d="m4 21 12-12M13 3l8 8M11 5l4-3 7 7-3 4M3 4l5 5M2 2l3 1 3 4-2 2-3-4Z"/>',
  bag: '<path d="M6 6h12l3 4v11H3V10ZM8 6V3h8v3M3 12h18M8 12v4h8v-4"/>',
  menu: '<path d="M4 5h16M4 12h16M4 19h16"/>',
  use: '<path d="m12 3 8 4v10l-8 4-8-4V7ZM4 7l8 5 8-5M12 12v9"/>',
  attack: '<path d="m5 20 13-15 3-2-1 4L7 22M3 15l7 6M5 17l-3 4"/>',
  jump: '<path d="M12 21V4M5 11l7-7 7 7M4 21h3M17 21h3"/>',
  down: '<path d="M12 3v17M5 13l7 7 7-7"/>',
  flight: '<path d="m12 2 2 8 8 5v3l-8-2v4l-2 2-2-2v-4l-8 2v-3l8-5Z"/>',
  sprint: '<path d="m5 5 7 7-7 7M12 5l7 7-7 7"/>',
  crouch:
    '<circle cx="15" cy="5" r="2"/><path d="m13 9-6 3 5 4-3 5M13 9l3 5h4M12 16h5v5"/>',
  crawl:
    '<circle cx="19" cy="12" r="2"/><path d="M16 14H7l-4 5M8 14l3 5h3M16 14l2 5h3"/>',
  research: '<path d="M5 3h10l4 4v14H5Z"/><path d="M15 3v4h4M8 11h8M8 15h8M8 19h5"/>',
  energy: '<path d="M13 2 5 14h6l-1 8 8-12h-6Z"/>',
  device:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"/>',
  faith:
    '<path d="m12 2 2.6 6.2L21 9l-5 4.3 1.5 6.7L12 16.7 6.5 20 8 13.3 3 9l6.4-.8Z"/>',
  brake: '<path d="M6 6h12v12H6Z"/>',
};
export function uiIcon(id) {
  return `<svg class="uiIcon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" stroke-linejoin="miter">${paths[id] || paths.journey}</svg>`;
}
export function installHUDArt() {
  for (const [id, icon] of Object.entries({
    inventoryBtn: "bag",
    menuBtn: "menu",
    sprintBtn: "sprint",
    crouchBtn: "crouch",
    crawlBtn: "crawl",
    jumpBtn: "jump",
    descendBtn: "down",
    brakeBtn: "brake",
    flyBtn: "flight",
    useBtn: "use",
  })) {
    const el = document.getElementById(id);
    if (!el) continue;
    for (const node of [...el.childNodes])
      if (node.nodeType === 3) node.remove();
    el.insertAdjacentHTML("afterbegin", uiIcon(icon));
  }
}
export function worldArt(type) {
  const extra =
    type === "machine"
      ? '<path d="M18 42h43v13H18Z" fill="#9bb5b2"/><path d="M34 31h19v11H34Z" fill="#d8b777"/><circle cx="27" cy="56" r="7" fill="#162b30"/><circle cx="55" cy="56" r="7" fill="#162b30"/>'
      : type === "frontier"
        ? '<path d="M40 17v42M30 29h20M32 40h16M33 17h14" stroke="#d4b77c" stroke-width="3"/><path d="m40 7 5 7-5 7-5-7Z" fill="#8ce0c8"/>'
        : '<path d="M21 46V24M61 52V29" stroke="#836543" stroke-width="5"/><path d="m21 8 13 23H8ZM61 13l13 24H48Z" fill="#8ea970"/>';
  return `<svg class="worldArt" viewBox="0 0 80 72" aria-hidden="true"><defs><linearGradient id="sky-${type}" x2="0" y2="1"><stop stop-color="#31535c"/><stop offset="1" stop-color="#9eb7a3"/></linearGradient></defs><path fill="url(#sky-${type})" d="M0 0h80v72H0Z"/><path d="m0 40 16-17 18 20 14-18 32 16v31H0Z" fill="#526f68"/><path d="m0 56 26-12 25 9 29-7v26H0Z" fill="#789167"/>${extra}<path d="M0 67h80" stroke="#d0b77b" stroke-width="2"/></svg>`;
}
