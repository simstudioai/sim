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
 * Halves of {@link SIDEBAR_SECTION_GAP_CLASS} straddling the scroll region's
 * divider: the pinned block above carries the top half, the scroll region below
 * carries the bottom half. Split this way the divider sits centered in a gap that
 * reads as one section gap, so the first section header is spaced from the block
 * above it exactly like every other section boundary. Keep both in step with the
 * section gap.
 */
export const SIDEBAR_DIVIDER_PAD_ABOVE_CLASS = 'pb-2'
export const SIDEBAR_DIVIDER_PAD_BELOW_CLASS = 'pt-2'

/**
 * Rail-chip geometry for the collapsed sidebar, gated by the `group/rail`
 * marker on the sidebar `aside` (the hover-peek card drops `data-collapsed`,
 * so peeked rows stay expanded). Collapses a full-width row to the natural
 * icon-only chip: 32px — the chip's own `px-2` + 16px glyph — matching the
 * header's Search/Collapse pills. Only the WIDTH is overridden, deliberately:
 * padding and margin stay untouched, so the chip's left edge (8px gutter) and
 * the glyph column (centered 24px in) hold exactly still on toggle and
 * through the morph — only the right edge slides. A true 30px square needs a
 * 1px margin + 7px padding, which visibly nudges the box or the glyph; 32×30
 * reads as square and nothing moves. Collapsing, the width tweens down to
 * 32px on the 175ms curve the rail closes on; expanding targets `auto` (not
 * interpolable), so the chip snaps to the still-narrow rail's width and
 * stretch-tracks it open. The duration is `!important` because the aside
 * zeroes chip transition durations (`[&_.group.cursor-pointer]:duration-0`)
 * for instant hover fills — colors are excluded from the property list here,
 * so hover fills keep snapping.
 */
export const SIDEBAR_RAIL_CHIP_CLASS = [
  'transition-[width]',
  '![transition-duration:175ms]',
  '[transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)]',
  'motion-reduce:!transition-none',
  'group-data-[collapsed]/rail:w-[32px]',
].join(' ')

/**
 * Nested-selector variants for cmdk-based surfaces (e.g. the search modal).
 * Written as complete literal strings so Tailwind's JIT can detect them.
 */

/** Matches {@link SIDEBAR_SECTION_GAP_CLASS} applied to adjacent cmdk groups. */
export const CMDK_SECTION_GAP_CLASS = '[&_[cmdk-group]+[cmdk-group]]:mt-4'

/** Matches {@link SIDEBAR_ITEM_GAP_CLASS} applied to cmdk item containers. */
export const CMDK_ITEM_GAP_CLASS = '[&_[cmdk-group-items]]:gap-[1px]'
