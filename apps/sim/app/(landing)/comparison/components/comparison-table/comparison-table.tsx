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
        className='grid min-w-[560px] grid-cols-[1.2fr_1fr_1fr]'
      >
        <div className='contents' role='row'>
          <div
            role='columnheader'
            className='flex flex-col justify-center border-[var(--border)] border-r border-b bg-[var(--surface-1)] px-4 py-4'
          >
            <span className='font-medium text-[var(--text-primary)] text-base'>Compare</span>
            <span className='text-[var(--text-muted)] text-small'>
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
                    'col-span-2 bg-[var(--surface-1)]',
                    sectionIdx > 0 && 'border-[var(--border-1)] border-t'
                  )}
                />
              </div>

              {section.rows.map((row, rowIdx) => {
                const simFact = simGroupFacts[row.key]
                const competitorFact = competitorGroupFacts[row.key]
                const isLastRow = rowIdx < section.rows.length - 1

                return (
                  <div key={row.key} className='contents' role='row'>
                    <div
                      role='rowheader'
                      className={cn(
                        'flex items-center border-[var(--border)] border-r bg-[var(--surface-1)] px-4 py-2.5',
                        isLastRow && 'border-[var(--border-1)] border-b'
                      )}
                    >
                      <span className='text-[var(--text-body)] text-small'>{row.label}</span>
                    </div>
                    <div
                      role='cell'
                      className={cn(
                        'flex items-center border-[var(--border)] border-r bg-[var(--surface-2)] px-3 py-2.5',
                        isLastRow && 'border-[var(--border-1)] border-b'
                      )}
                    >
                      <FactValue fact={simFact} />
                    </div>
                    <div
                      role='cell'
                      className={cn(
                        'flex items-center bg-[var(--surface-2)] px-3 py-2.5',
                        isLastRow && 'border-[var(--border-1)] border-b'
                      )}
                    >
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
