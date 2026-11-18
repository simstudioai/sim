/**
 * Arrow 1.x model IDs Quiver retired on 2026-10-16 (they now return 404 `model_not_found`).
 * Saved blocks still store them, so the block keeps them as hidden options and the operation
 * sends them as `arrow-2`, the documented replacement.
 */
export const RETIRED_QUIVER_MODELS = [
  'arrow-preview',
  'arrow-1',
  'arrow-1.0',
  'arrow-1.1',
  'arrow-1.1-max',
] as const
