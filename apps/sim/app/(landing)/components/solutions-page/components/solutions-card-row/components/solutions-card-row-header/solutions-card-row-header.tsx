import { SolutionsPillCta } from '@/app/(landing)/components/solutions-page/components/solutions-card-row/components/solutions-pill-cta'
import { SOLUTIONS_SPACING } from '@/app/(landing)/components/solutions-page/constants'
import type { SolutionsCardRowConfig } from '@/app/(landing)/components/solutions-page/types'

/**
 * The header block of a card row - an `<h2>` title, a body-color subtitle, an
 * optional second subtitle paragraph, and a single pill CTA, stacked with named
 * spacing constants. Extracted from
 * {@link SolutionsCardRow} so layouts that place row headers inside a shared
 * grid (the enterprise feature grid) render the exact same header chrome.
 */

interface SolutionsCardRowHeaderProps {
  row: SolutionsCardRowConfig
  /** Stable id wiring the `<h2>` into the page outline. */
  headingId: string
}

export function SolutionsCardRowHeader({ row, headingId }: SolutionsCardRowHeaderProps) {
  return (
    <div className='flex flex-col items-start gap-3 text-left'>
      <h2
        id={headingId}
        className='max-w-[540px] text-balance font-medium text-[22px] text-[var(--text-primary)] leading-[1.3] max-sm:text-[20px]'
      >
        {row.title}
      </h2>
      <p className='w-full min-w-0 max-w-[48ch] text-pretty text-[15px] text-[var(--text-muted)] leading-[1.6]'>
        {row.subtitle}
      </p>
      {row.note ? (
        <p className='w-full min-w-0 max-w-[48ch] text-pretty text-[15px] text-[var(--text-muted)] leading-[1.6]'>
          {row.note}
        </p>
      ) : null}
      <div className={SOLUTIONS_SPACING.cardRowHeaderCtaGapFeature}>
        <SolutionsPillCta cta={row.cta} />
      </div>
    </div>
  )
}
