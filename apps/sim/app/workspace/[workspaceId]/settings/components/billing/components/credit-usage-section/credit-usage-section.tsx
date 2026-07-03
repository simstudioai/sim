'use client'

import { Badge, ChipDropdown, type ChipDropdownOption, chipVariants, cn } from '@sim/emcn'
import { formatDateTime } from '@sim/utils/formatting'
import { useQueryStates } from 'nuqs'
import type { UsageLogEntry, UsageLogPeriod, UsageLogSource } from '@/lib/api/contracts/user'
import { formatCreditsLabel } from '@/lib/billing/credits/conversion'
import {
  billingParsers,
  billingUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/billing/search-params'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useUsageLogs } from '@/hooks/queries/usage-logs'

const PERIOD_OPTIONS: ReadonlyArray<ChipDropdownOption> = [
  { value: '1d', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
]

/**
 * Humanized labels for `usage_log.source`. Avoids the internal "copilot" /
 * "mothership" naming — the agent is always "Sim", the surface is "Chat".
 */
const SOURCE_LABELS: Record<UsageLogSource, string> = {
  workflow: 'Workflow',
  wand: 'Wand',
  copilot: 'Chat',
  'workspace-chat': 'Chat',
  mcp_copilot: 'Chat (MCP)',
  mothership_block: 'Agent block',
  'knowledge-base': 'Knowledge Base',
  'voice-input': 'Voice input',
  enrichment: 'Enrichment',
}

interface UsageLogRowProps {
  log: UsageLogEntry
}

function UsageLogRow({ log }: UsageLogRowProps) {
  return (
    <div className='flex items-center gap-2.5 rounded-lg p-2 text-left'>
      <span className='w-[150px] flex-shrink-0 text-[12px] text-[var(--text-muted)]'>
        {formatDateTime(new Date(log.createdAt))}
      </span>
      <span className='min-w-0 flex-1 truncate text-[14px] text-[var(--text-body)]'>
        {log.description}
      </span>
      <Badge variant='gray-secondary' size='sm' className='flex-shrink-0'>
        {SOURCE_LABELS[log.source]}
      </Badge>
      <span className='flex-shrink-0 text-[12px] text-[var(--text-muted)] tabular-nums'>
        {formatCreditsLabel(log.creditCost)}
      </span>
    </div>
  )
}

/**
 * Exposes the credit-consuming usage events behind a user's billing period —
 * the same underlying ledger the usage limit and cost breakdown are computed
 * from — as a paginated, filterable list. Shown to every non-enterprise plan
 * so builders can see exactly where their credits went.
 */
export function CreditUsageSection() {
  const [{ period }, setFilters] = useQueryStates(billingParsers, billingUrlKeys)

  const {
    data,
    isLoading,
    isError,
    isPlaceholderData,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useUsageLogs({ period })

  const logs = data?.pages.flatMap((page) => page.logs) ?? []
  const totalCredits = data?.pages[0]?.summary.totalCredits ?? 0

  return (
    <SettingsSection
      label='Credit usage'
      action={
        <ChipDropdown
          options={PERIOD_OPTIONS}
          value={period}
          onChange={(value) => setFilters({ period: value as UsageLogPeriod })}
        />
      }
    >
      {/* isPlaceholderData means these rows/total are the still-displayed prior
          period's data while the newly selected period is in flight — dim them
          so they don't read as settled results for the period now shown in the
          dropdown. */}
      <div
        className={cn(
          '-mx-2 flex flex-col gap-y-0.5',
          isPlaceholderData && 'opacity-50 transition-opacity'
        )}
      >
        {isLoading ? (
          <SettingsEmptyState variant='inline'>Loading usage…</SettingsEmptyState>
        ) : isError ? (
          <SettingsEmptyState variant='inline'>Couldn't load credit usage.</SettingsEmptyState>
        ) : logs.length === 0 ? (
          <SettingsEmptyState variant='inline'>No credit usage in this period.</SettingsEmptyState>
        ) : (
          <>
            <div className='flex items-center justify-between px-2 pb-2 text-small'>
              <span className='text-[var(--text-muted)]'>Total</span>
              <span className='text-[var(--text-body)] tabular-nums'>
                {formatCreditsLabel(totalCredits)}
              </span>
            </div>
            {logs.map((log) => (
              <UsageLogRow key={log.id} log={log} />
            ))}
            {hasNextPage && (
              <button
                type='button'
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                aria-label='Load more usage'
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
    </SettingsSection>
  )
}
