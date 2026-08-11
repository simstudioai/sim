interface SizerFloorInput {
  /** High-water mark carried from the previous commit of this turn. */
  previousHighWater: number
  /** Floor currently written to the sizer, including one a drain has not finished releasing. */
  appliedFloor: number
  /** Natural sizer height — `virtualizer.getTotalSize()`. */
  contentHeight: number
  scrollTop: number
  clientHeight: number
  paddingTop: number
  paddingBottom: number
}

interface SizerFloorResult {
  /** Floor to write to the sizer's `min-height`. */
  floor: number
  /** High-water mark to carry into the next commit. */
  highWater: number
}

/**
 * Floor height for the transcript sizer while a turn streams — the value that
 * keeps `scrollHeight` from dipping below the scrolled-to extent when a row
 * transiently re-measures smaller — together with the high-water mark that
 * bounds it.
 *
 * The extent (`scrollTop + clientHeight`) is the viewport's bottom edge, which
 * sits BELOW the content whenever the transcript is shorter than the viewport —
 * early in a turn, or in any short chat. Flooring at the raw extent invents
 * scrollable space no content occupies, which stays invisible only while the
 * container keeps its height. The moment it shrinks mid-turn — the composer
 * growing, the queued-message banner appearing, a window or panel resize — that
 * space becomes real scrollable room, the bottom-pin scrolls into it, and the
 * transcript is dragged upward until the floor drains at the end of the turn.
 *
 * The high-water mark is what the extent is clamped to, and it folds in the
 * APPLIED floor as well as the live content height. Both terms are load-bearing:
 *
 * - Live content alone would release the debt on the very commit that created
 *   it, since holding space a shrink just took away is the floor's whole purpose.
 * - Ignoring the applied floor would dump undrained debt in a single frame when
 *   a queued message re-engages the floor mid-drain — the end-of-turn jump the
 *   eased drain exists to prevent.
 *
 * Together they say: never exceed the space content has actually held this turn.
 *
 * `Math.floor`, not the raw float: a fractional min-height can round
 * `scrollHeight` 1px ABOVE the scrolled-to extent, and that phantom 1px gap
 * re-derives 1px higher after every chase step — a visible 1px/frame upward
 * creep whenever the floor is what is holding `scrollHeight`.
 */
export function nextSizerFloor({
  previousHighWater,
  appliedFloor,
  contentHeight,
  scrollTop,
  clientHeight,
  paddingTop,
  paddingBottom,
}: SizerFloorInput): SizerFloorResult {
  const highWater = Math.max(previousHighWater, contentHeight, appliedFloor)
  const extent = Math.max(0, Math.floor(scrollTop + clientHeight - paddingTop - paddingBottom))
  return { floor: Math.min(extent, highWater), highWater }
}
