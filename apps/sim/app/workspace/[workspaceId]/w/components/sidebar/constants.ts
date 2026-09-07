/**
 * Shared sidebar spacing tokens.
 *
 * Apply these Tailwind class names so the sidebar and any related surfaces
 * (e.g. the workspace search modal) stay visually aligned. When the sidebar
 * rhythm changes, update these values and every consumer follows.
 */

/** Vertical gap between sibling sidebar sections (16px). */
export const SIDEBAR_SECTION_GAP_CLASS = 'mt-4'

/**
 * Vertical gap between items within a sidebar section (1px).
 *
 * Written as an arbitrary value, not `gap-px`: the `px` spacing key is remapped
 * to `--border-width`, which thins to 0.5px on hidpi displays so hairline borders
 * stay hairlines. That is right for a rule and wrong for a gap — this one is a
 * literal pixel at every density.
 */
export const SIDEBAR_ITEM_GAP_CLASS = 'gap-[1px]'

/**
 * Halves of {@link SIDEBAR_SECTION_GAP_CLASS} straddling a divider: the block
 * above carries the top half, the block below carries the bottom half. Split this
 * way the divider sits centered in a gap that reads as one section gap, so the
 * first section header is spaced from the pinned nav exactly like every other
 * section boundary. The scroll region carries BOTH — the bottom half under the
 * nav's divider and the top half above the footer's — as its own padding, so rows
 * scroll through the gap beneath the edge fade rather than stopping short of the
 * rule. Keep both in step with the section gap.
 */
export const SIDEBAR_DIVIDER_PAD_ABOVE_CLASS = 'pb-2'
export const SIDEBAR_DIVIDER_PAD_BELOW_CLASS = 'pt-2'

/**
 * Rail-chip geometry for the collapsed sidebar, gated by the `group/rail`
 * marker on the sidebar `aside` (the hover-peek card drops `data-collapsed`,
 * so peeked rows stay expanded). Collapses a full-width row to the natural
 * icon-only chip — 32px, the chip's own `px-2` + 16px glyph, matching the
 * header's Search/Collapse pills. Only the WIDTH is overridden: the rail is
 * 48px precisely so that the plain 8px item gutter centers the chip
 * ((48 − 32) / 2 = 8) and puts the glyph (24px in) on the rail's midline —
 * the same 24px column the expanded rows use, so NOTHING moves on toggle.
 * At the previous 51px rail those goals were mutually exclusive by 1.5px
 * (rail midline 25.5 vs glyph column 24), which produced either a
 * left-biased rail or a drift on toggle; keep the rail width and this chip
 * width commensurate (rail = chip + 2 × gutter) if either ever changes.
 * The width applies in one frame, in step with the rail itself.
 */
export const SIDEBAR_RAIL_CHIP_CLASS = 'group-data-[collapsed]/rail:w-[32px]'

/**
 * Nested-selector variants for cmdk-based surfaces (e.g. the search modal).
 * Written as complete literal strings so Tailwind's JIT can detect them.
 */

/** Matches {@link SIDEBAR_SECTION_GAP_CLASS} applied to adjacent cmdk groups. */
export const CMDK_SECTION_GAP_CLASS = '[&_[cmdk-group]+[cmdk-group]]:mt-4'

/** Matches {@link SIDEBAR_ITEM_GAP_CLASS} applied to cmdk item containers. */
export const CMDK_ITEM_GAP_CLASS = '[&_[cmdk-group-items]]:gap-[1px]'
