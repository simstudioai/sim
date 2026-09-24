'use client'

import { Chip } from '@sim/emcn'
import {
  ORGANIZATION_USAGE_OVERVIEW_ROW_LIMIT,
  type OrganizationUsageBreakdown,
  type OrganizationUsageOverview,
} from '@/lib/api/contracts/organization-usage'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { UsageConsumers } from '@/ee/organization-usage/components/usage-consumers'
import type { UsageTab } from '@/ee/organization-usage/constants'
import { useOrganizationUsageBreakdown } from '@/hooks/queries/organization-usage'
import type { OrganizationUsageWindowKey } from '@/hooks/queries/utils/organization-usage-keys'

/**
 * The head of a ranking, with the rest folded into its remainder.
 *
 * The card reads the Models tab's own query and trims it here rather than asking the
 * server for fewer rows: the ledger scan costs the same either way, and sharing the
 * key means "View all" opens from cache.
 */
function truncateBreakdown(
  breakdown: OrganizationUsageBreakdown,
  count: number
): OrganizationUsageBreakdown {
  const hidden = breakdown.rows.slice(count)
  return {
    ...breakdown,
    rows: breakdown.rows.slice(0, count),
    other: {
      credits: breakdown.other.credits + hidden.reduce((sum, row) => sum + row.credits, 0),
      events: breakdown.other.events + hidden.reduce((sum, row) => sum + row.events, 0),
      rowCount: breakdown.other.rowCount + hidden.length,
      tokens: breakdown.other.tokens + hidden.reduce((sum, row) => sum + (row.tokens ?? 0), 0),
    },
  }
}

interface UsageTopCardsProps {
  organizationId: string
  window: OrganizationUsageWindowKey
  overview?: OrganizationUsageOverview
  isOverviewLoading: boolean
  isOverviewError: boolean
  /** Dims the member ranking with the rest of the overview while a new period loads. */
  isOverviewPlaceholderData: boolean
  onViewAll: (tab: UsageTab) => void
}

/**
 * The top models and members, side by side.
 *
 * Members arrive with the overview; models are the Models tab's own read, trimmed
 * here, so each card loads without holding up the other or the chart above.
 */
export function UsageTopCards({
  organizationId,
  window,
  overview,
  isOverviewLoading,
  isOverviewError,
  isOverviewPlaceholderData,
  onViewAll,
}: UsageTopCardsProps) {
  const models = useOrganizationUsageBreakdown(organizationId, window, 'model')

  return (
    <div className='grid grid-cols-1 gap-7 md:grid-cols-2 md:gap-x-8'>
      <SettingsSection
        label='Top models'
        action={<Chip onClick={() => onViewAll('model')}>View all</Chip>}
      >
        <UsageConsumers
          dimension='model'
          breakdown={
            models.data
              ? truncateBreakdown(models.data, ORGANIZATION_USAGE_OVERVIEW_ROW_LIMIT)
              : undefined
          }
          isLoading={models.isLoading}
          isError={models.isError}
          isPlaceholderData={models.isPlaceholderData}
        />
      </SettingsSection>
      <SettingsSection
        label='Top members'
        action={<Chip onClick={() => onViewAll('member')}>View all</Chip>}
      >
        <UsageConsumers
          dimension='member'
          breakdown={overview?.members}
          isLoading={isOverviewLoading}
          isError={isOverviewError}
          isPlaceholderData={isOverviewPlaceholderData}
        />
      </SettingsSection>
    </div>
  )
}
