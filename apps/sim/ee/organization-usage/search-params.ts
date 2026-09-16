import {
  createSerializer,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from 'nuqs/server'
import {
  USAGE_BREAKDOWN_DIMENSIONS,
  USAGE_WINDOW_PRESETS,
} from '@/lib/api/contracts/organization-usage'
import { ACTIVITY_DIMENSIONS, ACTIVITY_SORTS } from '@/lib/billing/core/organization-activity'
import { parseAsDateString } from '@/app/workspace/[workspaceId]/logs/search-params'
import {
  DEFAULT_USAGE_PRESET,
  DEFAULT_USAGE_TAB,
  USAGE_TAB_ORDER,
} from '@/ee/organization-usage/constants'

/** Custom dates stay nullable because other presets resolve their bounds server-side. */
export const organizationUsageParsers = {
  preset: parseAsStringLiteral(USAGE_WINDOW_PRESETS).withDefault(DEFAULT_USAGE_PRESET),
  startDate: parseAsDateString,
  endDate: parseAsDateString,
  tab: parseAsStringLiteral(USAGE_TAB_ORDER).withDefault(DEFAULT_USAGE_TAB),

  workspace: parseAsString,
  activityDimension: parseAsStringLiteral(ACTIVITY_DIMENSIONS).withDefault('workspace'),
  activitySort: parseAsStringLiteral(ACTIVITY_SORTS).withDefault('runs'),
  activityPage: parseAsInteger.withDefault(0),
  /** Track expanded dimensions separately because workspace detail contains multiple lists. */
  expanded: parseAsArrayOf(parseAsStringLiteral(USAGE_BREAKDOWN_DIMENSIONS)).withDefault([]),
} as const

/** Filter view-state: clean URLs, no back-stack churn, kebab-case URL keys. */
export const organizationUsageUrlKeys = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
  urlKeys: {
    startDate: 'start-date',
    endDate: 'end-date',
    activityDimension: 'activity-group',
    activitySort: 'activity-sort',
    activityPage: 'activity-page',
  },
} as const

/** Serialize links with the destination’s parser map and URL keys. */
export const serializeOrganizationUsageParams = createSerializer(organizationUsageParsers, {
  clearOnDefault: true,
  urlKeys: organizationUsageUrlKeys.urlKeys,
})
