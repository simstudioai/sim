/**
 * The canvas z-scale, bottom to top. Every entry is a React Flow `zIndex` on a
 * node or an edge, and React Flow's viewport is the one stacking context they
 * all resolve in, so the numbers are directly comparable.
 *
 * - `0, 1, 2 …` — subflow containers, by nesting depth
 * - {@link EDGE_Z_BASE}`…`{@link EDGE_Z_MAX} — edges, and the in-flight drag line
 * - {@link BLOCK_Z_BASE} — cards (+1 last interacted, +10 selected)
 * - {@link CONTAINER_CHILD_Z_BASE} — cards inside a container (same +1 / +10 steps)
 * - {@link CONNECTION_PICKER_Z} — the connection block picker
 *
 * Containers and ordinary edges occupy separate bands. A container paints an
 * opaque body, so an edge sharing its z loses the equal-z tiebreak to DOM order
 * — React Flow renders the nodes layer after the edges layer — and is drawn
 * *behind* the container. Incoming container edges deliberately use that rule
 * at their target's depth: the target sits above its parent by one depth, leaving
 * the edge over the parent body but beneath the target. The edge can also be
 * occluded by peer or higher-depth containers it crosses. Cards then sit above
 * the edge band, so every other line still passes behind card chrome, knobs, and
 * the action-bar swell.
 *
 * Shared by the editor canvas and the read-only preview because both render the
 * same graph through the same React Flow layering rules; a second scale drifted
 * once already and took the preview's edges behind its containers with it.
 */
export const EDGE_Z_BASE = 10
/**
 * The z-scale above is only honored when React Flow's automatic z-index
 * management is off: v12's default `basic` mode adds a parented node's
 * internal z to every edge touching it, silently lifting a `zIndex: 11` edge
 * inside a container to 1011 — above the cards it must render behind. Every
 * `<ReactFlow>` mount that renders this scale must pass
 * `zIndexMode={CANVAS_Z_INDEX_MODE}`.
 */
export const CANVAS_Z_INDEX_MODE = 'manual' as const
/**
 * Deepest nesting tier an ordinary edge reaches, leaving the top of the band to
 * the two edges that have to be seen whole.
 */
const EDGE_Z_DEPTH_MAX = 18
/**
 * A highlighted edge — selected, or connected to the selected card. Above every
 * ordinary edge whatever it is nested in, because the highlight is what the
 * user is looking at and a line crossing it from a deeper container was cutting
 * it in half.
 *
 * Still inside the edge band, deliberately. Highlighted edges used to be
 * elevated over the cards as well, which drew them across the chrome of their
 * own endpoints; a line belongs behind cards, knobs and the action-bar swell
 * whether or not it is highlighted.
 */
const EDGE_Z_HIGHLIGHTED = 19
export const EDGE_Z_MAX = 20
export const BLOCK_Z_BASE = 21
export const CONTAINER_CHILD_Z_BASE = 1000
export const CONNECTION_PICKER_Z = 2000

/** A card's z: its baseline, lifted while it is the last interacted or selected. */
export function getBlockZIndex(
  baseline: number,
  state: { isSelected?: boolean; isLastInteracted?: boolean } = {}
): number {
  if (state.isSelected) return baseline + 10
  if (state.isLastInteracted) return baseline + 1
  return baseline
}

/**
 * Places an edge in the edge band, ordered by the nesting depth of the container
 * it belongs to, so an edge always clears the container body it crosses while
 * staying under that container's own children.
 *
 * A highlighted edge leaves that ordering and takes {@link EDGE_Z_HIGHLIGHTED}
 * instead. Depth is only a tiebreak between lines nobody is looking at; once one
 * is highlighted, being drawn whole matters more than which container it came
 * from — an unselected edge one level deeper used to paint straight over it.
 *
 * `containerZIndex` is the parent container's own z (its nesting depth), or
 * undefined for an edge at the top level.
 */
export function getEdgeZIndex(
  containerZIndex: number | undefined,
  state: { isHighlighted?: boolean } = {}
): number {
  if (state.isHighlighted) return EDGE_Z_HIGHLIGHTED
  const depth = containerZIndex === undefined ? 0 : containerZIndex + 1
  return Math.min(EDGE_Z_BASE + depth, EDGE_Z_DEPTH_MAX)
}

/**
 * Keeps an incoming edge beneath a Loop/Parallel target without hiding it
 * behind that target's parent.
 *
 * Containers use their nesting depth as z-index, so a nested target is exactly
 * one layer above its parent. React Flow renders equal-z edges before nodes;
 * sharing the target's layer therefore leaves the edge visible over the parent
 * body while the target paints over the segment that reaches beneath it.
 *
 * `targetContainerZIndex` must only be supplied when the edge targets a
 * container. Ordinary edges retain their existing depth/highlight ordering.
 */
export function getEdgeZIndexForTarget(
  edgeZIndex: number,
  targetContainerZIndex: number | undefined
): number {
  return targetContainerZIndex ?? edgeZIndex
}
