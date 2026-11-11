'use client'

import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import Link from 'next/link'
import { DetailHeader } from '@/app/(product)/_components/settings-parts/settings-parts'
import { PeriodPicker } from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/period-picker'
import { UsageLedger } from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/usage-ledger'
import { useCreditUsageLog, useCreditUsageSummary } from '@/platform/lib/data/credit-usage'

const COLUMNS = [
  { key: 'when', label: 'When', kind: 'text' },
  { key: 'label', label: 'Event', kind: 'text' },
  { key: 'credits', label: 'Credits', kind: 'text' },
] as const

const TITLE = 'Credit usage'
const DESCRIPTION = 'Every credit-consuming event behind your usage'

/** Subscription's glance at the viewer's own usage, linking to the full log. */
export function CreditUsageGlance() {
  const summary = useCreditUsageSummary()
  if (summary.status === 'pending') return <SettingsSection title={TITLE} />
  if (summary.status === 'error')
    return <FailureNotice message='Couldn’t load credit usage.' onRetry={summary.retry} />
  return (
    <SettingsSection title={TITLE}>
      <SettingsRow label={summary.total} description='Last 30 days'>
        <Button size='compact' render={<Link href={summary.href} />}>
          View usage logs
        </Button>
      </SettingsRow>
    </SettingsSection>
  )
}

/**
 * The credit usage page. Enterprise plans do not have it: the section's server gate sends them back
 * to Subscription, and a plan it could not read in time is answered here instead.
 */
export function CreditUsage({ available }: { available: boolean }) {
  const log = useCreditUsageLog()
  if (!available)
    return (
      <>
        <DetailHeader
          backLabel='Subscription'
          backHref={log.backHref}
          title={TITLE}
          description={DESCRIPTION}
        />
        <EmptyState title='Credit usage is not part of your plan' />
      </>
    )
  return (
    <UsageLedger
      backLabel='Subscription'
      backHref={log.backHref}
      title={TITLE}
      description={DESCRIPTION}
      summary={log.total && <span data-type='T060'>Total: {log.total}</span>}
      period={
        <PeriodPicker
          options={log.periodOptions}
          value={log.period}
          customValue='custom'
          range={log.range}
          withTime
          onPreset={log.selectPeriod}
          onRange={log.applyRange}
        />
      }
      columns={COLUMNS}
      rows={log.rows.map((row) => ({
        id: row.id,
        values: { when: row.when, label: row.label, credits: row.credits },
      }))}
      loadMore={log.loadMore}
      pending={log.pending}
      failed={log.failed}
      dimmed={log.dimmed}
      retry={log.retry}
      subject='credit usage'
      emptyTitle='No credit usage in this period'
      onExport={log.exportCsv}
    />
  )
}
