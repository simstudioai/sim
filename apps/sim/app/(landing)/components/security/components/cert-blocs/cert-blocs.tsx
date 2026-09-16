'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { HOME_TYPE } from '@/app/(landing)/components/landing-layout'
import styles from '@/app/(landing)/components/security/components/cert-blocs/cert-blocs.module.css'
import {
  DetailsArrow,
  GdprMark,
  Iso27001Mark,
  Soc2TypeIiMark,
} from '@/app/(landing)/components/security/icons'

const SCROLL_PORT_SELECTOR = '.overflow-y-auto'
const MARK_STROKES = '[pathLength]'
const CERT_MUTED = 'text-[var(--text-muted)]'

const CERTIFICATIONS = [
  { title: 'SOC 2 Type II', Mark: Soc2TypeIiMark },
  { title: 'ISO 27001', Mark: Iso27001Mark },
  { title: 'GDPR', Mark: GdprMark },
] as const

interface CertBlocsProps {
  href: string
}

const OUTBOUND_LINK = {
  target: '_blank',
  rel: 'noopener noreferrer',
} as const

/** Cancel only the mark's stroke animations, leaving the card's color transitions alone. */
function cancelDraws(scope: Element) {
  for (const stroke of scope.querySelectorAll<SVGGeometryElement>(MARK_STROKES)) {
    for (const animation of stroke.getAnimations?.() ?? []) animation.cancel()
  }
}

/** Replay from the first stroke without remounting the SVG or changing the card's geometry. */
function replayMark(card: HTMLAnchorElement) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const computed = getComputedStyle(card)
  const duration = Number(computed.getPropertyValue('--draw-duration-ms'))
  const detailDelay = Number(computed.getPropertyValue('--detail-delay-ms'))
  cancelDraws(card)

  for (const stroke of card.querySelectorAll<SVGGeometryElement>(MARK_STROKES)) {
    stroke.animate?.([{ strokeDashoffset: '1' }, { strokeDashoffset: '0' }], {
      duration,
      delay: stroke.closest('[data-cert-detail]') ? detailDelay : 0,
      easing: 'ease-out',
      fill: 'backwards',
    })
  }
}

/**
 * Certification cards with a one-time entrance draw and independent hover or
 * keyboard-focus replays. Reduced motion keeps every mark fully drawn.
 */
export function CertBlocs({ href }: CertBlocsProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    const list = listRef.current
    if (!list) return

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const root = list.closest(SCROLL_PORT_SELECTOR)
    let observer: IntersectionObserver | null = null

    const handleMotionPreference = () => {
      if (!media.matches) return
      observer?.disconnect()
      cancelDraws(list)
      setDrawn(true)
    }

    if (media.matches || typeof IntersectionObserver === 'undefined' || !root) {
      setDrawn(true)
    } else {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return
          observer?.disconnect()
          setDrawn(true)
        },
        { root, threshold: 0.3 }
      )
      observer.observe(list)
    }

    media.addEventListener('change', handleMotionPreference)
    return () => {
      observer?.disconnect()
      media.removeEventListener('change', handleMotionPreference)
      cancelDraws(list)
    }
  }, [])

  return (
    <ul
      ref={listRef}
      className={cn(
        'grid grid-cols-3 gap-6 max-sm:grid-cols-1 max-sm:gap-4',
        styles.list,
        drawn && styles.drawn
      )}
    >
      {CERTIFICATIONS.map(({ title, Mark }) => (
        <li key={title}>
          <a
            href={href}
            {...OUTBOUND_LINK}
            onPointerEnter={(event) => {
              if (event.pointerType === 'touch') return
              setDrawn(true)
              replayMark(event.currentTarget)
            }}
            onFocus={(event) => {
              if (!event.currentTarget.matches(':focus-visible')) return
              setDrawn(true)
              replayMark(event.currentTarget)
            }}
            className={cn(
              'group flex aspect-[5/6] flex-col items-center bg-[var(--surface-2)] px-8 pt-10 pb-10 text-center',
              'rounded-[10px] border border-[var(--border)] max-sm:px-6 max-sm:pb-8',
              'transition-[border-color] duration-200 ease-out hover-hover:hover:border-[var(--text-muted)] motion-reduce:transition-none',
              'focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-4'
            )}
          >
            <span className='flex w-full flex-1 items-center justify-center'>
              <Mark
                className={cn(
                  'w-[56%] transition-colors duration-200 ease-out hover-hover:group-hover:text-[var(--text-secondary)] group-focus-visible:text-[var(--text-secondary)] motion-reduce:transition-none',
                  CERT_MUTED,
                  styles.mark
                )}
              />
            </span>
            <span className='text-[18px] text-[var(--text-primary)] leading-[1.3]'>{title}</span>
            <span
              className={cn(
                'mt-2 inline-flex items-center gap-1 text-[var(--text-secondary)]',
                'transition-colors duration-150 ease-out hover-hover:group-hover:text-[var(--text-primary)]',
                HOME_TYPE.meta
              )}
            >
              Details<span className='sr-only'> in the Sim Trust Center</span>
              <DetailsArrow className='size-[12px]' />
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}
