'use client'

import { useId } from 'react'
import { cn } from '@sim/emcn'
import { WORDMARK_PATHS, WORDMARK_VIEW_BOX } from '@/lib/branding/wordmark'
import { LandingCtaLink } from '@/app/(landing)/components/landing-cta-link'
import {
  HOME_TYPE,
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
} from '@/app/(landing)/components/landing-layout'
import { STACK_LAYERS } from '@/app/(landing)/components/sim-stack/stack-content'
import { getStackLayerProgress } from '@/app/(landing)/components/sim-stack/stack-timeline'
import { SIGNUP_HREF } from '@/app/(landing)/constants'

interface StackIntroProps {
  progress: number
}

/** The heading remains above the arriving planes; supporting copy fades once exploration begins. */
export function StackIntro({ progress }: StackIntroProps) {
  const wordmarkInkId = useId()
  const showCta = getStackLayerProgress(progress, STACK_LAYERS.length - 1).entrance > 0
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 top-8 z-10 flex flex-col items-center gap-6 text-center max-sm:top-6 max-sm:gap-4',
        LANDING_CONTENT_WIDTH,
        LANDING_GUTTER
      )}
    >
      <h2
        id='sim-stack-heading'
        className={cn('text-balance text-[var(--text-primary)]', HOME_TYPE.h2Display)}
      >
        Introducing <span className='sr-only'>Sim</span>
        <svg
          aria-hidden='true'
          focusable='false'
          viewBox={`0 0 ${WORDMARK_VIEW_BOX.width} ${WORDMARK_VIEW_BOX.height}`}
          className='inline-block h-[0.78em] w-auto align-baseline'
        >
          <defs>
            <radialGradient id={wordmarkInkId} cx='50%' cy='50%' r='50%'>
              <stop className='[stop-color:var(--thinking-ink-inner)]' />
              <stop offset='1' className='[stop-color:var(--thinking-ink-outer)]' />
            </radialGradient>
          </defs>
          <g fill={`url(#${wordmarkInkId})`}>
            {WORDMARK_PATHS.map((path) => (
              <path key={path} d={path} />
            ))}
          </g>
        </svg>
      </h2>
      <div className='grid w-full justify-items-center'>
        <p
          data-stack-intro-copy
          className={cn(
            'col-start-1 row-start-1 max-w-[48rem] text-balance text-[var(--text-body)] transition-opacity duration-300 motion-reduce:transition-none',
            HOME_TYPE.body,
            progress > 0.18 && 'opacity-0',
            showCta && 'invisible'
          )}
        >
          The complete stack for AI agents. From your data and models to the workflows they power,
          all built on a foundation of control.
        </p>
        <div
          data-stack-completion-cta
          inert={!showCta}
          aria-hidden={!showCta}
          className={cn(
            'col-start-1 row-start-1 transition-opacity duration-300 motion-reduce:transition-none',
            showCta ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          <LandingCtaLink
            variant='outline'
            size='display'
            href={SIGNUP_HREF}
            prefetch={false}
            withArrow
          >
            Start building
          </LandingCtaLink>
        </div>
      </div>
    </div>
  )
}
