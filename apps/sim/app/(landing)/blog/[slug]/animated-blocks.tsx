'use client'

import { useEffect, useRef, useState } from 'react'

const COLORS = ['#2ABBF8', '#FA4EDF', '#FFCC02', '#00F701'] as const

const ENTER_STAGGER_MS = 60
const ENTER_DURATION_MS = 300
const HOLD_MS = 3000
const EXIT_STAGGER_MS = 120
const EXIT_DURATION_MS = 500

const RE_ENTER_OPACITIES = [1, 0.8, 0.6, 0.9] as const

function setBlockOpacity(el: HTMLSpanElement | null, opacity: number, animate: boolean) {
  if (!el) return
  el.style.transition = animate ? `opacity ${ENTER_DURATION_MS}ms ease-out` : 'none'
  el.style.opacity = String(opacity)
}

export function AnimatedColorBlocks() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const blockRefs = useRef<(HTMLSpanElement | null)[]>([])
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const mounted = useRef(true)

  function schedule(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      timers.current = timers.current.filter((timerId) => timerId !== id)
      fn()
    }, ms)
    timers.current.push(id)
    return id
  }

  useEffect(() => {
    mounted.current = true
    timers.current = []

    if (prefersReducedMotion) {
      blockRefs.current.forEach((el) => setBlockOpacity(el, 1, false))
      return () => {
        mounted.current = false
        timers.current.forEach(clearTimeout)
        timers.current = []
      }
    }

    blockRefs.current.forEach((el) => setBlockOpacity(el, 0, false))

    COLORS.forEach((_, i) => {
      schedule(() => {
        if (!mounted.current) return
        setBlockOpacity(blockRefs.current[i], 1, true)
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
        setBlockOpacity(blockRefs.current[i], 0.15, true)
      }, i * EXIT_STAGGER_MS)
    })

    const exitTotalMs = COLORS.length * EXIT_STAGGER_MS + EXIT_DURATION_MS
    schedule(() => {
      if (!mounted.current) return
      COLORS.forEach((_, i) => {
        schedule(() => {
          if (!mounted.current) return
          setBlockOpacity(blockRefs.current[i], RE_ENTER_OPACITIES[i], true)
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
          ref={(el) => {
            blockRefs.current[i] = el
          }}
          className='inline-block h-3 w-3'
          style={{ backgroundColor: color, opacity: prefersReducedMotion ? 1 : 0 }}
        />
      ))}
    </div>
  )
}

export function AnimatedColorBlocksVertical() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const blockRefs = useRef<(HTMLSpanElement | null)[]>([])
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const mounted = useRef(true)

  const verticalColors = [COLORS[0], COLORS[1], COLORS[2]] as const

  function schedule(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      timers.current = timers.current.filter((timerId) => timerId !== id)
      fn()
    }, ms)
    timers.current.push(id)
    return id
  }

  useEffect(() => {
    mounted.current = true
    timers.current = []

    if (prefersReducedMotion) {
      blockRefs.current.forEach((el) => setBlockOpacity(el, 1, false))
      return () => {
        mounted.current = false
        timers.current.forEach(clearTimeout)
        timers.current = []
      }
    }

    blockRefs.current.forEach((el) => setBlockOpacity(el, 0, false))

    const baseDelay = COLORS.length * ENTER_STAGGER_MS + 100

    verticalColors.forEach((_, i) => {
      schedule(
        () => {
          if (!mounted.current) return
          setBlockOpacity(blockRefs.current[i], 1, true)
        },
        baseDelay + i * ENTER_STAGGER_MS
      )
    })

    return () => {
      mounted.current = false
      timers.current.forEach(clearTimeout)
      timers.current = []
    }
  }, [prefersReducedMotion])

  return (
    <div className='flex flex-col gap-0' aria-hidden='true'>
      {verticalColors.map((color, i) => (
        <span
          key={color}
          ref={(el) => {
            blockRefs.current[i] = el
          }}
          className='inline-block h-3 w-3'
          style={{ backgroundColor: color, opacity: prefersReducedMotion ? 1 : 0 }}
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
