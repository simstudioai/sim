'use client'

import { useEffect, useState } from 'react'
import { cn } from '@sim/emcn'
import styles from '@/app/(landing)/components/hero/components/hero-stat/hero-stat.module.css'

const STAT_VALUE = '0.00000206%'
/** The last-three-digit count-up range: 000 -> 206 (Stripe-style iterate). */
const COUNT_FROM = 0
const COUNT_TO = 206
/** Duration of the count-up once it starts. */
const COUNT_DUR_MS = 1100
/** The LIGHT-GREY placeholder zeros the number staggers in as, char by char. */
const START_CHARS = `0.00000${String(COUNT_FROM).padStart(3, '0')}%`.split('')
/**
 * When the per-character stagger has fully landed (last char starts at 700ms
 * + its 500ms fade - see hero-stat.module.css).
 */
const CHARS_IN_AT_MS = 1200
/**
 * The settle beat starts once the character stagger completes, plus a short
 * hold so the number reads before it rises.
 */
const SETTLE_AT_MS = CHARS_IN_AT_MS + 150
/**
 * The label reveal waits until the rising number (500ms ease-out) has cleared
 * the label's row, so the two never overlap mid-flight.
 */
const REVEAL_AT_MS = SETTLE_AT_MS + 400
/** The dark fill grows in last, once the label's fade-up has finished. */
const FILL_AT_MS = REVEAL_AT_MS + 350

/**
 * The hero's right-side stat, with a staggered page-load entrance in four
 * beats: the number appears at the bottom of the stat as LIGHT-GREY
 * placeholder zeros - the leading "0" fades in first, then each following
 * character staggers in left to right - alongside the progress rail (short,
 * bottom-anchored, spanning exactly the number's 18px line), the number rises
 * into its final slot while the rail GROWS upward at the same rate (same
 * duration + easing, so its top edge tracks the number's top), then the
 * "Global work done by Sim" label fades up beneath it while the number
 * DARKENS to `--text-primary` and the last digits COUNT UP 000 -> 206
 * (Stripe-style, ease-out so the ticks slow into the final value), and
 * finally the dark progress fill grows up from the rail's foot.
 *
 * Under `prefers-reduced-motion` everything renders settled immediately (the
 * fades are also disabled in the CSS module).
 */
export function HeroStat() {
  const [settled, setSettled] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [filled, setFilled] = useState(false)
  const [count, setCount] = useState(COUNT_FROM)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let raf = 0
    let settleTimer: ReturnType<typeof setTimeout>
    let revealTimer: ReturnType<typeof setTimeout>
    let fillTimer: ReturnType<typeof setTimeout>
    let countTimer: ReturnType<typeof setTimeout>

    const clearScheduled = () => {
      clearTimeout(settleTimer)
      clearTimeout(revealTimer)
      clearTimeout(fillTimer)
      clearTimeout(countTimer)
      cancelAnimationFrame(raf)
    }

    const showSettled = () => {
      clearScheduled()
      setSettled(true)
      setRevealed(true)
      setFilled(true)
      setCount(COUNT_TO)
    }

    const runEntrance = () => {
      setSettled(false)
      setRevealed(false)
      setFilled(false)
      setCount(COUNT_FROM)
      settleTimer = setTimeout(() => setSettled(true), SETTLE_AT_MS)
      revealTimer = setTimeout(() => setRevealed(true), REVEAL_AT_MS)
      fillTimer = setTimeout(() => setFilled(true), FILL_AT_MS)
      countTimer = setTimeout(() => {
        const start = performance.now()
        const tick = (now: number) => {
          const t = Math.min((now - start) / COUNT_DUR_MS, 1)
          const eased = 1 - (1 - t) ** 3
          setCount(Math.round(COUNT_FROM + (COUNT_TO - COUNT_FROM) * eased))
          if (t < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      }, REVEAL_AT_MS)
    }

    // Re-synced on 'change' - not just on mount - so toggling the preference
    // mid-entrance snaps straight to the settled state instead of leaving the
    // stagger/count-up to keep running on its own clock.
    const syncMotionPreference = () => {
      clearScheduled()
      if (media.matches) {
        showSettled()
        return
      }
      runEntrance()
    }

    syncMotionPreference()
    media.addEventListener('change', syncMotionPreference)
    return () => {
      media.removeEventListener('change', syncMotionPreference)
      clearScheduled()
    }
  }, [])

  return (
    <div className='flex w-fit shrink-0 items-stretch gap-3 max-lg:hidden'>
      <div aria-hidden='true' className={cn('relative w-[2px]', styles.fadeIn)}>
        <div
          className={cn(
            'absolute inset-x-0 bottom-0 flex flex-col justify-end rounded-full bg-[var(--surface-6)] transition-[top] duration-500',
            settled ? 'top-0' : 'top-[calc(100%-18px)]'
          )}
        >
          <div
            className={cn(
              'w-full rounded-full bg-[var(--text-body)] transition-[height] duration-300',
              filled ? 'h-[4px]' : 'h-0'
            )}
          />
        </div>
      </div>
      <div className='flex flex-col gap-1.5'>
        <p
          className={cn(
            'text-[18px] tabular-nums leading-none transition-[transform,color] duration-500',
            settled ? 'translate-y-0' : 'translate-y-[20px]',
            revealed ? 'text-[var(--text-primary)]' : 'text-[var(--surface-7)]'
          )}
        >
          <span className='sr-only'>{STAT_VALUE}</span>
          <span aria-hidden='true'>
            {revealed
              ? `0.00000${String(count).padStart(3, '0')}%`
              : START_CHARS.map((ch, i) => (
                  <span key={i} className={styles.char}>
                    {ch}
                  </span>
                ))}
          </span>
        </p>
        <p
          className={cn(
            'text-[var(--text-muted)] text-sm leading-none transition-[opacity,transform] duration-300',
            revealed ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
          )}
        >
          Global work done by Sim
        </p>
      </div>
    </div>
  )
}
