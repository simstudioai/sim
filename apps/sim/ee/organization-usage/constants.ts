import type { ComboboxOption } from '@sim/emcn'
import {
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
export type UsageTab = typeof USAGE_OVERVIEW_TAB | 'member' | 'workspace' | 'model' | 'byok'

/**
 * The panel reads as one question per tab, in the order an admin asks them:
 * how much (Overview, which also answers *what kind* via its source mix), then who,
 * then where, then on what.
 *
 * Workflows is deliberately not a tab. A workflow is only meaningful inside its
 * workspace, and a flat org-wide workflow list is dominated by a bucket of usage that
 * has no workflow at all — so it lives as the Workspaces drill-down instead.
 */
export const USAGE_TAB_ORDER: readonly UsageTab[] = [
  USAGE_OVERVIEW_TAB,
  'member',
  'workspace',
  'model',
  /*
    'byok' is withheld, not removed. No usage has been recorded against a
    bring-your-own-key provider yet, so the tab could only ever show its empty
    state. Restore this entry once the ledger carries BYOK rows — the dimension,
    its labels, its token unit, and the breakdown query all still work.
  */
  // 'byok',
]

export const USAGE_TAB_LABELS: Record<UsageTab, string> = {
  overview: 'Overview',
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
 * The collapsed count keeps a tab to one screen; the expanded one is the contract's
 * own ceiling (`usageLimitSchema(50, 10)`), so asking for more would be refused. A
 * dimension with more than {@link EXPANDED_ROW_COUNT} distinct rows still shows an
 * `Other` row after expanding, which is the honest result rather than a bug.
 */
export const COLLAPSED_ROW_COUNT = 10
export const EXPANDED_ROW_COUNT = 50

export const DEFAULT_USAGE_PRESET = 'current-period' as const
export const DEFAULT_USAGE_TAB = USAGE_OVERVIEW_TAB
