import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import type { CompetitorProfile } from '@/lib/compare/data'
import { COMPARISON_SECTIONS, getFactGroup } from '@/app/(landing)/comparison/comparison-sections'
import { BrandIconTile, SimIconTile } from '@/app/(landing)/comparison/components/brand-icon-tile'
import { FactValue } from '@/app/(landing)/comparison/components/fact-value'

export interface ComparisonTableProps {
  sim: CompetitorProfile
  competitor: CompetitorProfile
}

/**
 * Pins the row-label column during horizontal scroll at tablet width and up
 * (the standard pattern for responsive data tables, e.g. Stripe/GitHub/Notion
 * comparison tables) so a reader keeps row context while scrolling to see the
 * Sim/competitor values. Below `sm` the table switches to a stacked layout
 * instead (see `MOBILE_STACK`), so sticky positioning is scoped to `sm:` only.
 * The shadow is a permanent CSS-only affordance (no scroll-position JS) so
 * this stays a zero-hydration server component.
 */
const STICKY_LABEL_COL = 'sm:sticky sm:left-0 sm:z-10 sm:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]'

/**
 * Below `sm` (640px) a 3-column grid has no room to be legible even with a
 * pinned label column, so each fact instead stacks as label -> Sim's value ->
 * the competitor's value, with a small name tag on each value since the
 * column headers are no longer directly above. Applied to the label cell.
 */
const MOBILE_STACK_LABEL = 'max-sm:border-r-0 max-sm:border-b-0 max-sm:pt-3 max-sm:pb-1'

/** Applied to a value cell (Sim's or the competitor's) in the stacked mobile layout. */
const MOBILE_STACK_VALUE =
  'max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:border-r-0 max-sm:px-4'

function ColumnHeader({
  name,
  iconTile,
  isSim,
}: {
  name: string
  iconTile: ReactNode
  isSim: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 border-[var(--border-1)] border-b px-3 py-4 text-center',
        isSim ? 'bg-[var(--surface-2)]' : 'bg-[var(--surface-1)]'
      )}
    >
      {iconTile}
      <span className='font-medium text-[var(--text-primary)] text-base'>{name}</span>
    </div>
  )
}

/**
 * Two-column "Sim vs {Competitor}" fact table, styled after the billing
 * upgrade-page comparison table (same border/hairline rhythm and section
 * headers) but data-driven off {@link CompetitorProfile.facts} instead of the
 * fixed 4-tier plan schema. Data cells share one neutral surface for both
 * columns. The Sim column is called out only in the header row (a bottom
 * accent border), so the table reads as one clean grid rather than a
 * checkerboard. Pure server component: every value is plain server-rendered
 * text so crawlers and AI answer engines read the full comparison without
 * any client-side hydration.
 */
export function ComparisonTable({ sim, competitor }: ComparisonTableProps) {
  return (
    <div className='w-full overflow-x-auto rounded-xl border border-[var(--border-1)]'>
      <div
        role='table'
        aria-label={`Sim vs ${competitor.name} feature comparison`}
        className='grid grid-cols-1 sm:min-w-[560px] sm:grid-cols-[minmax(140px,max-content)_1fr_1fr]'
      >
        <div className='contents' role='row'>
          <div
            role='columnheader'
            className={cn(
              'flex min-w-0 flex-col justify-center border-[var(--border)] border-r border-b bg-[var(--surface-1)] px-4 py-4',
              STICKY_LABEL_COL,
              'max-sm:border-r-0'
            )}
          >
            <span className='truncate font-medium text-[var(--text-primary)] text-base'>
              Compare
            </span>
            <span className='truncate text-[var(--text-muted)] text-small'>
              {sim.name} vs {competitor.name}
            </span>
          </div>
          <ColumnHeader name={sim.name} iconTile={<SimIconTile className='size-9' />} isSim />
          <ColumnHeader
            name={competitor.name}
            iconTile={
              competitor.brand?.icon ? (
                <BrandIconTile
                  icon={competitor.brand.icon}
                  selfFramed={competitor.brand.selfFramed}
                  className='size-9'
                  iconClassName='size-5'
                />
              ) : null
            }
            isSim={false}
          />
        </div>

        {COMPARISON_SECTIONS.map((section, sectionIdx) => {
          const simGroupFacts = getFactGroup(sim, section.group)
          const competitorGroupFacts = getFactGroup(competitor, section.group)

          return (
            <div key={section.title} className='contents'>
              <div className='contents' role='row'>
                <div
                  role='columnheader'
                  className={cn(
                    'border-[var(--border)] border-r bg-[var(--surface-1)] px-4 py-2',
                    STICKY_LABEL_COL,
                    'max-sm:border-r-0',
                    sectionIdx > 0 && 'border-[var(--border-1)] border-t'
                  )}
                >
                  <span className='font-medium text-[var(--text-primary)] text-small'>
                    {section.title}
                  </span>
                </div>
                <div
                  role='presentation'
                  className={cn(
                    'col-span-2 bg-[var(--surface-1)] max-sm:hidden',
                    sectionIdx > 0 && 'border-[var(--border-1)] border-t'
                  )}
                />
              </div>

              {section.rows.map((row, rowIdx) => {
                const simFact = simGroupFacts[row.key]
                const competitorFact = competitorGroupFacts[row.key]
                const isNotLastRow = rowIdx < section.rows.length - 1

                return (
                  <div key={row.key} className='contents' role='row'>
                    <div
                      role='rowheader'
                      className={cn(
                        'flex min-w-0 items-center border-[var(--border)] border-r bg-[var(--surface-1)] px-4 py-2.5',
                        STICKY_LABEL_COL,
                        MOBILE_STACK_LABEL,
                        isNotLastRow && 'border-[var(--border-1)] border-b'
                      )}
                    >
                      <span className='text-[var(--text-body)] text-small max-sm:font-medium max-sm:text-[var(--text-primary)]'>
                        {row.label}
                      </span>
                    </div>
                    <div
                      role='cell'
                      className={cn(
                        'flex min-w-0 items-center gap-1 border-[var(--border)] border-r bg-[var(--surface-2)] px-3 py-2.5',
                        MOBILE_STACK_VALUE,
                        'max-sm:border-b-0 max-sm:pt-1 max-sm:pb-1',
                        isNotLastRow && 'border-[var(--border-1)] border-b'
                      )}
                    >
                      <span className='font-medium text-[var(--text-muted)] text-caption sm:hidden'>
                        {sim.name}
                      </span>
                      <FactValue fact={simFact} />
                    </div>
                    <div
                      role='cell'
                      className={cn(
                        'flex min-w-0 items-center gap-1 bg-[var(--surface-2)] px-3 py-2.5',
                        MOBILE_STACK_VALUE,
                        'max-sm:pt-1 max-sm:pb-3',
                        isNotLastRow && 'border-[var(--border-1)] border-b'
                      )}
                    >
                      <span className='font-medium text-[var(--text-muted)] text-caption sm:hidden'>
                        {competitor.name}
                      </span>
                      <FactValue fact={competitorFact} />
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
