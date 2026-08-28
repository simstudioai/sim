'use client'

import { useMemo } from 'react'
import { RadarChart, type RadarChartAxis } from '@/components/charts'
import type { OrganizationUsageBreakdown } from '@/lib/api/contracts/organization-usage'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'

/** The same series colour the credit bars use, so one period reads as one dataset. */
const MIX_SERIES_COLOR = 'var(--indicator-seat-filled)'

/**
 * Beyond this the web's captions overlap and the shape stops being readable, so the
 * tail folds into one axis — the same treatment the list gives its `Other` row.
 */
const MAX_AXES = 6

interface UsageSourceMixProps {
  breakdown?: OrganizationUsageBreakdown
  isLoading: boolean
  isError: boolean
}

/**
 * The source list's shape, beside the list itself.
 *
 * The rows answer "how much did each source cost"; they cannot answer "is this
 * organization's spend concentrated or spread", which is the question an admin
 * actually opens this tab with. Reading the same rows as a polygon makes a single
 * dominant source and an even split visibly different at a glance.
 */
export function UsageSourceMix({ breakdown, isLoading, isError }: UsageSourceMixProps) {
  /*
    Stabilized so `RadarChart`'s `memo()` can pass — built inline it was a new array
    on every render of the panel. Above the early return because hooks cannot be
    called conditionally.
  */
  const axes = useMemo<RadarChartAxis[]>(() => {
    const rows = breakdown?.rows ?? []
    const head = rows.slice(0, MAX_AXES)
    const tail = rows.slice(MAX_AXES)
    /*
      The folded axis carries the API's own remainder as well as the rows this chart
      dropped, so the web reconciles to the same total — and reads the same label — as
      the list beside it. A second presentation of one dataset that disagrees with the
      first is read as a bug in both.
    */
    const otherRowCount = tail.length + (breakdown?.other.rowCount ?? 0)
    const otherCredits =
      tail.reduce((total, row) => total + row.credits, 0) + (breakdown?.other.credits ?? 0)
    return [
      ...head.map((row) => ({
        label: row.label,
        value: row.credits,
        display: row.credits.toLocaleString(),
      })),
      ...(otherRowCount > 0
        ? [
            {
              label: `Other (${otherRowCount} more)`,
              value: otherCredits,
              display: otherCredits.toLocaleString(),
            },
          ]
        : []),
    ]
  }, [breakdown])

  if (isError) {
    return (
      <SettingsEmptyState variant='inline' tone='error'>
        Couldn't load the source mix.
      </SettingsEmptyState>
    )
  }
  if (isLoading || !breakdown) {
    return <SettingsEmptyState variant='inline'>Loading source mix…</SettingsEmptyState>
  }

  return <RadarChart axes={axes} color={MIX_SERIES_COLOR} />
}
