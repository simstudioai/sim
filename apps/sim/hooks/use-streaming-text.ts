'use client'

import { useEffect, useRef, useState } from 'react'

const TICK_MS = 16
const MIN_CHARS_PER_TICK = 3
const CHASE_FACTOR = 0.3
const RESUME_IDLE_MS = 140
const RESUME_RAMP_MS = 180

function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t))
  return 1 - (1 - clamped) ** 3
}

/**
 * Progressively reveals streaming text character-by-character at a steady
 * rate regardless of how the data arrives.
 *
 * Small deltas (individual tokens) reveal at the base rate of 3 chars per
 * 16 ms. Large gaps (burst arrivals) catch up exponentially via
 * CHASE_FACTOR so the reveal never falls far behind.
 *
 * When `isStreaming` is false the target is returned directly.
 */
export function useStreamingText(target: string, isStreaming: boolean): string {
  const [displayed, setDisplayed] = useState(target)
  const revealedRef = useRef(target)
  const targetRef = useRef(target)
  const lastTargetLengthRef = useRef(target.length)
  const lastTargetChangeAtRef = useRef(Date.now())
  const resumeStartedAtRef = useRef<number | null>(null)

  targetRef.current = target

  useEffect(() => {
    const now = Date.now()
    const previousLength = lastTargetLengthRef.current
    const nextLength = target.length

    if (nextLength > previousLength) {
      const idleFor = now - lastTargetChangeAtRef.current
      if (isStreaming && idleFor >= RESUME_IDLE_MS) {
        resumeStartedAtRef.current = now
      }
      lastTargetChangeAtRef.current = now
    } else if (nextLength < previousLength) {
      lastTargetChangeAtRef.current = now
      resumeStartedAtRef.current = null
    }

    lastTargetLengthRef.current = nextLength
  }, [target, isStreaming])

  useEffect(() => {
    if (isStreaming) return
    if (revealedRef.current === target) return
    revealedRef.current = target
    lastTargetChangeAtRef.current = Date.now()
    lastTargetLengthRef.current = target.length
    resumeStartedAtRef.current = null
    setDisplayed(target)
  }, [target, isStreaming])

  useEffect(() => {
    if (!isStreaming) return

    if (targetRef.current.length < revealedRef.current.length) {
      revealedRef.current = ''
    }

    const timer = setInterval(() => {
      const now = Date.now()
      const current = revealedRef.current
      const tgt = targetRef.current
      if (current.length >= tgt.length) return

      const gap = tgt.length - current.length
      const normalChars = Math.max(MIN_CHARS_PER_TICK, Math.ceil(gap * CHASE_FACTOR))

      let chars = normalChars
      const resumeStartedAt = resumeStartedAtRef.current
      if (resumeStartedAt !== null) {
        const progress = easeOutCubic((now - resumeStartedAt) / RESUME_RAMP_MS)
        chars = Math.max(MIN_CHARS_PER_TICK, Math.ceil(normalChars * progress))
        if (progress >= 1) {
          resumeStartedAtRef.current = null
        }
      }

      chars = Math.min(gap, chars)
      revealedRef.current = tgt.slice(0, current.length + chars)
      setDisplayed(revealedRef.current)
    }, TICK_MS)

    return () => clearInterval(timer)
  }, [isStreaming])

  return displayed
}
