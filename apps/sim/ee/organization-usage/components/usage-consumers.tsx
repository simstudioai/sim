'use client'

import type { ComponentType } from 'react'
import { cn, disclosureChevronClass } from '@sim/emcn'
import { ArrowRight, ChevronDown } from '@sim/emcn/icons'
import { formatChartCompactNumber } from '@/components/charts'
import {
  AnthropicIcon,
  AzureIcon,
  BasetenIcon,
  BedrockIcon,
  CerebrasIcon,
  DeepseekIcon,
  FireworksIcon,
  GeminiIcon,
  GroqIcon,
  KimiIcon,
  LitellmIcon,
  MetaIcon,
  MistralIcon,
  NvidiaIcon,
  OllamaIcon,
  OpenAIIcon,
  OpenRouterIcon,
  SakanaIcon,
  TogetherIcon,
  VertexIcon,
  VllmIcon,
  xAIIcon,
  ZaiIcon,
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
import { RESOURCE_ROW_ARROW_CLASSES } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { USAGE_TAB_EMPTY_COPY } from '@/ee/organization-usage/constants'

/**
 * Provider brand marks, keyed by the `providerId` the server resolves.
 *
 * Kept here rather than read from `PROVIDER_DEFINITIONS`: that module carries the
 * whole model registry and would land in this settings chunk for two dozen glyphs.
 * The icons themselves come from the same `@/components/icons` module the registry
 * imports, so this is a re-keying, never a second set of artwork.
 *
 * It must list every provider the registry defines, or a model resolving to a
 * missing one renders an unexplained blank where every neighbouring row has a mark
 * — which is how `zai` (GLM) shipped iconless. `usage-consumers.test.ts` fails when
 * the two drift, so the coverage is checked rather than remembered.
 */
const PROVIDER_ICONS: Readonly<Record<string, ComponentType<{ className?: string }>>> = {
  anthropic: AnthropicIcon,
  baseten: BasetenIcon,
  bedrock: BedrockIcon,
  cerebras: CerebrasIcon,
  deepseek: DeepseekIcon,
  fireworks: FireworksIcon,
  google: GeminiIcon,
  groq: GroqIcon,
  kimi: KimiIcon,
  litellm: LitellmIcon,
  meta: MetaIcon,
  mistral: MistralIcon,
  nvidia: NvidiaIcon,
  ollama: OllamaIcon,
  'ollama-cloud': OllamaIcon,
  openai: OpenAIIcon,
  openrouter: OpenRouterIcon,
  sakana: SakanaIcon,
  together: TogetherIcon,
  vertex: VertexIcon,
  vllm: VllmIcon,
  xai: xAIIcon,
  zai: ZaiIcon,
  'azure-anthropic': AzureIcon,
  /** Not a registry provider — a BYOK credential kind the breakdown can also emit. */
  'azure-openai': AzureIcon,
}

export const USAGE_PROVIDER_ICON_IDS = Object.keys(PROVIDER_ICONS)

interface UsageConsumerRowProps {
  row: OrganizationUsageBreakdownRow
  /** BYOK rows carry no cost, so tokens are the only usage they can show. */
  showTokensOnly: boolean
  onSelect?: (row: OrganizationUsageBreakdownRow) => void
  actions?: RowAction[]
  /**
   * Width of the affordance some other row in this list carries, reserved here so
   * every figure stays in one column — including when the only row that carries one
   * is `Other`.
   */
  reservedTrailing?: string
}

/**
 * Width of each trailing affordance, so a list that carries one can reserve the
 * same slot on its `Other` row and keep every figure in one column.
 */
const TRAILING_SLOT_CLASSES = {
  arrow: 'size-4',
  /** `RowActionsMenu`'s trigger: a 14px glyph in a `chipVariants()` pill. */
  menu: 'size-[30px]',
  /** The disclosure chevron on an expandable `Other` row, at the default icon size. */
  disclosure: 'size-[14px]',
} as const

/**
 * Geometry of the bespoke tabular usage row — the sanctioned exception to
 * `SettingsResourceRow` in `sim-settings-pages.md`. One definition, so the breakdown
 * rows, the `Other` row, and the events ledger cannot drift apart.
 */
export const USAGE_ROW_CLASSES = 'flex w-full items-center gap-2.5 rounded-lg p-2 text-left'

/**
 * A tabular row, not `SettingsResourceRow` — tabular columns are the sanctioned
 * exception in `sim-settings-pages.md`, alongside billing invoices and credit usage.
 */
function UsageConsumerRow({
  row,
  showTokensOnly,
  onSelect,
  actions,
  reservedTrailing,
}: UsageConsumerRowProps) {
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
        USAGE_ROW_CLASSES,
        onSelect && 'transition-colors hover-hover:bg-[var(--surface-active)]'
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
      {/* An arrow or a menu, never both — `sim-settings-pages.md`. */}
      {onSelect ? (
        <ArrowRight className={RESOURCE_ROW_ARROW_CLASSES} />
      ) : actions?.length ? (
        <RowActionsMenu label={`${row.label} actions`} actions={actions} />
      ) : reservedTrailing ? (
        <span className={cn(reservedTrailing, 'flex-shrink-0')} aria-hidden='true' />
      ) : null}
    </Row>
  )
}

