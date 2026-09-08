import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import Link from 'next/link'
import { LANDING_STAGE_RADIUS } from '@/app/(landing)/components/landing-layout'

interface CoreFeatureCardProps {
  title: string
  description: string
  href: string
  visual: ReactNode
  interactiveVisual?: boolean
  tone?: 'light' | 'mid' | 'dark'
}

const TONE_CLASSES = {
  light: 'bg-[var(--surface-3)]',
  mid: 'bg-[var(--surface-5)]',
  dark: 'bg-[var(--text-secondary)]',
} as const

/**
 * Lets a horizontal gesture over the illustration reach the rail underneath.
 *
 * The graphics crop themselves with `overflow-hidden`, which makes every crop
 * box a scroll container, and the global base rule gives every element
 * `overscroll-behavior-x: none`. A trackpad swipe or horizontal wheel landing
 * anywhere on the stage would otherwise stop dead at the first crop it hits
 * instead of chaining out to the scroller, so the rail only scrolled from the
 * caption below the stage. Nothing inside the stage scrolls on its own, so
 * chaining out is always right, and the rail's own `overscroll-x-contain`
 * still keeps the gesture from running on into the page.
 */
const SCROLL_THROUGH = 'overscroll-x-auto [&_*]:overscroll-x-auto'

/**
 * One homepage product module: a tall product-UI stage followed by a compact,
 * independently quotable title and description. Interactive illustrations sit outside the route link;
 * decorative illustrations remain part of the linked module.
 */
export function CoreFeatureCard({
  title,
  description,
  href,
  visual,
  interactiveVisual = false,
  tone = 'light',
}: CoreFeatureCardProps) {
  const graphic = (
    <div
      aria-hidden={interactiveVisual ? undefined : true}
      className={cn(
        'relative aspect-[5/6] overflow-hidden border border-[var(--border)] transition-colors duration-300 group-hover:border-[var(--border)] motion-reduce:transition-none',
        LANDING_STAGE_RADIUS,
        SCROLL_THROUGH,
        TONE_CLASSES[tone]
      )}
    >
      <div className='absolute inset-0'>{visual}</div>
    </div>
  )
  return (
    <article className='min-w-0'>
      {interactiveVisual ? graphic : null}
      <Link
        href={href}
        rel={href.startsWith('https://') ? 'noopener noreferrer' : undefined}
        className='group block outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--border)] focus-visible:outline-offset-4'
      >
        {interactiveVisual ? null : graphic}
        <h3 className='mt-5 text-[20px] text-[var(--text-primary)] leading-[1.25] tracking-[-0.01em]'>
          {title}
        </h3>
        <p className='mt-2 max-w-[36ch] text-pretty text-[15px] text-[var(--text-body)] leading-[1.45]'>
          {description}
        </p>
      </Link>
    </article>
  )
}
