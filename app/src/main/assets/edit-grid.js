export const DEFAULT_EDIT_SIZE = 0.5;
export const EDIT_GRID_VERSION = 1;

// Older saves wrote 1m even when the player never chose a size. Migrate that default once.
export function restoreEditGrid(saved, hammer = false) {
  const explicit = saved?.editGridVersion === EDIT_GRID_VERSION;
  return {
    miningSize: saved?.miningSize === 2 && hammer ? 2 : explicit && saved?.miningSize === 1 ? 1 : DEFAULT_EDIT_SIZE,
    buildSize: explicit && saved?.buildSize === 1 ? 1 : DEFAULT_EDIT_SIZE,
  };
}

export function editSizeLabel(size) {
  return size === 0.5 ? "½칸 · 0.5m" : `${size}칸 · ${size}m`;
}
