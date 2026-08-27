'use client'

import type { ComponentType } from 'react'
import { cn } from '@sim/emcn'
import { ChevronRight } from '@sim/emcn/icons'
import { formatChartCompactNumber } from '@/components/charts'
import {
  AnthropicIcon,
  AzureIcon,
  CerebrasIcon,
  DeepseekIcon,
  GoogleIcon,
  GroqIcon,
  MistralIcon,
  OllamaIcon,
  OpenAIIcon,
  OpenRouterIcon,
  xAIIcon,
} from '@/components/icons'
import type {
  OrganizationUsageBreakdown,
  OrganizationUsageBreakdownRow,
  UsageBreakdownDimension,
} from '@/lib/api/contracts/organization-usage'
import {
  type RowAction,
  RowActionsMenu,
} from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { USAGE_TAB_EMPTY_COPY } from '@/ee/organization-usage/constants'

/**
 * Provider brand marks, keyed by the `providerId` the server resolves.
 *
 * Kept here rather than read from `providers/models.ts`: that module carries the
 * whole model registry and would land in this settings chunk for two dozen glyphs.
 */
const PROVIDER_ICONS: Readonly<Record<string, ComponentType<{ className?: string }>>> = {
  openai: OpenAIIcon,
  anthropic: AnthropicIcon,
  google: GoogleIcon,
  'azure-openai': AzureIcon,
  deepseek: DeepseekIcon,
  xai: xAIIcon,
  groq: GroqIcon,
  cerebras: CerebrasIcon,
  ollama: OllamaIcon,
  openrouter: OpenRouterIcon,
  mistral: MistralIcon,
}

interface UsageConsumerRowProps {
  row: OrganizationUsageBreakdownRow
  /** BYOK rows carry no cost, so tokens are the only usage they can show. */
  showTokensOnly: boolean
  onSelect?: (row: OrganizationUsageBreakdownRow) => void
  actions?: RowAction[]
}

/**
 * Width of each trailing affordance, so a list that carries one can reserve the
 * same slot on its `Other` row and keep every figure in one column.
 */
const TRAILING_SLOT_CLASSES = {
  /** `ChevronRight` at the platform icon size. */
  chevron: 'size-[14px]',
  /** `RowActionsMenu`'s trigger: a 14px glyph in a `chipVariants()` pill. */
  menu: 'size-[30px]',
} as const

/**
 * A tabular row, not `SettingsResourceRow` — tabular columns are the sanctioned
 * exception in `sim-settings-pages.md`, alongside billing invoices and credit usage.
 */
function UsageConsumerRow({ row, showTokensOnly, onSelect, actions }: UsageConsumerRowProps) {
  const ProviderIcon = row.providerId ? PROVIDER_ICONS[row.providerId] : undefined
  const Row = onSelect ? 'button' : 'div'

  return (
    <Row
      {...(onSelect
        ? {
            type: 'button' as const,
            onClick: () => onSelect(row),
            'aria-label': `Open ${row.label}`,
          }
        : {})}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg p-2 text-left',
        onSelect && 'transition-colors hover:bg-[var(--surface-active)]'
      )}
    >
      {ProviderIcon && (
        <ProviderIcon className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
      )}
      <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-sm'>{row.label}</span>
      <div
        className='h-[4px] w-[64px] flex-shrink-0 overflow-hidden rounded-full bg-[var(--border)]'
        aria-hidden='true'
      >
        <div
          className='h-full rounded-full bg-[var(--indicator-seat-filled)]'
          style={{ width: `${Math.max(2, Math.round(row.share * 100))}%` }}
        />
      </div>
      <span className='w-[72px] flex-shrink-0 text-right text-[var(--text-muted)] text-caption tabular-nums'>
        {showTokensOnly ? formatChartCompactNumber(row.tokens ?? 0) : row.credits.toLocaleString()}
      </span>
      {/* A chevron or a menu, never both — `sim-settings-pages.md`. */}
      {onSelect ? (
        <ChevronRight
          className={cn(TRAILING_SLOT_CLASSES.chevron, 'flex-shrink-0 text-[var(--text-icon)]')}
        />
      ) : actions?.length ? (
        <RowActionsMenu label={`${row.label} actions`} actions={actions} />
      ) : null}
    </Row>
  )
}

interface UsageConsumersProps {
  dimension: UsageBreakdownDimension
  breakdown?: OrganizationUsageBreakdown
  isLoading: boolean
  isError: boolean
  /** Set on Workspaces, where a row drills into that workspace's workflows. */
  onSelectRow?: (row: OrganizationUsageBreakdownRow) => void
  /** Set on Members, where a row can open the shared manage-credits modal. */
  rowActions?: (row: OrganizationUsageBreakdownRow) => RowAction[]
}

export function UsageConsumers({
  dimension,
  breakdown,
  isLoading,
  isError,
  onSelectRow,
  rowActions,
}: UsageConsumersProps) {
  if (isError) {
    return (
      <SettingsEmptyState variant='inline' tone='error'>
        Couldn't load this view.
      </SettingsEmptyState>
    )
  }
  if (isLoading || !breakdown) {
    return <SettingsEmptyState variant='inline'>Loading…</SettingsEmptyState>
  }
  if (breakdown.rows.length === 0) {
    return (
      <SettingsEmptyState variant='inline'>{USAGE_TAB_EMPTY_COPY[dimension]}</SettingsEmptyState>
    )
  }

  const showTokensOnly = dimension === 'byok'
  const trailingSlot = onSelectRow
    ? TRAILING_SLOT_CLASSES.chevron
    : rowActions
      ? TRAILING_SLOT_CLASSES.menu
      : null

  return (
    <div className='-mx-2 flex flex-col gap-y-0.5'>
      {breakdown.rows.map((row) => (
        <UsageConsumerRow
          key={`${dimension}-${row.id}`}
          row={row}
          showTokensOnly={showTokensOnly}
          {...(onSelectRow && row.id ? { onSelect: onSelectRow } : {})}
          {...(rowActions && row.id ? { actions: rowActions(row) } : {})}
        />
      ))}
      {/*
        The truncated tail, named rather than dropped: a ranked list that does not add
        up to the headline figure is how "the numbers are wrong" reports start.
      */}
      {breakdown.other.rowCount > 0 && (
        <div className='flex items-center gap-2.5 rounded-lg p-2 text-left'>
          <span className='min-w-0 flex-1 truncate text-[var(--text-muted)] text-sm'>
            {`Other (${breakdown.other.rowCount} more)`}
          </span>
          <span className='w-[72px] flex-shrink-0 text-right text-[var(--text-muted)] text-caption tabular-nums'>
            {showTokensOnly ? '—' : breakdown.other.credits.toLocaleString()}
          </span>
          {trailingSlot && (
            <span className={cn(trailingSlot, 'flex-shrink-0')} aria-hidden='true' />
          )}
        </div>
      )}
    </div>
  )
}
