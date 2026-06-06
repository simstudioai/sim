import { useEffect, useRef, useState } from 'react'

/**
 * Per-frame reveal speed is proportional to how far behind the display is, so a
 * large burst drains quickly while a trickle reveals gently. `target / DIVISOR`
 * gives an ease-out feel; the clamps keep it from stalling or jumping.
 */
const REVEAL_DIVISOR = 6
const MIN_STEP = 1
const MAX_STEP = 400

/**
 * Content already longer than this at mount is assumed to be an in-progress
 * resume (or restored history), so it is shown immediately rather than replayed
 * from the first character.
 */
const RESUME_SKIP_THRESHOLD = 60

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
 * Paces a growing string so it reveals at a steady cadence regardless of how
 * bursty the upstream stream is — the client-side analogue of the AI SDK's
 * `smoothStream`. Returns the portion of `content` that should be displayed now.
 *
 * While `isStreaming` is false the full string is returned unchanged (history
 * and completed turns never animate). When streaming ends mid-reveal the
 * remaining tail is shown immediately so nothing is left hidden.
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
  const streamingRef = useRef(isStreaming)
  const revealedRef = useRef(revealed)
  const frameRef = useRef<number | null>(null)
  const prevContentRef = useRef(content)

  // A non-append rewrite (e.g. a patch replacing earlier text) must be shown in
  // full at once — re-revealing a prefix of rewritten content would look like
  // the document is retyping itself. Adjust during render so the slice below
  // never flashes a stale prefix.
  let effectiveRevealed = revealed
  if (
    snapOnNonAppend &&
    content !== prevContentRef.current &&
    !content.startsWith(prevContentRef.current) &&
    revealed < content.length
  ) {
    effectiveRevealed = content.length
    revealedRef.current = content.length
    setRevealed(content.length)
  }
  prevContentRef.current = content

  contentRef.current = content
  streamingRef.current = isStreaming

  useEffect(() => {
    if (!isStreaming) {
      revealedRef.current = content.length
      setRevealed(content.length)
      return
    }

    const tick = () => {
      const target = contentRef.current.length
      // Upstream sanitization can rewrite earlier text and shrink the string;
      // pull the cursor back to the new end so regrowth stays paced rather than
      // jumping past it.
      if (revealedRef.current > target) {
        revealedRef.current = target
        setRevealed(target)
      }
      const current = revealedRef.current

      if (!streamingRef.current) {
        revealedRef.current = target
        setRevealed(target)
        frameRef.current = null
        return
      }
      if (current >= target) {
        frameRef.current = null
        return
      }

      const backlog = target - current
      const step = Math.min(MAX_STEP, Math.max(MIN_STEP, Math.ceil(backlog / REVEAL_DIVISOR)))
      const next = current + step
      revealedRef.current = next
      setRevealed(next)
      frameRef.current = window.requestAnimationFrame(tick)
    }

    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(tick)
    }

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [content, isStreaming])

  // Content can shrink when upstream sanitization rewrites earlier text; never
  // hand back a slice index past the current end.
  if (effectiveRevealed >= content.length) return content
  return content.slice(0, effectiveRevealed)
}
