'use client'

import { useEffect, useId, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { DataTable } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { DateRangePicker } from '@sim/emcn/picker/date-picker'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  DetailHeader,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/billing/billing.module.css'
import { useCreditUsageLog, useCreditUsageSummary } from '@/platform/lib/data/credit-usage'

const COLUMNS = [
  { key: 'when', label: 'When', kind: 'text' },
  { key: 'label', label: 'Event', kind: 'text' },
  { key: 'credits', label: 'Credits', kind: 'text' },
] as const

/** Subscription's glance at the viewer's own usage, linking to the full log. */
export function CreditUsageGlance() {
  const summary = useCreditUsageSummary()
  if (summary.status === 'pending') return <SettingsSection title='Credit usage' />
  if (summary.status === 'error')
    return <FailureNotice message='Couldn’t load credit usage.' onRetry={summary.retry} />
  return (
    <SettingsSection title='Credit usage'>
      <SettingsRow label={summary.total} description='Last 30 days'>
        <Button size='compact' render={<Link href={summary.href} />}>
          View usage logs
        </Button>
      </SettingsRow>
    </SettingsSection>
  )
}

/** The credit usage page, which Enterprise plans do not have: they return to Subscription. */
export function CreditUsage({ available }: { available: boolean }) {
  const router = useRouter()
  const log = useCreditUsageLog()
  const periodId = useId()
  const [choosingRange, setChoosingRange] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!available) router.replace(log.backHref)
  }, [available, router, log.backHref])
  if (!available) return null

  return (
    <>
      <DetailHeader
        backLabel='Subscription'
        backHref={log.backHref}
        title='Credit usage'
        description='Every credit-consuming event behind your usage.'
      >
        <Button
          icon='I049'
          disabled={log.rows.length === 0 || log.dimmed || exporting}
          onClick={async () => {
            setExporting(true)
            await log.exportCsv()
            setExporting(false)
          }}
        >
          Export
        </Button>
      </DetailHeader>
      <SectionToolbar grow={log.total && <span data-type='T060'>Total: {log.total}</span>}>
        <ChoiceMenu
          id={periodId}
          label='Period'
          options={log.periodOptions}
          value={choosingRange ? 'custom' : log.period}
          onValueChange={(value) => {
            if (value === 'custom') setChoosingRange(true)
            else log.selectPeriod(value)
          }}
        />
        {(choosingRange || log.period === 'custom') && (
          <DateRangePicker
            label='Custom range'
            labelHidden
            withTime
            open={choosingRange}
            onOpenChange={(open) => {
              setChoosingRange(open)
              if (!open && log.period !== 'custom') document.getElementById(periodId)?.focus()
            }}
            value={log.range}
            onValueChange={(range) => {
              if (range) log.applyRange(range.start, range.end)
            }}
          />
        )}
      </SectionToolbar>
      {log.failed ? (
        <FailureNotice message='Couldn’t load credit usage.' onRetry={log.retry} />
      ) : log.pending ? null : log.rows.length === 0 ? (
        <EmptyState title='No credit usage in this period.' />
      ) : (
        <div className={styles.dimmable} data-dimmed={log.dimmed || undefined}>
          <DataTable
            title='Credit usage'
            titleHidden
            columns={COLUMNS}
            loadMore={log.loadMore}
            rows={log.rows.map((row) => ({
              id: row.id,
              values: { when: row.when, label: row.label, credits: row.credits },
            }))}
          />
        </div>
      )}
    </>
  )
}
