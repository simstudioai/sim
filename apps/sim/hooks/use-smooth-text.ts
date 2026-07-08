import { useEffect, useRef, useState } from 'react'

/**
 * Time-based paced reveal of a growing string. A per-frame loop earns a
 * character budget from elapsed time and releases text one word/punctuation
 * boundary at a time — so words appear individually, evenly spaced on the
 * timeline, instead of the old fixed-interval tick that dumped a multi-word
 * chunk every 24ms and read as blocky.
 *
 * The rate is a proportional controller: drain the current backlog over
 * {@link DRAIN_HORIZON_MS}. It therefore converges on the stream's real
 * arrival rate — a fast stream reveals fast, a slow one trickles — instead of
 * racing ahead at a fixed cap, emptying the backlog, and stalling until the
 * next network burst (the old burst–pause rhythm).
 */
const SNAP = /[\s.,!?;:)\]]/

/** Reveal the backlog over roughly this horizon (a small jitter buffer). */
const DRAIN_HORIZON_MS = 400
/** Floor so a near-empty backlog still trickles out instead of freezing. */
const MIN_CPS = 45
/** Cap so a huge backlog (resume, giant paste) sweeps in over ~a second. */
const MAX_CPS = 2400

/** Chars/second that drains `remaining` over the horizon, clamped. */
function drainRate(remaining: number): number {
  return Math.min(MAX_CPS, Math.max(MIN_CPS, (remaining * 1000) / DRAIN_HORIZON_MS))
}

/**
 * The furthest word/punctuation boundary within `start + budget`, or `start`
 * when the budget doesn't yet cover the next whole word (the budget carries
 * over to later frames). Words longer than the 24-char lookahead are released
 * whole once the budget covers the lookahead, so an unbroken token (a URL, a
 * long identifier) cannot dam the reveal.
 */
function nextIndex(text: string, start: number, budget: number): number {
  const limit = Math.min(text.length, start + Math.floor(budget))
  for (let i = limit; i > start; i--) {
    if (SNAP.test(text[i - 1] ?? '')) return i
  }
  if (limit >= Math.min(text.length, start + 24)) return limit
  return start
}

/**
 * Content already longer than this when streaming begins is assumed to be
 * pre-existing (an in-progress resume, restored history, or an in-place edit
 * of an existing document), so it is shown immediately rather than replayed
 * from the first character. Consumers gating reveal animations should use the
 * same threshold so pacing and animation agree on what counts as "new".
 */
export const RESUME_SKIP_THRESHOLD = 60

interface SmoothTextOptions {
  /**
   * When a content update is not a continuation of the previous string (the new
   * value does not start with the old one — e.g. an in-place patch/rewrite
   * rather than an append), show it in full immediately instead of re-revealing
   * a prefix. Keeps diff/patch previews correct while still pacing ordinary
   * append streams. Defaults to `false`, which keeps the original
   * pull-back-on-shrink behavior used by the chat.
   */
  snapOnNonAppend?: boolean
}

/**
 * Paces a growing string so it reveals word-by-word at a steady cadence
 * regardless of how bursty the upstream stream is — a React port of opencode's
 * paced text rendering. Returns the portion of `content` that should be
 * displayed now.
 *
 * Content that is already complete at mount (history, or a resume past
 * {@link RESUME_SKIP_THRESHOLD}) is returned in full and never animates. When a
 * live stream ends mid-reveal the remaining tail keeps draining at the paced
 * cadence rather than snapping — so the reveal stays smooth right to the end and
 * the caller can hold its streaming render until `useSmoothText` reports the
 * full string, avoiding a flash on the streaming→static handoff.
 *
 * @remarks
 * The re-arm effect runs on every committed render with a cheap
 * `rafRef === null` guard instead of keying on a `hasBacklog` dependency.
 * The frame chain self-terminates whenever the reveal catches up, and a chain
 * keyed on the `hasBacklog` boolean could die for good: when the final frame's
 * `setRevealed` and a new chunk land in the same React commit, `hasBacklog`
 * stays `true` across commits, the effect never re-fires, and the reveal
 * freezes mid-stream until remount. Re-arming per render closes that
 * interleaving while still avoiding per-chunk loop teardown (no cleanup on
 * content changes), so it cannot trip React's max-update-depth guard either.
 * If upstream sanitization rewrites earlier text and shrinks the string, the
 * cursor is pulled back to the new end so regrowth stays paced instead of
 * jumping past it.
 */
