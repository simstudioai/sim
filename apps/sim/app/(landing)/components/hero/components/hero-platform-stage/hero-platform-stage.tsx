import { cn } from '@sim/emcn'
import Image from 'next/image'
import { HeroPlatformLoopMount } from '@/app/(landing)/components/hero/components/hero-platform-loop'
import { HOME_INSET, LANDING_STAGE_RADIUS } from '@/app/(landing)/components/landing-layout'

/**
 * Painted frame on the customer carousel's full content measure. The product
 * window keeps the masthead's inset on desktop; smaller screens use a compact
 * painted gutter so the interface retains its available space. One grayscale
 * painting keeps identical brushwork across themes, with a charcoal treatment
 * applied locally in dark mode.
 */
export function HeroPlatformStage() {
  return (
    <div
      data-preview-stage=''
      className={cn(
        'relative isolate mt-20 w-full overflow-hidden bg-[var(--surface-3)] py-20',
        'max-sm:mt-12 max-sm:p-4 max-lg:mt-16 max-lg:p-6 max-xl:py-16',
        LANDING_STAGE_RADIUS
      )}
    >
      <div aria-hidden='true' className='pointer-events-none absolute inset-0'>
        <Image
          data-preview-background=''
          src='/landing/hero-painted-4k.webp'
          alt=''
          fill
          priority
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
          'relative aspect-[1280/735] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-xs transition-[border-color,box-shadow] duration-300 ease-out has-[[data-preview-entering]]:border-transparent has-[[data-preview-entering]]:shadow-none motion-reduce:transition-none max-sm:aspect-[4/3] max-sm:min-h-[264px] max-xl:min-h-[480px]',
          HOME_INSET
        )}
      >
        <HeroPlatformLoopMount />
      </div>
    </div>
  )
}
