'use client'

import { Chip, cn } from '@sim/emcn-legacy'
import { ArrowLeft } from '@sim/emcn-legacy/icons'
import { formatDateTime } from '@sim/utils/formatting'
import { useRouter } from 'next/navigation'
import { SettingsEmptyState } from '@/components/settings/primitives/settings-empty-state'
import { SettingsPanel } from '@/components/settings/primitives/settings-panel'
import type { OrganizationUsageEvent } from '@/lib/api/contracts/organization-usage'
import { formatApportionedCreditCost } from '@/lib/billing/credits/conversion'
import { usageEventLabel } from '@/ee/organization-usage/format'
import { useUsageWindow } from '@/ee/organization-usage/hooks/use-usage-window'
import { useOrganizationUsageEvents } from '@/hooks/queries/organization-usage'

function UsageEventRow({ event }: { event: OrganizationUsageEvent }) {
  return (
    <div className='flex items-center gap-2.5 rounded-lg p-2 text-left'>
      <span className='w-[150px] shrink-0 text-[var(--text-muted)] text-caption'>
        {formatDateTime(new Date(event.createdAt))}
      </span>
      <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-sm'>
        {usageEventLabel(event)}
      </span>
      <span className='min-w-0 max-w-[180px] shrink truncate text-[var(--text-muted)] text-caption'>
        {event.description}
      </span>
      <span className='w-[92px] shrink-0 text-right text-[var(--text-muted)] text-caption tabular-nums'>
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
      description="Every credit-consuming event across your organization's workspaces."
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
          <SettingsEmptyState variant='inline'>Couldn't load usage events.</SettingsEmptyState>
        ) : events.length === 0 ? (
          <SettingsEmptyState variant='inline'>No usage in this period.</SettingsEmptyState>
        ) : (
          <>
            {events.map((event) => (
              <UsageEventRow key={event.id} event={event} />
            ))}
            {hasNextPage && (
              <Chip
                fullWidth
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                aria-label='Load more usage events'
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Chip>
            )}
          </>
        )}
      </div>
    </SettingsPanel>
  )
}