interface UsageConsumersProps {
  dimension: UsageBreakdownDimension
  breakdown?: OrganizationUsageBreakdown
  isLoading: boolean
  isError: boolean
  /** Dims the list while a re-keyed fetch resolves, rather than blanking it. */
  isPlaceholderData?: boolean
  /** Set on Workspaces, where a row drills into that workspace's workflows. */
  onSelectRow?: (row: OrganizationUsageBreakdownRow) => void
  /** Set on Members, where a row can open the shared manage-credits modal. */
  rowActions?: (row: OrganizationUsageBreakdownRow) => RowAction[]
  /**
   * Opens the truncated tail. Omitted when the list is already showing everything the
   * API will return, which is the one case where the `Other` row has nothing to open.
   */
  onExpandOther?: () => void
}

export function UsageConsumers({
  dimension,
  breakdown,
  isLoading,
  isError,
  isPlaceholderData,
  onSelectRow,
  rowActions,
  onExpandOther,
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
    ? TRAILING_SLOT_CLASSES.arrow
    : rowActions
      ? TRAILING_SLOT_CLASSES.menu
      : onExpandOther
        ? TRAILING_SLOT_CLASSES.disclosure
        : null

  return (
    <div
      className={cn(
        '-mx-2 flex flex-col gap-y-0.5',
        isPlaceholderData && 'opacity-50 transition-opacity'
      )}
    >
      {breakdown.rows.map((row) => (
        <UsageConsumerRow
          key={`${dimension}-${row.id}`}
          row={row}
          showTokensOnly={showTokensOnly}
          {...(onExpandOther && trailingSlot ? { reservedTrailing: trailingSlot } : {})}
          {...(onSelectRow && row.id ? { onSelect: onSelectRow } : {})}
          {...(rowActions && row.id ? { actions: rowActions(row) } : {})}
        />
      ))}
      {/*
        The truncated tail, named rather than dropped: a ranked list that does not add
        up to the headline figure is how "the numbers are wrong" reports start.

        A button when there is more the API can return, so the tail opens in place.
        Past the API's ceiling it stays a plain row — a control that cannot change
        what you see is worse than no control.
      */}
      {breakdown.other.rowCount > 0 &&
        (() => {
          const OtherRow = onExpandOther ? 'button' : 'div'
          return (
            <OtherRow
              {...(onExpandOther
                ? {
                    type: 'button' as const,
                    onClick: onExpandOther,
                    'aria-label': `Show the remaining ${breakdown.other.rowCount}`,
                  }
                : {})}
              className={cn(
                USAGE_ROW_CLASSES,
                onExpandOther && 'transition-colors hover-hover:bg-[var(--surface-active)]'
              )}
            >
              <span className='min-w-0 flex-1 truncate text-[var(--text-muted)] text-sm'>
                {`Other (${breakdown.other.rowCount} more)`}
              </span>
              <span className='w-[72px] flex-shrink-0 text-right text-[var(--text-muted)] text-caption tabular-nums'>
                {showTokensOnly
                  ? formatChartCompactNumber(breakdown.other.tokens)
                  : breakdown.other.credits.toLocaleString()}
              </span>
              {/*
                Centred in the slot the rows above reserve rather than sized to the
                glyph: with a navigable or action-bearing list the reserved slot is
                wider than the chevron, and drawing it bare pulled this row's figure
                out of the column.
              */}
              {trailingSlot && (
                <span
                  className={cn(trailingSlot, 'flex flex-shrink-0 items-center justify-center')}
                  aria-hidden='true'
                >
                  {onExpandOther && <ChevronDown className={disclosureChevronClass} />}
                </span>
              )}
            </OtherRow>
          )
        })()}
    </div>
  )
}
