import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import type { CompetitorProfile } from '@/lib/compare/data'
import { COMPARISON_SECTIONS, getFactGroup } from '@/app/(landing)/comparisons/comparison-sections'
import { BrandIconTile, SimIconTile } from '@/app/(landing)/comparisons/components/brand-icon-tile'
import { FactValue } from '@/app/(landing)/comparisons/components/fact-value'

export interface ComparisonTableProps {
  sim: CompetitorProfile
  competitor: CompetitorProfile
}

/**
 * Pins the row-label column during horizontal scroll on genuinely spacious
 * viewports (the standard pattern for responsive data tables, e.g.
 * Stripe/GitHub/Notion comparison tables) so a reader keeps row context while
 * scrolling to see the Sim/competitor values. Below `lg` (this page's own
 * tablet-and-below tier, per `.claude/rules` for this route group) the table
 * switches to a stacked layout instead (see `MOBILE_STACK_*`) rather than
 * relying on horizontal scroll at a width too narrow to render a 3-column
 * table comfortably, so sticky positioning is scoped to `lg:` only. The
 * shadow is a permanent CSS-only affordance (no scroll-position JS) so this
 * stays a zero-hydration server component.
 */
const STICKY_LABEL_COL = 'lg:sticky lg:left-0 lg:z-10 lg:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]'

/**
 * Below `lg` (1024px) a 3-column grid doesn't reliably have room to be
 * legible, so each fact instead stacks as label -> Sim's value -> the
 * competitor's value, with a small name tag on each value since the column
 * headers are no longer directly above. Applied to the label cell.
 */
const MOBILE_STACK_LABEL = 'max-lg:border-r-0 max-lg:border-b-0 max-lg:pt-3 max-lg:pb-1'

/**
 * Applied to a value cell (Sim's or the competitor's) in the stacked mobile
 * layout. `items-stretch` overrides the cell's base `items-center` (which
 * would otherwise shrink-wrap and center each child horizontally in a
 * flex-col): stretching gives the name tag and the value their own
 * full-width box to left-align and truncate within, instead of a
 * content-sized box with no boundary to clip against.
 */
const MOBILE_STACK_VALUE =
  'max-lg:flex-col max-lg:items-stretch max-lg:gap-0.5 max-lg:border-r-0 max-lg:px-4'

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
        'flex min-w-0 flex-col items-center gap-2 border-[var(--border-1)] border-b px-3 py-4 text-center',
        isSim ? 'bg-[var(--surface-2)]' : 'bg-[var(--surface-1)]'
      )}
    >
      {iconTile}
      <span className='w-full truncate font-medium text-[var(--text-primary)] text-base'>
        {name}
      </span>
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
        className='grid grid-cols-1 lg:min-w-[560px] lg:grid-cols-[minmax(140px,max-content)_1fr_1fr]'
      >
        <div className='contents' role='row'>
          <div
            role='columnheader'
            className={cn(
              'flex min-w-0 flex-col justify-center border-[var(--border)] border-r border-b bg-[var(--surface-1)] px-4 py-4',
              STICKY_LABEL_COL,
              'max-lg:border-r-0'
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
                    'max-lg:border-r-0',
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
                    'col-span-2 bg-[var(--surface-1)] max-lg:hidden',
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
                      <span className='text-[var(--text-body)] text-small max-lg:font-medium max-lg:text-[var(--text-primary)]'>
                        {row.label}
                      </span>
                    </div>
                    <div
                      role='cell'
                      className={cn(
                        'flex min-w-0 items-center gap-1 border-[var(--border)] border-r bg-[var(--surface-2)] px-3 py-2.5',
                        MOBILE_STACK_VALUE,
                        'max-lg:border-b-0 max-lg:pt-1 max-lg:pb-1',
                        isNotLastRow && 'border-[var(--border-1)] border-b'
                      )}
                    >
                      <span className='font-medium text-[var(--text-muted)] text-caption lg:hidden'>
                        {sim.name}
                      </span>
                      <FactValue fact={simFact} />
                    </div>
                    <div
                      role='cell'
                      className={cn(
                        'flex min-w-0 items-center gap-1 bg-[var(--surface-2)] px-3 py-2.5',
                        MOBILE_STACK_VALUE,
                        'max-lg:pt-1 max-lg:pb-3',
                        isNotLastRow && 'border-[var(--border-1)] border-b'
                      )}
                    >
                      <span className='font-medium text-[var(--text-muted)] text-caption lg:hidden'>
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
