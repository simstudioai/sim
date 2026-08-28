'use client'

import { chipVariants, cn } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { formatDateTime } from '@sim/utils/formatting'
import { useRouter } from 'next/navigation'
import type { OrganizationUsageEvent } from '@/lib/api/contracts/organization-usage'
import { formatApportionedCreditCost } from '@/lib/billing/credits/conversion'
import {
  BILLING_USAGE_LOG_SOURCE_LABELS,
  type InternalUsageLogSource,
  toBillingUsageLogSource,
} from '@/lib/billing/usage-sources'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useUsageWindow } from '@/ee/organization-usage/hooks/use-usage-window'
import { useOrganizationUsageEvents } from '@/hooks/queries/organization-usage'

/** A workflow row names its workflow; everything else reads as its product surface. */
function eventLabel(event: OrganizationUsageEvent): string {
  if (event.source === 'workflow' && event.workflowName) return `Workflow: ${event.workflowName}`
  return BILLING_USAGE_LOG_SOURCE_LABELS[
    toBillingUsageLogSource(event.source as InternalUsageLogSource)
  ]
}

function UsageEventRow({ event }: { event: OrganizationUsageEvent }) {
  return (
    <div className='flex items-center gap-2.5 rounded-lg p-2 text-left'>
      <span className='w-[150px] flex-shrink-0 text-[var(--text-muted)] text-caption'>
        {formatDateTime(new Date(event.createdAt))}
      </span>
      <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-sm'>
        {eventLabel(event)}
      </span>
      <span className='min-w-0 max-w-[180px] flex-shrink truncate text-[var(--text-muted)] text-caption'>
        {event.description}
      </span>
      <span className='w-[92px] flex-shrink-0 text-right text-[var(--text-muted)] text-caption tabular-nums'>
        {formatApportionedCreditCost(event.credits, event.hasCost)}
      </span>
    </div>
  )
}

interface UsageEventsViewProps {
  organizationId: string
  backHref: string
}

/**
 * The organization's raw ledger.
 *
 * A drill-down rather than a section on the usage panel, mirroring how Billing puts
 * credit usage behind a link: the panel answers whether spend is healthy, this
 * answers what a specific charge was.
 */
export function UsageEventsView({ organizationId, backHref }: UsageEventsViewProps) {
  const router = useRouter()
  const { window } = useUsageWindow()
  const {
    data,
    isLoading,
    isError,
    isPlaceholderData,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useOrganizationUsageEvents(organizationId, window)

  const events = data?.pages.flatMap((page) => page.events) ?? []

  return (
    <SettingsPanel
      back={{ text: 'Usage', icon: ArrowLeft, onSelect: () => router.push(backHref) }}
      title='Usage events'
      description='Every credit-consuming event behind your usage.'
    >
      <div
        className={cn(
          '-mx-2 flex flex-col gap-y-0.5',
          isPlaceholderData && 'opacity-50 transition-opacity'
        )}
      >
        {isLoading ? (
          <SettingsEmptyState variant='inline'>Loading usage…</SettingsEmptyState>
        ) : isError ? (
          <SettingsEmptyState variant='inline' tone='error'>
            Couldn't load usage events.
          </SettingsEmptyState>
        ) : events.length === 0 ? (
          <SettingsEmptyState variant='inline'>No usage in this period.</SettingsEmptyState>
        ) : (
          <>
            {events.map((event) => (
              <UsageEventRow key={event.id} event={event} />
            ))}
            {hasNextPage && (
              <button
                type='button'
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                aria-label='Load more usage events'
                className={cn(
                  chipVariants({ fullWidth: true }),
                  'text-[var(--text-muted)] text-small'
                )}
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        )}
      </div>
    </SettingsPanel>
  )
}
