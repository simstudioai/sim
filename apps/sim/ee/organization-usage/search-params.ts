import { parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { USAGE_WINDOW_PRESETS } from '@/lib/api/contracts/organization-usage'
import { parseAsDateString } from '@/app/workspace/[workspaceId]/logs/search-params'
import {
  DEFAULT_USAGE_PRESET,
  DEFAULT_USAGE_TAB,
  USAGE_TAB_ORDER,
} from '@/ee/organization-usage/constants'

/**
 * URL state for the organization usage panel.
 *
 * `startDate`/`endDate` are deliberately nullable (no `.withDefault`): they exist only
 * while `preset` is `custom`. Every other preset derives its window server-side from
 * the organization's subscription period, so a default here would be meaningless — and
 * worse, would silently pin the window to a stale date.
 */
export const organizationUsageParsers = {
  preset: parseAsStringLiteral(USAGE_WINDOW_PRESETS).withDefault(DEFAULT_USAGE_PRESET),
  startDate: parseAsDateString,
  endDate: parseAsDateString,
  tab: parseAsStringLiteral(USAGE_TAB_ORDER).withDefault(DEFAULT_USAGE_TAB),
  /**
   * Nullable by design: only the id is stored, and the detail view opens only once it
   * resolves against the loaded list — a stale id from an old link falls back to the
   * list rather than rendering an empty drill-down.
   */
  workspace: parseAsString,
} as const

/** Filter view-state: clean URLs, no back-stack churn, kebab-case URL keys. */
export const organizationUsageUrlKeys = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
  urlKeys: {
    startDate: 'start-date',
    endDate: 'end-date',
  },
} as const