export function useSmoothText(
  content: string,
  isStreaming: boolean,
  options?: SmoothTextOptions
): string {
  const snapOnNonAppend = options?.snapOnNonAppend ?? false

  const [revealed, setRevealed] = useState(() =>
    isStreaming && content.length <= RESUME_SKIP_THRESHOLD ? 0 : content.length
  )

  const contentRef = useRef(content)
  const revealedRef = useRef(revealed)
  const rafRef = useRef<number | null>(null)
  /** Fractional character budget carried between frames (see the frame loop). */
  const budgetRef = useRef(0)
  const lastFrameAtRef = useRef(0)
  const prevContentRef = useRef(content)
  const prevIsStreamingRef = useRef(isStreaming)

  let effectiveRevealed = revealed

  if (
    isStreaming &&
    !prevIsStreamingRef.current &&
    content.length > RESUME_SKIP_THRESHOLD &&
    revealed < content.length
  ) {
    effectiveRevealed = content.length
    revealedRef.current = content.length
    setRevealed(content.length)
  }

  if (
    snapOnNonAppend &&
    content !== prevContentRef.current &&
    !content.startsWith(prevContentRef.current) &&
    effectiveRevealed < content.length
  ) {
    effectiveRevealed = content.length
    revealedRef.current = content.length
    setRevealed(content.length)
  }

  contentRef.current = content

  const hasBacklog = effectiveRevealed < content.length

  // Advance the previous-input trackers on commit, never during render. A concurrent render can be
  // started and then thrown away before it commits (interrupted by a higher-priority update); a
  // render-phase write persists on that discarded attempt, so the retried render would read a stale
  // `prev` and skip the snap. Updating them in a committed effect keeps `prev` in lockstep with the
  // render that actually committed, so the snap decision is identical across discarded attempts.
  useEffect(() => {
    prevContentRef.current = content
    prevIsStreamingRef.current = isStreaming
  }, [content, isStreaming])

  useEffect(() => {
    /**
     * Per-frame reveal: each frame earns `drainRate * dt` characters of budget
     * (fractional remainder carried in `budgetRef`), and the cursor advances to
     * the furthest word boundary the budget covers — releasing words one at a
     * time, evenly spaced in real time, rather than a fixed-size chunk per
     * tick. Frames whose budget doesn't yet cover the next word update nothing.
     */
    const run = (now: number) => {
      rafRef.current = null
      const text = contentRef.current
      const target = text.length

      if (revealedRef.current > target) {
        revealedRef.current = target
        budgetRef.current = 0
        setRevealed(target)
      }
      const current = revealedRef.current
      if (current >= target) return

      // Clamp dt so a background tab's paused rAF doesn't bank a giant budget.
      const dt = Math.min(now - lastFrameAtRef.current, 100)
      lastFrameAtRef.current = now
      budgetRef.current += (drainRate(target - current) * dt) / 1000

      const next = nextIndex(text, current, budgetRef.current)
      if (next > current) {
        budgetRef.current -= next - current
        revealedRef.current = next
        setRevealed(next)
      }
      if (revealedRef.current < target) {
        rafRef.current = requestAnimationFrame(run)
      }
    }

    if (hasBacklog && rafRef.current === null) {
      lastFrameAtRef.current = performance.now()
      rafRef.current = requestAnimationFrame(run)
    }
  })

  useEffect(
    () => () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    },
    []
  )

  if (effectiveRevealed >= content.length) return content
  return content.slice(0, effectiveRevealed)
}
