'use client'

import { PeriodPicker } from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/period-picker'
import { UsageLedger } from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/usage-ledger'
import { exportUsageCsv, useUsageEvents, useUsageView } from '@/platform/lib/data/usage'

const COLUMNS = [
  { key: 'when', label: 'When', kind: 'text' },
  { key: 'label', label: 'Event', kind: 'text' },
  { key: 'description', label: 'Description', kind: 'text', showFrom: 'compact' },
  { key: 'credits', label: 'Credits', kind: 'text' },
] as const

/** The raw ledger: Insights says whether spend is healthy, this says what a charge was. */
export function UsageEvents({ organizationId }: { organizationId: string }) {
  const view = useUsageView()
  const events = useUsageEvents(organizationId, view.window)
  return (
    <UsageLedger
      backLabel='Insights'
      backHref={view.backHref}
      title='Usage events'
      description='Every credit-consuming event across your organization’s workspaces'
      period={
        <PeriodPicker
          options={view.periodOptions}
          value={view.currentPeriod}
          customValue={view.customPeriod}
          range={
            view.startDate && view.endDate ? { start: view.startDate, end: view.endDate } : null
          }
          onPreset={view.selectPeriod}
          onRange={view.applyRange}
        />
      }
      columns={COLUMNS}
      rows={events.rows.map((event) => ({
        id: event.id,
        values: {
          when: event.when,
          label: event.label,
          description: event.description,
          credits: event.credits,
        },
      }))}
      loadMore={events.loadMore}
      pending={events.pending}
      failed={events.failed}
      dimmed={events.dimmed}
      retry={events.retry}
      subject='usage events'
      emptyTitle='No usage in this period'
      onExport={() => exportUsageCsv(organizationId, view.window)}
    />
  )
}
