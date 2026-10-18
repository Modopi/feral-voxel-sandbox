// The installed app (UpdateCore, native 303) accepts a game update only when it contains main.js and version.js,
// so this file stays. The frontier engine that lived here is gone (0.16.0): every world except the machine field
// plays on content-runtime/ (game.js routes it), and nothing loads this module. Remove it only together with a
// native release that drops the check (docs/ARCHITECTURE.md §8).
export {};
