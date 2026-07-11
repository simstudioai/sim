import { ChipTag, cn } from '@sim/emcn'
import { LandingHeroHeader } from '@/app/(landing)/components/hero/components/hero-header'
import { HeroCta } from '@/app/(landing)/components/hero-cta'
import {
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
  LANDING_HERO_CTA_GAP,
  LANDING_HERO_TOP_PADDING,
} from '@/app/(landing)/components/landing-layout'
import { SolutionsVisualFrame } from '@/app/(landing)/components/solutions-page/components/solutions-visual-frame'
import {
  SOLUTIONS_SPACING,
  SOLUTIONS_TEXT_MEASURE,
} from '@/app/(landing)/components/solutions-page/constants'
import type { SolutionsHeroConfig } from '@/app/(landing)/components/solutions-page/types'

/**
 * Solutions hero - the only `<h1>` on a solutions page. Header copy (headline +
 * supporting description) sits above the same CTA as the landing hero
 * ({@link HeroCta}, the single source of truth), then a full-width solutions visual
 * underneath. Pages can optionally center this header stack, use the home hero
 * top layout, and show a mono chip above the headline, matching the home landing
 * feature tags.
 *
 * The header column and the visual are stacked in one flex column; the header's
 * own sub-stack (tag → headline → description → CTA) and the gap down to the visual are
 * both owned by named spacing constants, so a consumer page passes only copy and
 * a visual node - never any spacing. The visual renders into a reserved-aspect
 * {@link SolutionsVisualFrame} (CLS = 0).
 *
 * Carries the page's sr-only ~50-word product summary for AI citation (GEO). The
 * standard variant inherits its gutter from `SolutionsPage`; the home variant
 * owns the exact shared homepage cap and gutter because enterprise renders it
 * outside the solutions content wrapper.
 */

interface SolutionsHeroProps {
  hero: SolutionsHeroConfig
  /** Header stack alignment. Defaults to the original left-aligned layout. */
  align?: 'left' | 'center'
  /** Visual treatment for the top hero. Defaults to the original solutions layout. */
  variant?: 'solutions' | 'home'
}

export function SolutionsHero({ hero, align = 'left', variant = 'solutions' }: SolutionsHeroProps) {
  const centered = align === 'center'
  const homeVariant = variant === 'home'

  const eyebrow = hero.eyebrow ? <ChipTag variant='mono'>{hero.eyebrow}</ChipTag> : null

  if (homeVariant) {
    return (
      <section
        id='solutions-hero'
        aria-labelledby='solutions-hero-heading'
        className={cn(
          'flex flex-col items-start gap-[22px] text-left',
          LANDING_CONTENT_WIDTH,
          LANDING_GUTTER,
          LANDING_HERO_TOP_PADDING
        )}
      >
        <p className='sr-only'>{hero.summary}</p>

        <LandingHeroHeader
          eyebrow={eyebrow}
          heading={hero.heading}
          headingId='solutions-hero-heading'
          description={hero.description}
        />

        <div
          aria-hidden='true'
          className='relative mt-[34px] aspect-[1300/720] w-full overflow-hidden rounded-lg bg-[var(--surface-3)] max-sm:aspect-[4/3]'
        >
          {hero.visual}
        </div>
      </section>
    )
  }

  return (
    <section
      id='solutions-hero'
      aria-labelledby='solutions-hero-heading'
      className={cn(
        'flex flex-col',
        SOLUTIONS_SPACING.heroTopPadding,
        SOLUTIONS_SPACING.heroToVisual
      )}
    >
      <p className='sr-only'>{hero.summary}</p>

      <div
        className={cn(
          'flex flex-col',
          centered ? 'items-center text-center' : 'items-start text-left',
          SOLUTIONS_SPACING.heroStack
        )}
      >
        {eyebrow}

        <h1
          id='solutions-hero-heading'
          className='max-w-[900px] text-balance text-[48px] text-[var(--text-primary)] leading-[1.1] max-sm:text-[32px] max-xl:text-[40px]'
        >
          {hero.heading}
        </h1>

        <p
          className={cn(
            SOLUTIONS_TEXT_MEASURE.heroDescription,
            'text-pretty text-[20px] text-[var(--text-body)] leading-[1.5]'
          )}
        >
          {hero.description}
        </p>

        <div className={cn('max-sm:w-full', LANDING_HERO_CTA_GAP)}>
          <HeroCta />
        </div>
      </div>

      <SolutionsVisualFrame size='hero'>{hero.visual}</SolutionsVisualFrame>
    </section>
  )
}
