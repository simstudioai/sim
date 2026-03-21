'use client'

import { useEffect, useRef, useState } from 'react'

const COLORS = ['#2ABBF8', '#FA4EDF', '#FFCC02', '#00F701'] as const

const ENTER_STAGGER_MS = 60
const ENTER_DURATION_MS = 300
const HOLD_MS = 3000
const EXIT_STAGGER_MS = 120
const EXIT_DURATION_MS = 500

interface BlockState {
  opacity: number
  transitioning: boolean
}

export function AnimatedColorBlocks() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const [blocks, setBlocks] = useState<BlockState[]>(
    COLORS.map(() => ({ opacity: prefersReducedMotion ? 1 : 0, transitioning: false }))
  )
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const mounted = useRef(true)

  function schedule(fn: () => void, ms: number) {
    const id = setTimeout(fn, ms)
    timers.current.push(id)
    return id
  }

  useEffect(() => {
    mounted.current = true
    timers.current = []
    if (prefersReducedMotion) return

    COLORS.forEach((_, i) => {
      schedule(() => {
        if (!mounted.current) return
        setBlocks((prev) =>
          prev.map((b, idx) => (idx === i ? { opacity: 1, transitioning: true } : b))
        )
      }, i * ENTER_STAGGER_MS)
    })

    const totalEnterMs = COLORS.length * ENTER_STAGGER_MS + ENTER_DURATION_MS + HOLD_MS
    schedule(() => {
      if (!mounted.current) return
      startCycle()
    }, totalEnterMs)

    return () => {
      mounted.current = false
      timers.current.forEach(clearTimeout)
      timers.current = []
    }
  }, [prefersReducedMotion])

  function startCycle() {
    if (!mounted.current) return

    COLORS.forEach((_, i) => {
      schedule(() => {
        if (!mounted.current) return
        setBlocks((prev) =>
          prev.map((b, idx) => (idx === i ? { opacity: 0.15, transitioning: true } : b))
        )
      }, i * EXIT_STAGGER_MS)
    })

    const exitTotalMs = COLORS.length * EXIT_STAGGER_MS + EXIT_DURATION_MS
    schedule(() => {
      if (!mounted.current) return
      COLORS.forEach((_, i) => {
        schedule(() => {
          if (!mounted.current) return
          setBlocks((prev) =>
            prev.map((b, idx) =>
              idx === i ? { opacity: [1, 0.8, 0.6, 0.9][i], transitioning: true } : b
            )
          )
        }, i * ENTER_STAGGER_MS)
      })
    }, exitTotalMs + 200)

    const cycleDuration =
      exitTotalMs + 200 + COLORS.length * ENTER_STAGGER_MS + ENTER_DURATION_MS + HOLD_MS
    schedule(() => startCycle(), cycleDuration)
  }

  return (
    <div className='flex gap-0' aria-hidden='true'>
      {COLORS.map((color, i) => (
        <span
          key={color}
          className='inline-block h-3 w-3'
          style={{
            backgroundColor: color,
            opacity: blocks[i]?.opacity ?? 0,
            transition: `opacity ${blocks[i]?.transitioning ? ENTER_DURATION_MS : 0}ms ease-out`,
          }}
        />
      ))}
    </div>
  )
}

export function AnimatedColorBlocksVertical() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const [blocks, setBlocks] = useState<BlockState[]>(
    COLORS.slice(0, 3).map(() => ({
      opacity: prefersReducedMotion ? 1 : 0,
      transitioning: false,
    }))
  )
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    timers.current = []
    if (prefersReducedMotion) return

    const baseDelay = COLORS.length * ENTER_STAGGER_MS + 100

    COLORS.slice(0, 3).forEach((_, i) => {
      const id = setTimeout(
        () => {
          if (!mounted.current) return
          setBlocks((prev) =>
            prev.map((b, idx) => (idx === i ? { opacity: 1, transitioning: true } : b))
          )
        },
        baseDelay + i * ENTER_STAGGER_MS
      )
      timers.current.push(id)
    })

    return () => {
      mounted.current = false
      timers.current.forEach(clearTimeout)
      timers.current = []
    }
  }, [prefersReducedMotion])

  const verticalColors = [COLORS[0], COLORS[1], COLORS[2]]

  return (
    <div className='flex flex-col gap-0' aria-hidden='true'>
      {verticalColors.map((color, i) => (
        <span
          key={color}
          className='inline-block h-3 w-3'
          style={{
            backgroundColor: color,
            opacity: blocks[i]?.opacity ?? 0,
            transition: `opacity ${blocks[i]?.transitioning ? ENTER_DURATION_MS : 0}ms ease-out`,
          }}
        />
      ))}
    </div>
  )
}

function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReduced(mq.matches)

    const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return prefersReduced
}
