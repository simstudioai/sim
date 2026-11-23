import { cn } from '@sim/emcn'
import type { GlanceRow } from '@/lib/compare/data'
import { ProseText } from '@/app/(landing)/comparisons/components/prose-text'

interface GlanceTableProps {
  rows: GlanceRow[]
  competitorName: string
}

const HEADER_CELL_CLASS =
  'border-[var(--border)] border-l bg-[var(--surface-1)] px-4 py-3 font-medium text-[var(--text-muted)] text-small'
const VALUE_CELL_CLASS =
  'align-top text-[var(--text-body)] text-small leading-[150%] max-lg:block max-lg:px-4 max-lg:py-1 lg:border-[var(--border)] lg:border-t lg:border-l lg:px-4 lg:py-3'
const STACKED_LABEL_CLASS = 'block font-medium text-[var(--text-muted)] text-caption lg:hidden'

/**
 * The main buying decision points as one table, each cell a sourced sentence with its citation
 * links. Below `lg` each row stacks with labeled values, as the feature-by-feature table does.
 * Server-rendered, so answer engines can extract the table without hydration.
 */
export function GlanceTable({ rows, competitorName }: GlanceTableProps) {
  const heading = `Sim vs ${competitorName}: at a glance`
  return (
    <section id='glance' aria-labelledby='glance-heading' className='px-6 py-10'>
      <h2
        id='glance-heading'
        className='mb-4 text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em] lg:text-2xl'
      >
        {heading}
      </h2>
      <div className='w-full overflow-hidden rounded-xl border border-[var(--border)]'>
        <table className='w-full border-separate border-spacing-0 text-left max-lg:block lg:table-fixed'>
          <caption className='sr-only'>{heading}</caption>
          <colgroup>
            <col className='w-[22%]' />
            <col />
            <col />
          </colgroup>
          <thead className='max-lg:hidden'>
            <tr>
              <th
                scope='col'
                className='bg-[var(--surface-1)] px-4 py-3 font-medium text-[var(--text-muted)] text-small'
              >
                Decision point
              </th>
              <th scope='col' className={HEADER_CELL_CLASS}>
                Sim
              </th>
              <th scope='col' className={HEADER_CELL_CLASS}>
                {competitorName}
              </th>
            </tr>
          </thead>
          <tbody className='max-lg:block'>
            {rows.map((row, index) => (
              <tr
                key={row.label}
                className={cn(
                  'max-lg:block',
                  index > 0 && 'max-lg:border-[var(--border)] max-lg:border-t'
                )}
              >
                <th
                  scope='row'
                  className='align-top font-medium text-[var(--text-primary)] text-small leading-[150%] max-lg:block max-lg:px-4 max-lg:pt-3 max-lg:pb-1 lg:border-[var(--border)] lg:border-t lg:px-4 lg:py-3'
                >
                  {row.label}
                </th>
                <td className={VALUE_CELL_CLASS}>
                  <span className={STACKED_LABEL_CLASS}>Sim</span>
                  <ProseText prose={row.sim} />
                </td>
                <td className={cn(VALUE_CELL_CLASS, 'max-lg:pb-3')}>
                  <span className={STACKED_LABEL_CLASS}>{competitorName}</span>
                  <ProseText prose={row.competitor} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
