'use client'

import { type ComponentType, useState } from 'react'
import { cn } from '@sim/emcn'
import Link from 'next/link'
import {
  HOME_INSET,
  HOME_TYPE,
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
} from '@/app/(landing)/components/landing-layout'
import { PlacementFrame } from '@/app/(landing)/components/placement-frame'
import {
  IsoIntegrateIllustration,
  IsoMonitorIllustration,
  type IsoTone,
} from '@/app/(landing)/components/platform-suite/components/iso-marks'
import type { ProductPreviewKind } from '@/app/(landing)/components/shared/product-preview'
import { ProductWindow } from '@/app/(landing)/components/shared/product-window'

/**
 * Enterprise platform section pairing agent creation with centralized
 * governance. Each card opens with an iso mark above its copy - Integrate on
 * the build card, Monitor on the govern card, toned to the card's ground -
 * and carries its own product scene anchored under the copy (Sim's chat
 * building a workflow on the real stage; the organization's overview with
 * spend against budget), so the two never meet whatever the card's height. Hovering a card widens it and
 * fades the other card's content back. The card is a block, not a link: the
 * title's link stretches over the whole card, so the card stays one click
 * while the scene inside it - whose chat reply links its workflow - never
 * nests an anchor in an anchor.
 *
 * The pair never inverts. In the dark theme the build card stays the darker
 * of the two (`--surface-3` under the govern card's `--surface-5`), its copy
 * takes the page's light inks, and both marks keep light contours.
 */

/** The marks' size in the cards, a step under the 180px they had on the main branch's overview. */
const MARK_SIZE = 112
/**
 * The marks' drawings sit inside a padded box; this pulls the box left so the
 * drawing's edge lands on the copy's left edge.
 */
const MARK_PLACEMENT = 'pointer-events-none -ml-2'
/** Hover: the hovered card takes this share of the row's grow, the other card fades. */
const GROW_HOVERED = 'md:grow-[1.25]'
const GROW_IDLE = 'md:grow-[0.75]'
const CONTENT_IDLE = 'opacity-40'
/**
 * The window is sized from the ROW (the cards' container), not its card:
 * 135% of a resting half-width card, so it stays one size while the cards
 * trade width on hover and always bleeds past its card's right and bottom
 * edges - an aspect-locked window sized from a narrowing card would shrink
 * and leave the card's ground showing under it. Stacked below `md`, a card
 * is the row, so the same 135% applies.
 */
const WINDOW_PLACEMENT = 'top-0 left-8 w-[135cqw] max-sm:left-5 md:w-[67.5cqw]'

interface PlatformSuiteCard {
  href: string
  headingId: string
  name: string
  description: string
  tone: 'mid' | 'dark'
  preview: ProductPreviewKind
  /** Decorative iso mark above the copy. */
  Mark: ComponentType<{ size?: number; tone?: IsoTone; className?: string }>
}

const CARDS: readonly PlatformSuiteCard[] = [
  {
    href: '/workflows',
    headingId: 'platform-build',
    name: 'Build agents',
    description: 'Create and deploy agents through chat, a visual canvas, or code.',
    tone: 'dark',
    preview: 'agents',
    Mark: IsoIntegrateIllustration,
  },
  {
    href: '/enterprise',
    headingId: 'platform-govern',
    name: 'Govern at scale',
    description: 'Control access, models, spend, and performance from one place.',
    tone: 'mid',
    preview: 'governance',
    Mark: IsoMonitorIllustration,
  },
] as const

export function PlatformSuite() {
  const [hoveredCard, setHoveredCard] = useState<number | null>(null)

  return (
    <section
      id='platform'
      aria-labelledby='platform-heading'
      className={cn('flex flex-col', LANDING_CONTENT_WIDTH, LANDING_GUTTER)}
    >
      <div className={cn(HOME_INSET, 'flex flex-col gap-20 max-sm:gap-10 max-lg:gap-14')}>
        <div className='flex flex-col items-center gap-8 text-center max-sm:gap-5'>
          <h2
            id='platform-heading'
            className={cn('text-balance text-[var(--text-primary)]', HOME_TYPE.h2Display)}
          >
            One Platform for every AI Agent
          </h2>
          <p className={cn('max-w-[48rem] text-balance text-[var(--text-body)]', HOME_TYPE.body)}>
            Build and deploy agents in one collaborative workspace, with centralized control over
            access, spend, data, and performance.
          </p>
        </div>

        <div className='flex flex-col gap-4 overflow-hidden [container-type:inline-size] md:flex-row lg:aspect-[2/1]'>
          {CARDS.map((card, index) => {
            const dark = card.tone === 'dark'
            const idle = hoveredCard !== null && hoveredCard !== index
            return (
              <div
                key={card.name}
                data-platform-card={index}
                data-iso-hover=''
                onMouseEnter={() => setHoveredCard(index)}
                onMouseLeave={() => setHoveredCard(null)}
                onFocus={() => setHoveredCard(index)}
                onBlur={() => setHoveredCard(null)}
                className={cn(
                  'relative flex min-h-[420px] flex-col overflow-hidden rounded-[12px] motion-reduce:transition-none max-sm:min-h-[360px] md:basis-0 md:transition-[flex-grow] lg:min-h-0 md:[transition-duration:280ms] md:[transition-timing-function:cubic-bezier(0.22,1,0.36,1)]',
                  hoveredCard === null && 'md:grow',
                  hoveredCard === index && GROW_HOVERED,
                  idle && GROW_IDLE
                )}
              >
                <PlacementFrame tone={card.tone} className='absolute inset-0' />
                <div
                  data-platform-card-content=''
                  className={cn(
                    'relative flex flex-1 flex-col transition-opacity duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                    idle && CONTENT_IDLE
                  )}
                >
                  <div className='flex max-w-[20rem] flex-col gap-3 px-8 pt-8'>
                    <card.Mark
                      size={MARK_SIZE}
                      tone={dark ? 'dark' : 'light'}
                      className={MARK_PLACEMENT}
                    />
                    <h3
                      id={card.headingId}
                      className={cn(
                        HOME_TYPE.h3,
                        dark
                          ? 'text-[var(--text-inverse)] dark:text-[var(--text-primary)]'
                          : 'text-[var(--text-primary)]'
                      )}
                    >
                      <Link
                        href={card.href}
                        className='outline-none after:absolute after:inset-0 after:z-10 after:rounded-[12px] after:content-[""] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-[var(--text-secondary)] focus-visible:after:outline-offset-[-2px]'
                      >
                        {card.name}
                      </Link>
                    </h3>
                    <p
                      className={cn(
                        HOME_TYPE.body,
                        dark
                          ? 'text-[var(--surface-6)] dark:text-[var(--text-body)]'
                          : 'text-[var(--text-body)]'
                      )}
                    >
                      {card.description}
                    </p>
                  </div>
                  <div className='relative mt-8 flex-1'>
                    <ProductWindow kind={card.preview} className={WINDOW_PLACEMENT} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
