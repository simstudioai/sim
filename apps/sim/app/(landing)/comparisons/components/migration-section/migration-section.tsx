import type { CompetitorMigration } from '@/lib/compare/data'
import { ProseText } from '@/app/(landing)/comparisons/components/prose-text'
import { ProseLink } from '@/app/(landing)/components/prose-page'

interface MigrationSectionProps {
  migration: CompetitorMigration
}

const HEADING_CLASS =
  'mb-4 text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em] lg:text-2xl'
const BODY_CLASS = 'max-w-[720px] text-[var(--text-body)] text-small leading-[150%]'

/**
 * Where to go when the competitor shuts down, as a two-column destinations table, then the
 * ordered steps for moving to Sim. Server-rendered, so answer engines read the table and steps
 * without hydration.
 */
export function MigrationSection({ migration }: MigrationSectionProps) {
  return (
    <>
      <section id='migration' aria-labelledby='migration-heading' className='px-6 py-10'>
        <h2 id='migration-heading' className={HEADING_CLASS}>
          {migration.heading}
        </h2>
        <p className={BODY_CLASS}>
          <ProseText prose={migration.answer} />
        </p>
        <div className='mt-6 w-full overflow-x-auto rounded-xl border border-[var(--border-1)]'>
          <table className='w-full table-fixed border-separate border-spacing-0 text-left'>
            <caption className='sr-only'>{migration.heading}</caption>
            <colgroup>
              <col className='w-[34%]' />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th
                  scope='col'
                  className='bg-[var(--surface-1)] px-4 py-3 font-medium text-[var(--text-muted)] text-small'
                >
                  Destination
                </th>
                <th
                  scope='col'
                  className='border-[var(--border)] border-l bg-[var(--surface-1)] px-4 py-3 font-medium text-[var(--text-muted)] text-small'
                >
                  Choose it when
                </th>
              </tr>
            </thead>
            <tbody>
              {migration.options.map((option) => (
                <tr key={option.name}>
                  <th
                    scope='row'
                    className='border-[var(--border)] border-t px-4 py-3 align-top font-medium text-[var(--text-primary)] text-small leading-[150%]'
                  >
                    <ProseLink href={option.source.url}>{option.name}</ProseLink>
                  </th>
                  <td className='border-[var(--border)] border-t border-l px-4 py-3 align-top text-[var(--text-body)] text-small leading-[150%]'>
                    {option.fitsWhen}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section
        id='migration-steps'
        aria-labelledby='migration-steps-heading'
        className='px-6 pb-10'
      >
        <h2 id='migration-steps-heading' className={HEADING_CLASS}>
          {migration.stepsHeading}
        </h2>
        <ol className='flex max-w-[720px] list-decimal flex-col gap-2 pl-5 text-[var(--text-body)] text-small leading-[150%]'>
          {migration.steps.map((step, index) => (
            <li key={index}>
              <ProseText prose={step} />
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
