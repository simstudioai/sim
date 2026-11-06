'use client'

import { ChartFrame } from '@sim/emcn'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { UsageHeatmap } from '@/ee/organization-usage/components/usage-heatmap'
import { useOrganizationUsageCalendar } from '@/hooks/queries/organization-usage'

interface UsageCalendarProps {
  organizationId: string
  timezone: string
  workspaceId?: string
}

/** Loads the year separately so its history cannot delay the selected period's chart. */
export function UsageCalendar({ organizationId, timezone, workspaceId }: UsageCalendarProps) {
  const calendar = useOrganizationUsageCalendar(organizationId, timezone, workspaceId)
  return (
    <SettingsSection
      label='Usage heatmap'
      action={<span className='text-[var(--text-muted)] text-small'>Last 365 days</span>}
    >
      {calendar.isError || !calendar.data ? (
        <ChartFrame
          height={172}
          loading={calendar.isPending}
          error={calendar.isError ? 'Could not load daily usage' : undefined}
          onRetry={() => void calendar.refetch()}
        >
          {null}
        </ChartFrame>
      ) : (
        <UsageHeatmap days={calendar.data.days} />
      )}
    </SettingsSection>
  )
}
