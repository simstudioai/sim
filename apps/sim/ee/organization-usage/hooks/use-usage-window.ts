'use client'

import { useMemo } from 'react'
import { useQueryStates } from 'nuqs'
import {
  MAX_CUSTOM_RANGE_DAYS,
  type UsageWindowPreset,
} from '@/lib/api/contracts/organization-usage'
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

/**
 * Every rule the window resolver enforces, checked here too.
 *
 * The server refuses an unreal date, an inverted pair, and a span past the cap — each
 * as a 400. A deep link carrying any of them would otherwise be marked "resolved" and
 * fail all four queries on the page, which is a worse outcome than the fallback this
 * guard exists to provide. Duplicated deliberately, and narrowly: these are the three
 * conditions that turn a link into an error rather than into different data.
 */
function isUsableCustomRange(start: string | null, end: string | null): boolean {
  if (!isCalendarDate(start) || !isCalendarDate(end)) return false
  const from = new Date(`${start}T00:00:00.000Z`).getTime()
  const to = new Date(`${end}T00:00:00.000Z`).getTime()
  if (to < from) return false
  return Math.round((to - from) / DAY_MS) + 1 <= MAX_CUSTOM_RANGE_DAYS
}

/**
 * The panel's URL state, resolved into the window every query is keyed on.
 *
 * A `custom` preset missing either bound falls back to the default rather than
 * querying unbounded — the same partial-deep-link guard audit-logs uses.
 */
export function useUsageWindow() {
  const [state, setState] = useQueryStates(organizationUsageParsers, organizationUsageUrlKeys)
  const timezone = getBrowserTimezone()

  /**
   * Both bounds present, and a range the API will actually accept.
   *
   * Every condition the window resolver refuses with a 400 — an unreal date, an
   * inverted pair, a span past the cap — has to be checked here too, or a bookmarked
   * link carrying one is marked resolved and fails all four queries on the page. The
   * fallback exists precisely so a bad link degrades to the default window instead.
   */
  const isResolvedCustom =
    state.preset === 'custom' && isUsableCustomRange(state.startDate, state.endDate)
  const preset: UsageWindowPreset =
    state.preset === 'custom' && !isResolvedCustom ? DEFAULT_USAGE_PRESET : state.preset

  const window = useMemo<OrganizationUsageWindowKey>(
    () => ({
      preset,
      ...(isResolvedCustom
        ? { startDate: state.startDate ?? undefined, endDate: state.endDate ?? undefined }
        : {}),
      timezone,
    }),
    [preset, isResolvedCustom, state.startDate, state.endDate, timezone]
  )

  const periodLabel = isResolvedCustom
    ? `${formatDateShort(state.startDate as string)} - ${formatDateShort(state.endDate as string)}`
    : PERIOD_LABELS[preset]

  return {
    window,
    tab: state.tab,
    workspace: state.workspace,
    /**
     * The *resolved* preset, not the raw URL value. A partial custom deep link
     * queries the current period, so surfacing `state.preset` left the picker
     * reading "Custom range" over data that was not custom — and the allowance
     * gate, which keys on `current-period`, disagreed with the window too.
     */
    preset,
    startDate: state.startDate,
    endDate: state.endDate,
    periodLabel,
    setState,
  }
}
