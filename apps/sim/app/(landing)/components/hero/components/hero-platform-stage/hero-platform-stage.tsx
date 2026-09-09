import { cn } from '@sim/emcn'
import Image from 'next/image'
import { HeroPlatformLoopMount } from '@/app/(landing)/components/hero/components/hero-platform-loop'
import { MobileHeroWorkflow } from '@/app/(landing)/components/hero/components/hero-platform-stage/mobile-hero-workflow'
import { LANDING_STAGE_RADIUS } from '@/app/(landing)/components/landing-layout'

/**
 * A focused workflow below 1024px; larger screens show the interactive platform
 * in a painted frame. The window uses a compact gutter until the wide desktop
 * layout, with a charcoal treatment applied to the painting in dark mode.
 */
export function HeroPlatformStage() {
  return (
    <>
      <MobileHeroWorkflow />
      <div
        data-preview-stage=''
        className={cn(
          'relative isolate mt-20 w-full overflow-hidden bg-[var(--surface-3)] py-20',
          'max-lg:mt-16 max-lg:hidden max-xl:p-6',
          LANDING_STAGE_RADIUS
        )}
      >
        <div aria-hidden='true' className='pointer-events-none absolute inset-0'>
          <Image
            data-preview-background=''
            src='/landing/hero-painted-4k.webp'
            alt=''
            fill
            fetchPriority='high'
            quality={90}
            sizes='(max-width: 1727px) 100vw, 1648px'
            className='object-cover dark:brightness-[0.28]'
          />
        </div>

        <div
          role='region'
          aria-label='Interactive Sim product preview'
          className={cn(
            'relative aspect-[1280/735] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-xs max-xl:min-h-[480px]',
            'w-full xl:mx-auto xl:w-[83.333%]'
          )}
        >
          <HeroPlatformLoopMount />
        </div>
      </div>
    </>
  )
}
