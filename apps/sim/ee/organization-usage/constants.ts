import type { ComboboxOption } from '@sim/emcn'
import {
  ORGANIZATION_USAGE_BREAKDOWN_DEFAULT_LIMIT,
  ORGANIZATION_USAGE_BREAKDOWN_MAX_LIMIT,
  type OrganizationUsageSource,
  USAGE_WINDOW_PRESETS,
  type UsageBreakdownDimension,
  type UsageWindowPreset,
} from '@/lib/api/contracts/organization-usage'

/**
 * Total by construction, so resolving a preset's label needs no fallback — a `Record`
 * over the union cannot miss a case, where a `find` over an array always can.
 */
export const PERIOD_LABELS: Record<UsageWindowPreset, string> = {
  'current-period': 'Current period',
  'previous-period': 'Previous period',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  custom: 'Custom range',
}

export const PERIOD_OPTIONS: ComboboxOption[] = USAGE_WINDOW_PRESETS.map((preset) => ({
  value: preset,
  label: PERIOD_LABELS[preset],
}))

export const USAGE_OVERVIEW_TAB = 'overview' as const
export type UsageTab =
  | typeof USAGE_OVERVIEW_TAB
  | 'activity'
  | 'member'
  | 'workspace'
  | 'model'
  | 'byok'

/**
 * Activity ranks retained executions; the member, workspace, and model tabs rank
 * ledger spend. Workflow spend remains within the workspace drill-down because
 * charges from other sources do not carry workflow attribution.
 */
export const USAGE_TAB_ORDER: readonly UsageTab[] = [
  USAGE_OVERVIEW_TAB,
  'activity',
  'member',
  'workspace',
  'model',
  /*
    'byok' is withheld, not removed: no usage has been recorded against a
    bring-your-own-key provider yet, so the tab could only show its empty state.
    Re-add it here once the ledger carries BYOK rows — the dimension, its labels,
    its token unit, and the breakdown query all still work.
  */
]

export const USAGE_TAB_LABELS: Record<UsageTab, string> = {
  overview: 'Overview',
  activity: 'Activity',
  member: 'Members',
  workspace: 'Workspaces',
  model: 'Models',
  byok: 'BYOK',
}

/** Section heading per view, so a list is never an unlabelled slab of rows. */
export const USAGE_SECTION_LABELS: Record<UsageBreakdownDimension, string> = {
  member: 'Members',
  workspace: 'Workspaces',
  workflow: 'Workflows',
  model: 'Models',
  byok: 'BYOK',
  source: 'Sources',
}

/** Empty-state copy per view, so a quiet dimension says which one it means. */
export const USAGE_TAB_EMPTY_COPY: Record<UsageBreakdownDimension, string> = {
  member: 'No member used credits in this period.',
  workspace: 'No workspace used credits in this period.',
  workflow: 'No workflow ran in this workspace in this period.',
  model: 'No models ran in this period.',
  byok: 'No usage on your own provider keys in this period.',
  source: 'Nothing consumed credits in this period.',
}

/**
 * Rows per breakdown before and after the `Other` row is expanded.
 *
 * Each tab shows the contract default immediately, then can request the contract
 * ceiling by expanding `Other`. A dimension with more than
 * {@link EXPANDED_ROW_COUNT} distinct rows still shows a remainder after expanding.
 */
export const COLLAPSED_ROW_COUNT = ORGANIZATION_USAGE_BREAKDOWN_DEFAULT_LIMIT
export const EXPANDED_ROW_COUNT = ORGANIZATION_USAGE_BREAKDOWN_MAX_LIMIT

export const DEFAULT_USAGE_PRESET = '30d' as const
export const DEFAULT_USAGE_TAB = USAGE_OVERVIEW_TAB

/** Sim Chat's color, shared by its credit layer and the chat-runs chart. */
export const USAGE_CHAT_COLOR = 'var(--usage-chat)'

/** The neutral remainder, shared by the credit and outcome stacks. */
export const USAGE_OTHER_COLOR = 'var(--usage-other)'

/**
 * The credit chart's layers, bottom-up. Each one owns a fixed color, so a layer keeps
 * its color when a quieter period drops its neighbours — color follows the source,
 * never its rank.
 *
 * Five hues plus a neutral `Other`: the palette is validated for adjacent-pair
 * separation (including color-vision deficiency) in both modes in exactly this order,
 * so reorder or extend it only by re-running that validation. A sixth distinct source
 * belongs in `Other`, not in a generated hue.
 */
export const USAGE_SOURCE_CATEGORIES = [
  { id: 'workflow', label: 'Workflows', color: 'var(--brand-blue)' },
  { id: 'chat', label: 'Sim Chat', color: USAGE_CHAT_COLOR },
  { id: 'enrichment', label: 'Enrichment', color: 'var(--usage-enrichment)' },
  { id: 'knowledge', label: 'Knowledge Base', color: 'var(--usage-knowledge)' },
  { id: 'agent', label: 'Agent block', color: 'var(--usage-agent)' },
  { id: 'other', label: 'Other', color: USAGE_OTHER_COLOR },
] as const

export type UsageSourceCategoryId = (typeof USAGE_SOURCE_CATEGORIES)[number]['id']

/** Total over the ledger's sources, so a new source cannot ship without a layer. */
export const USAGE_SOURCE_CATEGORY: Record<OrganizationUsageSource, UsageSourceCategoryId> = {
  workflow: 'workflow',
  'sim-chat': 'chat',
  mcp_copilot: 'chat',
  mothership_block: 'agent',
  'knowledge-base': 'knowledge',
  enrichment: 'enrichment',
  wand: 'other',
  'voice-input': 'other',
  'voice-output': 'other',
  'api-tool': 'other',
}
