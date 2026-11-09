/**
 * Geometry and border of the square resource tile — the single source for that
 * chrome, so the skills, custom tools, and settings surfaces cannot drift apart. Pair with a fill. Sizing
 * the glyph is the tile's job: the descendant rule outranks an icon's own class.
 */
export const RESOURCE_TILE_BASE =
  'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border-1)] [&_svg]:size-5'

/** Filled treatment worn by the skills and custom tools resource tiles. */
export const RESOURCE_TILE_FILL = 'bg-[var(--surface-4)] dark:bg-[var(--surface-5)]'

/** Page-background fill, for tiles holding a brand logo or a site favicon. */
export const RESOURCE_TILE_PLAIN = 'bg-[var(--bg)]'
