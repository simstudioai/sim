import type { CompetitorProfile } from '@/lib/compare/data'
import { COMPARISON_SECTIONS, getFactGroup } from '@/app/(landing)/comparisons/comparison-sections'
import { FactValue } from '@/app/(landing)/comparisons/components/fact-value'
import { ProseText } from '@/app/(landing)/comparisons/components/prose-text'

interface ComparisonRowsProps {
  sim: CompetitorProfile
  competitor: CompetitorProfile
}

/**
 * Sticky rails overlap by one header height so later labels cover earlier labels in DOM order.
 * Desktop anchors advance half a pixel so native scroll rounding fully settles fractional rows.
 */
export function ComparisonRows({ sim, competitor }: ComparisonRowsProps) {
  return COMPARISON_SECTIONS.map((section) => {
    const simFacts = getFactGroup(sim, section.group)
    const competitorFacts = getFactGroup(competitor, section.group)
    const intro = competitor.sectionIntros?.[section.group]

    return (
      <div
        key={section.group}
        role='rowgroup'
        aria-labelledby={`${section.id}-heading`}
        className='contents'
      >
        <div
          role='row'
          data-comparison-section-header
          className='sticky top-[calc(var(--comparison-navbar-height)+var(--comparison-header-height))] z-10 col-span-full grid grid-cols-subgrid before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-0 before:border-[var(--border)] before:border-t after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-0 after:border-[var(--border)] after:border-t lg:hidden'
        >
          <div
            role='rowheader'
            className='flex items-center bg-[var(--surface-6)] px-4 py-2 text-[var(--text-primary)]'
          >
            <h2 id={`${section.id}-heading`} className='font-medium text-base leading-5'>
              {section.title}
            </h2>
          </div>
        </div>
        <div role='row' className={intro ? 'contents' : 'hidden lg:contents'}>
          <div
            role='rowheader'
            data-comparison-category-cell={section.id}
            className='relative z-30 col-start-1 hidden lg:block'
          >
            <div className='pointer-events-none absolute inset-x-0 top-0 h-[var(--comparison-category-span,100%)]'>
              <div
                data-comparison-category-label={section.id}
                className='-ml-[var(--comparison-page-gutter)] pointer-events-auto sticky top-[var(--comparison-navbar-height)] flex h-[var(--comparison-header-height)] items-center justify-end bg-[var(--comparison-column-bg)] pr-6 pl-[calc(var(--comparison-page-gutter)+24px)] text-right before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-0 before:border-[var(--border)] before:border-t after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-0 after:border-[var(--border)] after:border-t'
              >
                <h2 className='font-medium text-[var(--text-primary)] text-base'>
                  {section.title}
                </h2>
              </div>
            </div>
          </div>
          <div
            id={intro ? section.id : undefined}
            role='cell'
            aria-colspan={2}
            className='flex min-w-0 scroll-mt-[calc(var(--comparison-header-height)+var(--comparison-section-height))] items-center bg-[var(--comparison-column-bg)] px-4 py-4 text-[var(--text-body)] text-sm leading-relaxed lg:col-span-2 lg:col-start-2 lg:min-h-0 lg:scroll-mt-[-0.5px] lg:border-[var(--border)] lg:border-x lg:border-t lg:px-6 lg:py-2 xl:pr-12'
          >
            {intro ? (
              <p className='lg:max-h-full lg:overflow-y-auto'>
                <ProseText prose={intro} />
              </p>
            ) : null}
          </div>
        </div>
        {section.rows.map((row, index) => (
          <div key={row.key} role='row' className='contents'>
            <div
              id={index === 0 && !intro ? section.id : undefined}
              role='rowheader'
              className='flex scroll-mt-[calc(var(--comparison-header-height)+var(--comparison-section-height))] items-center bg-[var(--surface-4)] px-4 py-2 font-normal text-[var(--text-body)] text-small leading-relaxed lg:min-h-0 lg:scroll-mt-[calc(var(--comparison-header-height)-0.5px)] lg:justify-end lg:bg-[var(--comparison-column-bg)] lg:px-6 lg:text-right lg:text-sm max-lg:dark:text-white'
            >
              <span className='lg:max-h-full lg:overflow-y-auto'>{row.label}</span>
            </div>
            <div
              role='cell'
              className='flex min-w-0 flex-col justify-center gap-0.5 bg-[var(--surface-2)] px-4 py-1 lg:min-h-0 lg:gap-2 lg:border-[var(--border)] lg:border-x lg:border-t lg:bg-[var(--comparison-column-bg)] lg:px-6 lg:py-2 xl:pr-12'
            >
              <span className='font-medium text-[var(--text-muted)] text-caption lg:hidden max-lg:dark:text-white'>
                {sim.name}
              </span>
              <div className='lg:min-h-0 lg:overflow-y-auto'>
                <FactValue fact={simFacts[row.key]} label={`${sim.name}: ${row.label}`} wrap />
              </div>
            </div>
            <div
              role='cell'
              className='flex min-w-0 flex-col justify-center gap-0.5 border-[var(--border)] border-b bg-[var(--surface-2)] px-4 pt-1 pb-3 lg:min-h-0 lg:gap-2 lg:border-t lg:border-r lg:border-b-0 lg:bg-[var(--comparison-column-bg)] lg:px-6 lg:py-2 xl:pr-12'
            >
              <span className='font-medium text-[var(--text-muted)] text-caption lg:hidden max-lg:dark:text-white'>
                {competitor.name}
              </span>
              <div className='lg:min-h-0 lg:overflow-y-auto'>
                <FactValue
                  fact={competitorFacts[row.key]}
                  label={`${competitor.name}: ${row.label}`}
                  wrap
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  })
}
