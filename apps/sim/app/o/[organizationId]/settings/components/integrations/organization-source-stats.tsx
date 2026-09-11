'use client'

import { type ReactNode, useMemo } from 'react'
import { Chip, ChipSelect, Tooltip } from '@sim/emcn'
import { CircleInfo } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { BarChart } from '@/components/charts'
import {
  SEARCH_STATS_PEOPLE_LIMIT,
  SEARCH_STATS_SURFACE_LABELS,
  SEARCH_STATS_SURFACES,
} from '@/lib/knowledge/search/stats'
import { OrganizationSearchStatsPeriod } from '@/app/o/[organizationId]/settings/components/integrations/organization-search-stats-period'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import {
  organizationSearchStatsParsers,
  organizationSearchStatsUrlOptions,
} from '@/ee/organization-search-stats/search-params'
import { useOrganizationSearchStats } from '@/hooks/queries/organization-search-stats'

const SURFACE_OPTIONS = [
  { value: 'all', label: 'All surfaces' },
  ...SEARCH_STATS_SURFACES.map((surface) => ({
    value: surface,
    label: SEARCH_STATS_SURFACE_LABELS[surface],
  })),
]

interface OrganizationSourceStatsProps {
  organizationId: string
  tabs?: ReactNode
}

function sourceLabel(sourceType: string) {
  return (
    CONNECTOR_META_REGISTRY[sourceType]?.name ?? (sourceType === 'uploads' ? 'Uploads' : sourceType)
  )
}

export function OrganizationSourceStats({ organizationId, tabs }: OrganizationSourceStatsProps) {
  const [{ period, surface, startDate, endDate }, setFilters] = useQueryStates(
    organizationSearchStatsParsers,
    organizationSearchStatsUrlOptions
  )
  const stats = useOrganizationSearchStats({
    organizationId,
    period,
    surface: surface ?? undefined,
    ...(period === 'custom'
      ? { startDate: startDate ?? undefined, endDate: endDate ?? undefined }
      : {}),
  })
  const series = useMemo(
    () =>
      stats.data?.series.map((point) => ({
        timestamp: point.timestamp,
        value: point.invocations,
      })) ?? [],
    [stats.data?.series]
  )
  const data = stats.data
  const totals = data?.totals
  const metrics = totals
    ? [
        { label: 'Search invocations', value: totals.invocations.toLocaleString() },
        { label: 'Active people', value: totals.activePeople.toLocaleString() },
        { label: 'Results returned', value: totals.results.toLocaleString() },
      ]
    : []

  return (
    <SettingsPanel>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        {tabs}
        <div className='ml-auto flex items-center gap-2'>
          <ChipSelect
            aria-label='Search surface'
            options={SURFACE_OPTIONS}
            value={surface ?? 'all'}
            onChange={(value) =>
              void setFilters({ surface: organizationSearchStatsParsers.surface.parse(value) })
            }
          />
          <OrganizationSearchStatsPeriod
            period={period}
            startDate={startDate}
            endDate={endDate}
            onChange={(selection) => void setFilters(selection)}
          />
        </div>
      </div>
      {stats.isError ? (
        <SettingsEmptyState variant='inline' tone='error'>
          Couldn’t load Search stats. <Chip onClick={() => void stats.refetch()}>Try again</Chip>
        </SettingsEmptyState>
      ) : !data || !totals ? (
        <SettingsEmptyState variant='inline'>Loading Search stats…</SettingsEmptyState>
      ) : (
        <>
          <dl className='grid grid-cols-3 gap-5'>
            {metrics.map((metric) => (
              <div key={metric.label} className='flex flex-col gap-1'>
                <dt className='text-[var(--text-muted)] text-small'>{metric.label}</dt>
                <dd className='text-[var(--text-body)] text-base tabular-nums'>{metric.value}</dd>
              </div>
            ))}
          </dl>
          <SettingsSection
            label='Daily Search invocations'
            headerAccessory={
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Chip leftIcon={CircleInfo} aria-label='How Search stats are counted' />
                </Tooltip.Trigger>
                <Tooltip.Content>
                  Successful Search requests since tracking was enabled. Assistant and MCP counts
                  are Search tool calls. Results count each document once per request. One request
                  can return multiple sources.
                </Tooltip.Content>
              </Tooltip.Root>
            }
            action={
              <span className='text-[var(--text-muted)] text-small'>
                {period === 'custom' ? 'UTC' : 'UTC · Includes today'}
              </span>
            }
          >
            <BarChart
              data={series}
              label=''
              color='var(--indicator-seat-filled)'
              height={180}
              timeZone='UTC'
            />
          </SettingsSection>
          {!surface && totals.invocations > 0 && (
            <SettingsSection label='Invocations by surface'>
              <div className={RESOURCE_LIST_STACK}>
                {data.surfaces.map((row) => (
                  <SettingsResourceRow
                    key={row.surface}
                    title={SEARCH_STATS_SURFACE_LABELS[row.surface]}
                    badge={
                      <span className='text-[var(--text-muted)] text-caption tabular-nums'>
                        {row.invocations.toLocaleString()}
                      </span>
                    }
                  />
                ))}
              </div>
            </SettingsSection>
          )}
          <SettingsSection
            label='Source usage'
            action={
              <span className='text-[var(--text-muted)] text-small'>
                Invocations returning this source
              </span>
            }
          >
            {data.sources.length ? (
              <div className={RESOURCE_LIST_STACK}>
                {data.sources.map((row) => {
                  const Icon = CONNECTOR_META_REGISTRY[row.sourceType]?.icon
                  return (
                    <SettingsResourceRow
                      key={row.sourceType}
                      icon={Icon ? <Icon /> : undefined}
                      title={sourceLabel(row.sourceType)}
                      badge={
                        <span className='text-[var(--text-muted)] text-caption tabular-nums'>
                          {row.invocations.toLocaleString()}
                        </span>
                      }
                    />
                  )
                })}
              </div>
            ) : (
              <SettingsEmptyState variant='inline'>
                No sources returned in this period.
              </SettingsEmptyState>
            )}
          </SettingsSection>
          <SettingsSection
            label='Most active people'
            action={
              <span className='text-[var(--text-muted)] text-small'>
                Top {SEARCH_STATS_PEOPLE_LIMIT} · Invocations
              </span>
            }
          >
            {data.people.length ? (
              <div className={RESOURCE_LIST_STACK}>
                {data.people.map((person) => (
                  <SettingsResourceRow
                    key={person.userId ?? 'deleted'}
                    title={person.email ?? person.name ?? 'Deleted users'}
                    description={
                      person.sourceTypes.map(sourceLabel).join(', ') || 'No source results'
                    }
                    badge={
                      <span className='text-[var(--text-muted)] text-caption tabular-nums'>
                        {person.invocations.toLocaleString()}
                      </span>
                    }
                  />
                ))}
              </div>
            ) : (
              <SettingsEmptyState variant='inline'>
                No active people in this period.
              </SettingsEmptyState>
            )}
          </SettingsSection>
        </>
      )}
    </SettingsPanel>
  )
}
