import { cn } from '@sim/emcn'
import { SolutionsPillCta } from '@/app/(landing)/components/solutions-page/components/solutions-card-row/components/solutions-pill-cta'
import {
  SOLUTIONS_SPACING,
  SOLUTIONS_TEXT_MEASURE,
} from '@/app/(landing)/components/solutions-page/constants'
import type { SolutionsCardRowConfig } from '@/app/(landing)/components/solutions-page/types'

/**
 * The header block of a card row - an `<h2>` title, a body-color subtitle, and
 * a single pill CTA, stacked with named spacing constants. Extracted from
 * {@link SolutionsCardRow} so layouts that place row headers inside a shared
 * grid (the enterprise feature grid) render the exact same header chrome.
 *
 * Only the row header stack can opt into centered text; the `feature` variant
 * is the tighter, smaller treatment used by feature-tile pages.
 */

interface SolutionsCardRowHeaderProps {
  row: SolutionsCardRowConfig
  /** Stable id wiring the `<h2>` into the page outline. */
  headingId: string
  /** Header stack alignment. Defaults to the original left-aligned layout. */
  align?: 'left' | 'center'
  /** Header typography treatment. Defaults to the original larger solutions header. */
  variant?: 'standard' | 'feature'
}

export function SolutionsCardRowHeader({
  row,
  headingId,
  align = 'left',
  variant = 'standard',
}: SolutionsCardRowHeaderProps) {
  const centered = align === 'center'
  const featureHeader = variant === 'feature'

  return (
    <div
      className={cn(
        'flex flex-col',
        centered ? 'items-center text-center' : 'items-start text-left',
        featureHeader ? 'gap-3' : SOLUTIONS_SPACING.cardRowHeaderStack
      )}
    >
      <h2
        id={headingId}
        className={cn(
          'text-balance text-[var(--text-primary)] leading-[1.3]',
          featureHeader
            ? 'max-w-[540px] font-medium text-[22px] max-sm:text-[20px]'
            : 'max-w-[760px] text-[32px] max-sm:text-[24px]'
        )}
      >
        {row.title}
      </h2>
      <p
        className={cn(
          featureHeader ? 'w-full min-w-0 max-w-[48ch]' : SOLUTIONS_TEXT_MEASURE.rowSubtitle,
          'text-pretty',
          featureHeader
            ? 'text-[15px] text-[var(--text-muted)] leading-[1.6]'
            : 'text-[20px] text-[var(--text-body)] leading-[1.5]'
        )}
      >
        {row.subtitle}
      </p>
      <div
        className={
          featureHeader
            ? SOLUTIONS_SPACING.cardRowHeaderCtaGapFeature
            : SOLUTIONS_SPACING.cardRowHeaderCtaGap
        }
      >
        <SolutionsPillCta cta={row.cta} />
      </div>
    </div>
  )
}
