import { cn } from '@sim/emcn'
import type { IntegrationComparisonContent } from '@/app/(landing)/integrations/data/types'

interface IntegrationComparisonSectionProps {
  comparison: IntegrationComparisonContent
}

/**
 * Renders a compact, server-side comparison with a horizontally scrollable
 * mobile layout and a sticky capability column for row context.
 */
export function IntegrationComparisonSection({ comparison }: IntegrationComparisonSectionProps) {
  const headingId = `${comparison.id}-heading`

  return (
    <section id={comparison.id} aria-labelledby={headingId} className='px-6 py-10'>
      <h2
        id={headingId}
        className='mb-4 text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em]'
      >
        {comparison.heading}
      </h2>
      <p className='mb-6 max-w-[900px] text-[var(--text-body)] text-sm leading-[150%] tracking-[0.02em]'>
        {comparison.intro}
      </p>

      <div className='w-full overflow-x-auto rounded-xl border border-[var(--border-1)]'>
        <table className='w-full min-w-[860px] table-fixed border-separate border-spacing-0 text-left'>
          <caption className='sr-only'>{comparison.heading}</caption>
          <colgroup>
            <col className='w-[22%]' />
            {comparison.columns.map((column) => (
              <col key={column} className='w-[19.5%]' />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                scope='col'
                className='sticky left-0 z-10 bg-[var(--surface-1)] px-4 py-3 font-medium text-[var(--text-muted)] text-small'
              >
                <span className='sr-only'>Capability</span>
              </th>
              {comparison.columns.map((column, index) => (
                <th
                  key={column}
                  scope='col'
                  className={cn(
                    'border-[var(--border)] border-l px-4 py-3 font-medium text-[var(--text-primary)] text-small',
                    index === 0 ? 'bg-[var(--surface-2)]' : 'bg-[var(--surface-1)]'
                  )}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => (
              <tr key={row.label}>
                <th
                  scope='row'
                  className='sticky left-0 z-10 border-[var(--border)] border-t bg-[var(--surface-1)] px-4 py-3 align-top font-medium text-[var(--text-primary)] text-small leading-[150%]'
                >
                  {row.label}
                </th>
                {row.values.map((value, index) => (
                  <td
                    key={comparison.columns[index]}
                    className={cn(
                      'border-[var(--border)] border-t border-l px-4 py-3 align-top text-[var(--text-body)] text-small leading-[150%]',
                      index === 0 ? 'bg-[var(--surface-2)]' : 'bg-[var(--surface-1)]'
                    )}
                  >
                    {value.href ? (
                      <a
                        href={value.href}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='underline decoration-[var(--border-1)] underline-offset-2 transition-colors hover:text-[var(--text-primary)]'
                      >
                        {value.text}
                      </a>
                    ) : (
                      value.text
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className='mt-6 max-w-[900px] text-[var(--text-body)] text-sm leading-[150%] tracking-[0.02em]'>
        {comparison.conclusion}
      </p>
    </section>
  )
}
