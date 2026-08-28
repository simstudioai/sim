import { createSerializer, parseAsBoolean, parseAsString, parseAsStringLiteral } from 'nuqs/server'
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
  /**
   * Whether the visible breakdown's `Other` row has been opened. In the URL because
   * it is shareable view-state like every other filter here — and because it changes
   * which rows the page fetched, so a shared link that omitted it would not show the
   * list the sender was looking at.
   */
  expanded: parseAsBoolean.withDefault(false),
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

/**
 * Outbound links into the usage drill-downs, serialized from the same parser map the
 * destination reads. Hand-writing the wire keys duplicated the `urlKeys` remap, so
 * renaming `start-date` would have silently dropped the window from every such link —
 * exactly the panel/drill-down disagreement the events href exists to prevent.
 */
export const serializeOrganizationUsageParams = createSerializer(organizationUsageParsers, {
  clearOnDefault: true,
  urlKeys: organizationUsageUrlKeys.urlKeys,
})
