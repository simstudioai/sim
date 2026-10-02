'use client'

import { useMemo } from 'react'
import {
  BarChart,
  type BarChartSeries,
  ChartFrame,
  ChartLegend,
  type ChartLegendItem,
  DashboardMetric,
  formatChartLatency,
} from '@sim/emcn'
import type { OrganizationActivitySummary } from '@/lib/api/contracts/organization-activity'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { USAGE_CHAT_COLOR, USAGE_OTHER_COLOR } from '@/ee/organization-usage/constants'
import { useLegendHighlight } from '@/ee/organization-usage/hooks/use-legend-highlight'
import { useOrganizationActivitySummary } from '@/hooks/queries/organization-activity'
import type { OrganizationUsageWindowKey } from '@/hooks/queries/utils/organization-usage-keys'

const CHART_HEIGHT = 180

/**
 * Outcome layers, bottom-up. Failed is the status red and sits on the stack where a
 * spike reads at a glance; Other (cancelled, paused, unfinished) stays neutral, in a
 * gray whose lightness keeps it apart from the red for color-vision deficiency.
 */
const OUTCOMES = [
  { id: 'completed', label: 'Completed', color: 'var(--brand-blue)' },
  { id: 'failed', label: 'Failed', color: 'var(--text-error)' },
  { id: 'other', label: 'Other', color: USAGE_OTHER_COLOR },
] as const

const OUTCOME_LEGEND: ChartLegendItem[] = [...OUTCOMES]
const OUTCOME_IDS = OUTCOMES.map((outcome) => outcome.id)

type ActivityPoint = OrganizationActivitySummary['series'][number]

const OUTCOME_VALUE: Record<(typeof OUTCOMES)[number]['id'], (point: ActivityPoint) => number> = {
  completed: (point) => point.completed,
  failed: (point) => point.failed,
  other: (point) => Math.max(0, point.workflowRuns - point.completed - point.failed),
}

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
  const highlight = useLegendHighlight(OUTCOME_IDS)

  const outcomeSeries = useMemo<BarChartSeries[]>(
    () =>
      OUTCOMES.map((outcome) => ({
        ...outcome,
        data: (summary?.series ?? []).map((point) => ({
          timestamp: point.timestamp,
          value: OUTCOME_VALUE[outcome.id](point),
        })),
      })),
    [summary?.series]
  )

  const chatSeries = useMemo(
    () =>
      summary?.series.map((point) => ({ timestamp: point.timestamp, value: point.chatRuns })) ?? [],
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
        <div className='flex min-w-0 flex-col gap-2'>
          <ChartFrame
            title='Workflow runs'
            description='Other includes cancelled, paused, and unfinished runs.'
            height={CHART_HEIGHT}
            {...chartState}
          >
            <BarChart
              label=''
              xAxisFormat='date'
              height={CHART_HEIGHT}
              series={outcomeSeries}
              highlightedSeriesId={highlight.highlightedId}
            />
          </ChartFrame>
          <ChartLegend layout='row' items={OUTCOME_LEGEND} {...highlight.legendProps} />
        </div>
        <ChartFrame title='Chat runs' height={CHART_HEIGHT} {...chartState}>
          <BarChart
            label=''
            xAxisFormat='date'
            height={CHART_HEIGHT}
            data={chatSeries}
            color={USAGE_CHAT_COLOR}
          />
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
