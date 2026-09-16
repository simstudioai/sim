import { cn } from '@sim/emcn'
import Image from 'next/image'
import { HeroPlatformLoopMount } from '@/app/(landing)/components/hero/components/hero-platform-loop'
import { HERO_ARTWORK } from '@/app/(landing)/components/hero/components/hero-platform-stage/hero-artwork.generated'
import { MobileHeroWorkflow } from '@/app/(landing)/components/hero/components/hero-platform-stage/mobile-hero-workflow'
import { LANDING_STAGE_RADIUS } from '@/app/(landing)/components/landing-layout'

const ARTWORK_SIZES =
  '(min-width: 1728px) 1648px, (min-width: 1280px) calc(100vw - 80px), calc(100vw - 72px)'

/**
 * A focused workflow below 1024px; larger screens show the interactive platform
 * in a painted frame. The window uses a compact gutter until the wide desktop
 * layout, with a charcoal treatment applied to the painting in dark mode.
 */
export function HeroPlatformStage() {
  return (
    <>
      <link
        rel='preload'
        as='image'
        type='image/avif'
        media='(min-width: 1024px)'
        imageSrcSet={HERO_ARTWORK.avifSrcSet}
        imageSizes={ARTWORK_SIZES}
        fetchPriority='high'
      />
      <MobileHeroWorkflow />
      <div
        data-preview-stage=''
        className={cn(
          'relative isolate mt-20 w-full overflow-hidden bg-[var(--surface-3)] py-20',
          'max-lg:mt-16 max-lg:hidden max-xl:p-6',
          LANDING_STAGE_RADIUS
        )}
      >
        <picture className='pointer-events-none absolute inset-0'>
          <source type='image/avif' srcSet={HERO_ARTWORK.avifSrcSet} sizes={ARTWORK_SIZES} />
          <source type='image/webp' srcSet={HERO_ARTWORK.webpSrcSet} sizes={ARTWORK_SIZES} />
          <Image
            data-preview-background=''
            src={HERO_ARTWORK.src}
            alt=''
            fill
            unoptimized
            fetchPriority='high'
            sizes={ARTWORK_SIZES}
            className='object-cover dark:brightness-[0.28]'
          />
        </picture>

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
