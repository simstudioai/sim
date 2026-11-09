'use client'

import { DataTable } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { FailureNotice } from '@sim/emcn/status'
import { DetailHeader } from '@/app/(product)/_components/settings-parts/settings-parts'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/usage-section.module.css'
import { useUsageEvents, useUsageView } from '@/platform/lib/data/usage'

const COLUMNS = [
  { key: 'when', label: 'When', kind: 'text' },
  { key: 'label', label: 'Event', kind: 'text' },
  { key: 'description', label: 'Description', kind: 'text', showFrom: 'wide' },
  { key: 'credits', label: 'Credits', kind: 'text' },
] as const

/** The raw ledger: the panel says whether spend is healthy, this says what a charge was. */
export function UsageEvents({ organizationId }: { organizationId: string }) {
  const { window, backHref } = useUsageView()
  const events = useUsageEvents(organizationId, window)
  return (
    <>
      <DetailHeader
        backLabel='Insights'
        backHref={backHref}
        title='Usage events'
        description='Every credit-consuming event across your organization’s workspaces.'
      />
      {events.failed && events.rows.length === 0 ? (
        <FailureNotice message='Couldn’t load usage events.' onRetry={events.retry} />
      ) : events.pending ? null : events.rows.length === 0 ? (
        <EmptyState title='No usage in this period.' />
      ) : (
        <div className={styles.dimmable} data-dimmed={events.dimmed || undefined}>
          <DataTable
            title='Usage events'
            titleHidden
            columns={COLUMNS}
            loadMore={events.loadMore}
            rows={events.rows.map((event) => ({
              id: event.id,
              values: {
                when: event.when,
                label: event.label,
                description: event.description,
                credits: event.credits,
              },
            }))}
          />
        </div>
      )}
    </>
  )
}
