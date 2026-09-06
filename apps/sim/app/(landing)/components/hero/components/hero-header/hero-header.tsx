import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import { HeroCta } from '@/app/(landing)/components/hero-cta'
import { HOME_TYPE, LANDING_TYPE } from '@/app/(landing)/components/landing-layout'

interface LandingHeroHeaderProps {
  description: string
  eyebrow?: ReactNode
  heading: ReactNode
  headingId: string
  /**
   * `home` is the split, product-first masthead used only on `/`.
   * `default` keeps the split 76px heading `/enterprise` already shares.
   */
  scale?: 'default' | 'home'
}

/**
 * Shared hero header with a wide split homepage masthead and the existing split
 * composition for marketing subpages. Homepage pairs a leading headline with
 * supporting copy and CTAs aligned to the headline’s last baseline before the product stage.
 */
export function LandingHeroHeader({
  description,
  eyebrow,
  heading,
  headingId,
  scale = 'default',
}: LandingHeroHeaderProps) {
  const home = scale === 'home'

  if (home) {
    return (
      <div className='grid w-full grid-cols-[minmax(0,1fr)_minmax(380px,440px)] gap-16 text-left [align-items:last_baseline] max-[1400px]:grid-cols-1 max-[1400px]:items-start max-[1400px]:gap-8'>
        <div className='flex min-w-0 flex-col items-start gap-6'>
          {eyebrow}

          <h1
            id={headingId}
            className={cn(
              'max-w-[960px] text-balance text-[var(--text-primary)] max-[1728px]:text-[64px]',
              HOME_TYPE.h1
            )}
          >
            {heading}
          </h1>
        </div>

        <div className='flex min-w-0 flex-col items-start gap-8 max-[1400px]:max-w-[640px]'>
          <p className='max-w-[44ch] text-pretty font-normal text-[18px] text-[var(--text-body)] leading-[1.5] max-sm:text-[16px]'>
            {description}
          </p>

          <div className='max-sm:w-full'>
            <HeroCta size='display' secondaryLabel='Start building' />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='flex w-full items-end justify-between gap-12 max-xl:flex-col max-xl:items-start max-xl:gap-8'>
      <div className='flex min-w-0 flex-1 flex-col items-start gap-[22px] text-left'>
        {eyebrow}

        <h1
          id={headingId}
          className={cn(
            'max-w-[22ch] text-balance text-[var(--text-primary)] [&>br]:max-sm:hidden',
            LANDING_TYPE.h1
          )}
        >
          {heading}
        </h1>
      </div>

      <div className='flex w-[400px] flex-none flex-col items-start gap-7 pb-3 max-xl:w-full max-xl:gap-[22px] max-xl:pb-0'>
        <p
          className={cn(
            'w-full min-w-0 max-w-[34ch] text-pretty text-[var(--text-body)]',
            LANDING_TYPE.lead
          )}
        >
          {description}
        </p>

        <div className='max-sm:w-full'>
          <HeroCta />
        </div>
      </div>
    </div>
  )
}
