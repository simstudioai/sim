import { cn } from '@sim/emcn'
import { HeroCta } from '@/app/(landing)/components/hero-cta'
import { PlatformVisualFrame } from '@/app/(landing)/components/platform-page/components/platform-visual-frame'
import { PLATFORM_SPACING } from '@/app/(landing)/components/platform-page/constants'
import type { PlatformHeroConfig } from '@/app/(landing)/components/platform-page/types'

/**
 * Platform hero - the only `<h1>` on a platform page. Left-aligned header copy
 * (headline + supporting description) sits above the same CTA as the landing
 * hero ({@link HeroCta}, the single source of truth), then a full-width platform
 * visual underneath.
 *
 * The header column and the visual are stacked in one flex column; the header's
 * own sub-stack (headline → description → CTA) and the gap down to the visual are
 * both owned by named spacing constants, so a consumer page passes only copy and
 * a visual node - never any spacing. The visual renders into a reserved-aspect
 * {@link PlatformVisualFrame} (CLS = 0).
 *
 * Carries the page's sr-only ~50-word product summary for AI citation (GEO). The
 * section's horizontal gutter is owned by `PlatformPage`; this component sets none.
 */

interface PlatformHeroProps {
  hero: PlatformHeroConfig
}

export function PlatformHero({ hero }: PlatformHeroProps) {
  return (
    <section
      id='platform-hero'
      aria-labelledby='platform-hero-heading'
      className={cn(
        'flex flex-col',
        PLATFORM_SPACING.heroTopPadding,
        PLATFORM_SPACING.heroToVisual
      )}
    >
      <p className='sr-only'>{hero.summary}</p>

      <div className={cn('flex flex-col items-start text-left', PLATFORM_SPACING.heroStack)}>
        <h1
          id='platform-hero-heading'
          className='max-w-[900px] text-balance text-[48px] text-[var(--text-primary)] leading-[1.1] max-sm:text-[32px] max-xl:text-[40px]'
        >
          {hero.heading}
        </h1>

        <p className='max-w-[640px] text-[20px] text-[var(--text-body)] leading-[1.5]'>
          {hero.description}
        </p>

        <HeroCta />
      </div>

      <PlatformVisualFrame size='hero'>{hero.visual}</PlatformVisualFrame>
    </section>
  )
}
