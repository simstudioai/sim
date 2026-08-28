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

/**
 * Tall enough that the web is bound by its caption gutter rather than by height —
 * past roughly this the extra pixels become dead space above and below a web that
 * cannot grow any wider. Deliberately not matched to the ten-row list beside it: a
 * summary shape does not have to be as tall as the ranking it summarises.
 */
const SOURCE_MIX_HEIGHT = 260

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
    on every render of the panel.
  */
  const axes = useMemo<RadarChartAxis[]>(() => {
    const rows = breakdown?.rows ?? []
    const head = rows.slice(0, MAX_AXES)
    const tail = rows.slice(MAX_AXES)
    /*
      The folded axis carries the API's own remainder as well as the rows this chart
      dropped, so the web reconciles to the same total as the list beside it.

      It is deliberately *not* labelled `Other (N more)`: the chart folds at MAX_AXES
      and the list folds at COLLAPSED_ROW_COUNT, so the two counts genuinely differ,
      and printing both a few pixels apart under identical wording reads as a bug. The
      count moves into the hover row, where it is attributed.
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
              label: 'Other',
              value: otherCredits,
              display: `${otherCredits.toLocaleString()} · ${otherRowCount} sources`,
            },
          ]
        : []),
    ]
  }, [breakdown])

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

  /*
    The chart refuses fewer than three axes — a two-gon is a line, not a distribution —
    but its own fallback is a `height`-tall "No data" box, which beside a list holding
    two populated rows says the wrong thing at the wrong size. The wrapper answers
    instead, in the same inline empty state its neighbour uses.
  */
  if (axes.length < 3) {
    return <SettingsEmptyState variant='inline'>Not enough sources to compare.</SettingsEmptyState>
  }

  return <RadarChart axes={axes} color={MIX_SERIES_COLOR} height={SOURCE_MIX_HEIGHT} />
}
