'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { HOME_TYPE } from '@/app/(landing)/components/landing-layout'

const COUNT_DURATION_MS = 900
const METRIC_STAGGER_MS = 120
const NUMBER_FORMATTER = new Intl.NumberFormat('en-US')
const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
})

export interface AgentMomentumMetric {
  value: number
  compact?: boolean
  prefix?: string
  suffix?: string
  description: string
}

interface AgentMomentumMetricsProps {
  metrics: readonly AgentMomentumMetric[]
}

/** Scroll-triggered impact counters that run once, with a reduced-motion fallback. */
export function AgentMomentumMetrics({ metrics }: AgentMomentumMetricsProps) {
  const listRef = useRef<HTMLDListElement>(null)
  const animationFrameRef = useRef<number | null>(null)
  const hasAnimatedRef = useRef(false)
  const [counts, setCounts] = useState(() => metrics.map(() => 0))

  useEffect(() => {
    const list = listRef.current
    if (!list) return

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let observer: IntersectionObserver | null = null

    const finishImmediately = () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      hasAnimatedRef.current = true
      setCounts(metrics.map((metric) => metric.value))
    }

    const animate = () => {
      if (hasAnimatedRef.current) return
      hasAnimatedRef.current = true
      const startedAt = performance.now()

      const tick = (now: number) => {
        let isComplete = true
        const nextCounts = metrics.map((metric, index) => {
          const elapsed = now - startedAt - index * METRIC_STAGGER_MS
          const progress = Math.min(Math.max(elapsed / COUNT_DURATION_MS, 0), 1)
          if (progress < 1) isComplete = false
          const eased = 1 - (1 - progress) ** 4
          return Math.round(metric.value * eased)
        })

        setCounts(nextCounts)
        if (!isComplete) {
          animationFrameRef.current = requestAnimationFrame(tick)
        }
      }

      animationFrameRef.current = requestAnimationFrame(tick)
    }

    if (media.matches) {
      finishImmediately()
    } else if (typeof IntersectionObserver === 'undefined') {
      animate()
    } else {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return
          observer?.disconnect()
          animate()
        },
        { threshold: 0.25 }
      )
      observer.observe(list)
    }

    const handleMotionPreference = () => {
      if (media.matches) {
        observer?.disconnect()
        finishImmediately()
      }
    }

    media.addEventListener('change', handleMotionPreference)
    return () => {
      observer?.disconnect()
      media.removeEventListener('change', handleMotionPreference)
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [metrics])

  return (
    <dl ref={listRef} className='max-lg:mt-14 max-lg:border-[var(--border)] max-lg:border-t'>
      {metrics.map((metric, index) => {
        const isVisible = (counts[index] ?? 0) > 0
        const formatter = metric.compact ? COMPACT_NUMBER_FORMATTER : NUMBER_FORMATTER
        const finalValue = `${metric.prefix ?? ''}${NUMBER_FORMATTER.format(metric.value)}${metric.suffix ?? ''}`
        const formattedValue = `${metric.prefix ?? ''}${formatter.format(counts[index] ?? 0)}${metric.suffix ?? ''}`

        return (
          <div
            key={metric.description}
            className={cn(
              'grid min-h-[190px] grid-cols-[minmax(0,1.35fr)_minmax(10rem,0.65fr)] items-start gap-8 py-8 max-sm:min-h-0 max-sm:grid-cols-1 max-sm:gap-4 max-sm:py-6',
              index > 0 && 'border-[var(--border)] border-t'
            )}
          >
            <dt
              className={cn(
                'order-2 max-w-[19rem] text-balance pt-2 text-[var(--text-secondary)] max-sm:order-2 max-sm:pt-0',
                HOME_TYPE.body
              )}
            >
              {metric.description}
            </dt>
            <dd className='order-1 whitespace-nowrap text-[84px] text-[var(--text-primary)] leading-[0.95] tracking-[-0.045em] max-sm:text-[52px] max-xl:text-[68px]'>
              <span className='sr-only'>{finalValue}</span>
              <span
                aria-hidden='true'
                className={cn(
                  'inline-block origin-left tabular-nums transition-[opacity,transform] duration-500 ease-out motion-reduce:transform-none motion-reduce:opacity-100 motion-reduce:transition-none',
                  isVisible
                    ? 'translate-y-0 scale-100 opacity-100'
                    : 'translate-y-3 scale-95 opacity-0'
                )}
              >
                {formattedValue}
              </span>
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
