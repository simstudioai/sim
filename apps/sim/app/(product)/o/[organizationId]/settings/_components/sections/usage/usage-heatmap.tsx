'use client'

import { useMemo, useRef, useState } from 'react'
import { FailureNotice } from '@sim/emcn/status'
import { Tooltip } from '@sim/emcn/tooltip'
import { UsageBlock } from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/usage-block'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/usage-section.module.css'
import { useUsageCalendar } from '@/platform/lib/data/usage'
import { layoutUsageCalendar, type UsageCalendarDay } from '@/platform/shared/usage'

const LEVELS = [0, 1, 2, 3, 4] as const
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'] as const
const ARROWS: Record<string, number> = {
  ArrowLeft: -7,
  ArrowRight: 7,
  ArrowUp: -1,
  ArrowDown: 1,
}

/**
 * Calendar dates stay in UTC for layout; they already describe the viewer's local days. The grid
 * flows down each week's column, so leading blanks align the first day with its weekday and no cell
 * needs a placement of its own.
 */
function Heatmap({ days }: { days: readonly UsageCalendarDay[] }) {
  const layout = useMemo(() => layoutUsageCalendar(days), [days])
  const grid = useRef<HTMLDivElement>(null)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [pinnedDate, setPinnedDate] = useState<string | null>(null)
  const pinned = layout.cells.find((cell) => cell.date === pinnedDate)
  const leading = layout.cells[0]?.row ?? 0
  const monthAt = new Map(layout.months.map((month) => [month.column, month]))
  return (
    <>
      <div className={styles.heatmap}>
        <div className={styles.heatMonths} aria-hidden='true'>
          {Array.from({ length: layout.weeks }, (_, column) => (
            <span key={column} data-type='T052'>
              {monthAt.get(column)?.label}
            </span>
          ))}
        </div>
        <div className={styles.heatBody}>
          <div className={styles.heatWeekdays} aria-hidden='true'>
            {WEEKDAYS.map((label, index) => (
              <span key={index} data-type='T052'>
                {label}
              </span>
            ))}
          </div>
          <div
            ref={grid}
            className={styles.heatGrid}
            role='group'
            aria-label='Daily credit usage. Use arrow keys to move between days, Home for the first day, or End for today.'
          >
            {Array.from({ length: leading }, (_, index) => (
              <span key={`blank-${index}`} aria-hidden='true' />
            ))}
            {layout.cells.map((cell, index) => (
              <Tooltip key={cell.date} label={cell.label}>
                <button
                  type='button'
                  className={styles.heatDay}
                  data-level={cell.level}
                  data-day={index}
                  aria-label={cell.label}
                  aria-pressed={cell.date === pinnedDate}
                  tabIndex={index === (focusedIndex ?? layout.cells.length - 1) ? 0 : -1}
                  onClick={() =>
                    setPinnedDate((current) => (current === cell.date ? null : cell.date))
                  }
                  onFocus={() => setFocusedIndex(index)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && pinnedDate) {
                      event.preventDefault()
                      setPinnedDate(null)
                      return
                    }
                    const delta = ARROWS[event.key]
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? layout.cells.length - 1
                          : delta === undefined
                            ? null
                            : Math.max(0, Math.min(layout.cells.length - 1, index + delta))
                    if (next === null) return
                    event.preventDefault()
                    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus()
                  }}
                />
              </Tooltip>
            ))}
          </div>
        </div>
      </div>
      <div className={styles.heatFooter} data-type='T060'>
        <span aria-live='polite'>{pinned ? pinned.label : layout.total}</span>
        <div
          className={styles.heatLegend}
          role='img'
          aria-label='Color intensity: less to more daily usage'
        >
          <span>Less</span>
          {LEVELS.map((level) => (
            <span key={level} className={styles.heatSwatch} data-level={level} />
          ))}
          <span>More</span>
        </div>
      </div>
    </>
  )
}

interface UsageCalendarProps {
  organizationId: string
  timezone: string
  workspaceId?: string
}

/** Loads the year separately so its history cannot delay the selected period's chart. */
export function UsageCalendar({ organizationId, timezone, workspaceId }: UsageCalendarProps) {
  const calendar = useUsageCalendar(organizationId, timezone, workspaceId)
  return (
    <UsageBlock title='Usage heatmap' note='Last 365 days'>
      {calendar.failed ? (
        <FailureNotice message='Could not load daily usage' onRetry={calendar.retry} />
      ) : !calendar.days ? null : (
        <Heatmap days={calendar.days} />
      )}
    </UsageBlock>
  )
}
