import { ChipTag, cn } from '@sim/emcn'
import type { ComparisonFacts, CompetitorProfile } from '@/lib/compare/data'
import type { ComparisonRowDef } from '@/app/(landing)/comparison/comparison-sections'
import { getFactGroup } from '@/app/(landing)/comparison/comparison-sections'
import { FactValue } from '@/app/(landing)/comparison/components/fact-value'

interface HeadlineRow extends ComparisonRowDef {
  group: keyof ComparisonFacts
}

const EYEBROW_LABEL_CLASSES =
  'font-medium text-[var(--text-muted)] text-xs uppercase tracking-[0.06em]' as const

/**
 * The rows a scanning buyer is most likely to decide on before reading the
 * full comparison table below: self-hosting, environment promotion,
 * human-in-the-loop, pricing model, and data residency.
 */
const HEADLINE_ROWS: HeadlineRow[] = [
  { group: 'platform', key: 'selfHostOption', label: 'Self-hosting' },
  { group: 'platform', key: 'environmentPromotion', label: 'Environment promotion' },
  { group: 'aiCapabilities', key: 'humanInTheLoop', label: 'Human-in-the-loop' },
  { group: 'pricing', key: 'pricingModel', label: 'Pricing model' },
  { group: 'security', key: 'dataResidency', label: 'Data residency' },
]

export interface KeyDifferencesProps {
  sim: CompetitorProfile
  competitor: CompetitorProfile
}

/**
 * A compact summary of the 5 rows most buyers decide on first, shown above
 * the full comparison table. Each row is labeled with a {@link ChipTag}
 * (matching the emcn chip system rather than a hand-rolled uppercase
 * caption) and rendered through the shared {@link FactValue} so status
 * icons and source affordances match the full table exactly. Each row
 * independently names "Sim" and the competitor so the block reads as a
 * standalone, quotable answer for both human scanners and AI answer engines.
 */
export function KeyDifferences({ sim, competitor }: KeyDifferencesProps) {
  return (
    <div className='grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-[var(--border-1)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-5'>
      {HEADLINE_ROWS.map((row) => {
        const simFact = getFactGroup(sim, row.group)[row.key]
        const competitorFact = getFactGroup(competitor, row.group)[row.key]

        return (
          <div key={row.key} className='flex flex-col gap-3 bg-[var(--surface-1)] p-4'>
            <ChipTag variant='gray' className='self-start'>
              {row.label}
            </ChipTag>
            <div className='flex flex-col gap-1'>
              <span className={EYEBROW_LABEL_CLASSES}>Sim</span>
              <FactValue fact={simFact} />
            </div>
            <div className='flex flex-col gap-1'>
              <span className={cn(EYEBROW_LABEL_CLASSES, 'truncate')}>{competitor.name}</span>
              <FactValue fact={competitorFact} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
