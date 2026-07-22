/**
 * Fraction of the remaining gap to close per frame while chasing the bottom —
 * an exponential glide (originating in the subagent viewport's stick-to-bottom,
 * see BoundedViewport in agent-group.tsx) instead of snapping `scrollTop` to
 * `scrollHeight` on every content append. Closes ~90% of any gap within ~18
 * frames (~300ms) — deliberately lazier than the subagent viewport's 0.18 so a
 * large content burst reads as a calm upward drift of the transcript rather
 * than a lurch.
 */
export const SMOOTH_CHASE_RATE = 0.12

/** Gap (px) below which the chase parks until new growth reopens it. */
export const CHASE_REST_GAP = 0.5

export interface SmoothBottomChaseTarget {
  /** Current scroll offset. */
  getTop: () => number
  /** Scroll offset at which the viewport bottom meets the content bottom. */
  getBottomTop: () => number
  /** Apply a new scroll offset. */
  setTop: (top: number) => void
}

export interface SmoothBottomChaseHandle {
  /** True while a chase frame is scheduled (gap still closing). */
  isActive: () => boolean
  /** Start the loop if parked. Call after content growth. */
  kick: () => void
  /**
   * Keep the loop alive for `durationMs` even while the gap is at rest,
   * re-checking every frame. Covers growth that arrives over several frames
   * with no observable trigger — a CSS height animation, or a virtualizer
   * re-measure settling after streaming stops. Repeat calls extend the
   * deadline; there is never more than one loop.
   */
  kickUntil: (durationMs: number) => void
  cancel: () => void
}

/**
 * Eased stick-to-bottom chase over any scrollable target (a DOM element or an
 * editor API like Monaco's). Each frame closes {@link SMOOTH_CHASE_RATE} of the
 * remaining gap and self-parks at {@link CHASE_REST_GAP}; content growth
 * restarts it via `kick()`.
 *
 * Self-interrupting: chase writes only ever move the offset down, and content
 * growth leaves it where the last write put it — so an offset that moved UP
 * since the last write can only be a user scrolling away, and the loop parks
 * instead of fighting them. `shouldContinue` layers any caller-owned stickiness
 * on top (checked every frame).
 */
export function createSmoothBottomChase(
  target: SmoothBottomChaseTarget,
  shouldContinue: () => boolean = () => true
): SmoothBottomChaseHandle {
  let raf: number | null = null
  let lastTop: number | null = null
  let deadline = 0

  const park = () => {
    if (raf !== null) cancelAnimationFrame(raf)
    raf = null
    lastTop = null
  }

  const step = () => {
    // `raf` deliberately keeps this (already-fired) frame's id while the step
    // body runs: canceling a fired handle is a no-op, and a non-null `raf`
    // means `isActive()` stays true and a reentrant `kick()` — e.g. from a
    // target whose `setTop` fires synchronous scroll listeners, like Monaco's
    // onDidScrollChange — cannot start a second parallel chain.
    if (!shouldContinue()) {
      park()
      return
    }
    const top = target.getTop()
    if (lastTop !== null && top < lastTop - 1) {
      park()
      return
    }
    const gap = target.getBottomTop() - top
    if (gap <= CHASE_REST_GAP) {
      // Within a kickUntil deadline the loop idles at rest instead of parking,
      // so growth in the deadline window is chased without a fresh trigger.
      if (performance.now() >= deadline) {
        park()
        return
      }
      lastTop = top
      raf = requestAnimationFrame(step)
      return
    }
    target.setTop(top + Math.max(1, gap * SMOOTH_CHASE_RATE))
    // A synchronous side-effect of `setTop` may have called `cancel()`; honor
    // it instead of re-queuing over it.
    if (raf === null) return
    lastTop = target.getTop()
    raf = requestAnimationFrame(step)
  }

  return {
    isActive: () => raf !== null,
    kick: () => {
      if (raf === null) raf = requestAnimationFrame(step)
    },
    kickUntil: (durationMs: number) => {
      deadline = Math.max(deadline, performance.now() + durationMs)
      if (raf === null) raf = requestAnimationFrame(step)
    },
    cancel: park,
  }
}
