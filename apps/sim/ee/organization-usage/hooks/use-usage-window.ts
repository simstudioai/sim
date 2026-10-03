'use client'

import { useQueryStates } from 'nuqs'
import {
  MAX_CUSTOM_RANGE_DAYS,
  type UsageWindowPreset,
} from '@/lib/api/contracts/organization-usage'
import { ACTIVITY_MAX_PAGE } from '@/lib/billing/core/organization-activity'
import { formatDateShort } from '@/lib/core/utils/date-display'
import { getBrowserTimezone } from '@/lib/core/utils/timezone'
import { DEFAULT_USAGE_PRESET, PERIOD_LABELS } from '@/ee/organization-usage/constants'
import {
  organizationUsageParsers,
  organizationUsageUrlKeys,
} from '@/ee/organization-usage/search-params'
import type { OrganizationUsageWindowKey } from '@/hooks/queries/utils/organization-usage-keys'

const DAY_MS = 24 * 60 * 60 * 1000

/** A bare `YYYY-MM-DD` that survives a calendar round-trip — the contract's rule, verbatim. */
function isCalendarDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
}

/** Match server date validation so invalid links fall back before issuing requests. */
export function isUsableCustomRange(start: string | null, end: string | null): boolean {
  if (!isCalendarDate(start) || !isCalendarDate(end)) return false
  const from = new Date(`${start}T00:00:00.000Z`).getTime()
  const to = new Date(`${end}T00:00:00.000Z`).getTime()
  if (to < from) return false
  return Math.round((to - from) / DAY_MS) + 1 <= MAX_CUSTOM_RANGE_DAYS
}

/** Resolve shared URL filters, falling back when a custom range is invalid. */
export function useUsageWindow() {
  const [state, setState] = useQueryStates(organizationUsageParsers, organizationUsageUrlKeys)
  const timezone = getBrowserTimezone()

  const isResolvedCustom =
    state.preset === 'custom' && isUsableCustomRange(state.startDate, state.endDate)
  const preset: UsageWindowPreset =
    state.preset === 'custom' && !isResolvedCustom ? DEFAULT_USAGE_PRESET : state.preset

  const window: OrganizationUsageWindowKey = {
    preset,
    ...(isResolvedCustom
      ? { startDate: state.startDate ?? undefined, endDate: state.endDate ?? undefined }
      : {}),
    timezone,
  }

  const periodLabel = isResolvedCustom
    ? `${formatDateShort(state.startDate as string)} - ${formatDateShort(state.endDate as string)}`
    : PERIOD_LABELS[preset]

  return {
    window,
    tab: state.tab,
    workspace: state.workspace,
    activityDimension: state.activityDimension,
    activitySort: state.activitySort,
    activityPage: Math.min(ACTIVITY_MAX_PAGE, Math.max(0, state.activityPage)),
    expanded: state.expanded,
    preset,
    startDate: state.startDate,
    endDate: state.endDate,
    periodLabel,
    setState,
  }
}
