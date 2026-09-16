'use client'

import { useMemo } from 'react'
import { BarChart, ChartFrame, DashboardMetric, DonutChart, formatChartLatency } from '@sim/emcn'
import type { OrganizationActivitySummary } from '@/lib/api/contracts/organization-activity'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useOrganizationActivitySummary } from '@/hooks/queries/organization-activity'
import type { OrganizationUsageWindowKey } from '@/hooks/queries/utils/organization-usage-keys'

interface ActivitySummaryProps {
  summary?: OrganizationActivitySummary
  loading?: boolean
  error?: boolean
  onRetry?: () => void
}

export function formatFailureRate(rate: number | null): string {
  return rate === null
    ? '—'
    : new Intl.NumberFormat(undefined, {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(rate)
}

export function ActivitySummary({ summary, loading, error, onRetry }: ActivitySummaryProps) {
  const workflowSeries = useMemo(
    () =>
      summary?.series.map((point) => ({
        timestamp: point.timestamp,
        value: point.workflowRuns,
      })) ?? [],
    [summary?.series]
  )
  const chatSeries = useMemo(
    () =>
      summary?.series.map((point) => ({
        timestamp: point.timestamp,
        value: point.chatRuns,
      })) ?? [],
    [summary?.series]
  )
  const failureSeries = useMemo(
    () =>
      summary?.series.map((point) => ({
        timestamp: point.timestamp,
        value: point.failed,
      })) ?? [],
    [summary?.series]
  )
  const totals = summary?.totals
  const metrics = [
    {
      label: 'Workflow runs',
      value: totals?.workflowRuns.toLocaleString(),
      description: 'Retained executions, grouped by start date.',
    },
    {
      label: 'Chat runs',
      value: totals?.chatRuns.toLocaleString(),
      description: 'Recorded executions in organization chats. Continuations count once.',
    },
    {
      label: 'Chat members',
      value: totals?.chatMembers.toLocaleString(),
      description: 'Members with recorded chat runs in this period.',
    },
    {
      label: 'Failure rate',
      value: formatFailureRate(totals?.failureRate ?? null),
      description: 'Failed workflows as a share of completed and failed workflows.',
    },
    {
      label: 'Avg. duration',
      value:
        totals?.averageDurationMs == null
          ? '—'
          : totals.averageDurationMs === 0
            ? '0 ms'
            : formatChartLatency(totals.averageDurationMs),
      description: 'Completed and failed workflows with a recorded duration.',
    },
  ]
  const outcomes = [
    { label: 'Completed', value: totals?.completed ?? 0, color: 'var(--indicator-seat-filled)' },
    { label: 'Failed', value: totals?.failed ?? 0, color: 'var(--text-error)' },
    {
      label: 'Other',
      value: totals ? totals.workflowRuns - totals.completed - totals.failed : 0,
      color: 'var(--text-muted)',
    },
  ]
  const chartState = { loading, error: error ? "Couldn't load activity." : undefined, onRetry }
  return (
    <div className='flex flex-col gap-5'>
      <div className='grid grid-cols-[repeat(auto-fit,minmax(min(120px,100%),1fr))] gap-4'>
        {metrics.map((metric) => (
          <DashboardMetric
            key={metric.label}
            {...metric}
            value={error ? '—' : (metric.value ?? '—')}
            loading={loading}
          />
        ))}
      </div>
      <div className='grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-6'>
        <ChartFrame title='Workflow runs' height={160} {...chartState}>
          <BarChart
            xAxisFormat='date'
            data={workflowSeries}
            label=''
            color='var(--indicator-seat-filled)'
            height={160}
          />
        </ChartFrame>
        <ChartFrame title='Chat runs' height={160} {...chartState}>
          <BarChart
            xAxisFormat='date'
            data={chatSeries}
            label=''
            color='var(--indicator-seat-filled)'
            height={160}
          />
        </ChartFrame>
        <ChartFrame title='Failed runs' height={160} {...chartState}>
          <BarChart
            xAxisFormat='date'
            data={failureSeries}
            label=''
            color='var(--text-error)'
            height={160}
          />
        </ChartFrame>
        <ChartFrame
          title='Workflow outcomes'
          description='Other includes cancelled, paused, and unfinished runs.'
          height={160}
          {...chartState}
        >
          <DonutChart segments={outcomes} label='Workflow outcomes' />
        </ChartFrame>
      </div>
    </div>
  )
}

interface OrganizationActivityOverviewProps {
  organizationId: string
  window: OrganizationUsageWindowKey
  workspaceId?: string
}

export function OrganizationActivityOverview({
  organizationId,
  window,
  workspaceId,
}: OrganizationActivityOverviewProps) {
  const query = useOrganizationActivitySummary(organizationId, window, { workspaceId })
  return (
    <SettingsSection label='Activity'>
      <ActivitySummary
        summary={query.data}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => void query.refetch()}
      />
    </SettingsSection>
  )
}
