'use client'

import { useMemo } from 'react'
import { useQueryStates } from 'nuqs'
import type { UsageWindowPreset } from '@/lib/api/contracts/organization-usage'
import { formatDateShort } from '@/lib/core/utils/date-display'
import { getBrowserTimezone } from '@/lib/core/utils/timezone'
import { DEFAULT_USAGE_PRESET, PERIOD_LABELS } from '@/ee/organization-usage/constants'
import {
  organizationUsageParsers,
  organizationUsageUrlKeys,
} from '@/ee/organization-usage/search-params'
import type { OrganizationUsageWindowKey } from '@/hooks/queries/utils/organization-usage-keys'

/**
 * The panel's URL state, resolved into the window every query is keyed on.
 *
 * A `custom` preset missing either bound falls back to the default rather than
 * querying unbounded — the same partial-deep-link guard audit-logs uses.
 */
export function useUsageWindow() {
  const [state, setState] = useQueryStates(organizationUsageParsers, organizationUsageUrlKeys)
  const timezone = getBrowserTimezone()

  const isResolvedCustom =
    state.preset === 'custom' && Boolean(state.startDate) && Boolean(state.endDate)
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
