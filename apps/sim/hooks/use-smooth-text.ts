import { useEffect, useRef, useState } from 'react'

/**
 * Paced reveal of a growing string, ported from opencode's `createPacedValue`
 * (`packages/ui/src/components/message-part.tsx`). Instead of revealing a fixed
 * number of characters per animation frame, it advances on a steady ~24ms timer
 * in small tiered steps that SNAP to the next word/punctuation boundary — so
 * text appears word-by-word at a calm, even cadence regardless of how bursty the
 * upstream model deltas are. The boundary snapping is what keeps it from reading
 * as "blocky": a reveal never stops mid-word.
 */
const PACE_MS = 24
const SNAP = /[\s.,!?;:)\]]/

/**
 * Characters to advance per tick as a function of how far the reveal is behind.
 * Small backlogs trickle (2–8 chars); large backlogs accelerate but stay capped
 * so a burst is spread over several ticks rather than dumped at once.
 */
function step(remaining: number): number {
  if (remaining <= 12) return 2
  if (remaining <= 48) return 4
  if (remaining <= 96) return 8
  return Math.min(24, Math.ceil(remaining / 8))
}

/**
 * Advance from `start` by `step(...)`, then extend up to 8 more characters to
 * land just past the next word/punctuation boundary so the reveal lands on a
 * whole word rather than mid-token.
 */
function nextIndex(text: string, start: number): number {
  const end = Math.min(text.length, start + step(text.length - start))
  const max = Math.min(text.length, end + 8)
  for (let i = end; i < max; i++) {
    if (SNAP.test(text[i] ?? '')) return i + 1
  }
  return end
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
 * `timeoutRef === null` guard instead of keying on a `hasBacklog` dependency.
 * The tick chain self-terminates whenever the reveal catches up, and a chain
 * keyed on the `hasBacklog` boolean could die for good: when the final tick's
 * `setRevealed` and a new chunk land in the same React commit, `hasBacklog`
 * stays `true` across commits, the effect never re-fires, and the reveal
 * freezes mid-stream until remount. Re-arming per render closes that
 * interleaving while still avoiding per-chunk timer teardown (no cleanup on
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
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    const run = () => {
      timeoutRef.current = null
      const text = contentRef.current
      const target = text.length

      if (revealedRef.current > target) {
        revealedRef.current = target
        setRevealed(target)
      }
      const current = revealedRef.current
      if (current >= target) return

      const next = nextIndex(text, current)
      revealedRef.current = next
      setRevealed(next)
      if (next < target) {
        timeoutRef.current = setTimeout(run, PACE_MS)
      }
    }

    if (hasBacklog && timeoutRef.current === null) {
      timeoutRef.current = setTimeout(run, PACE_MS)
    }
  })

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    },
    []
  )

  if (effectiveRevealed >= content.length) return content
  return content.slice(0, effectiveRevealed)
}
