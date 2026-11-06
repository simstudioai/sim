'use client'

import { useMemo, useRef, useState } from 'react'
import { FailureNotice, ScrollArea, Tooltip } from '@/platform/design-system/components'
import styles from '@/platform/embedded/app/(shell)/settings/_components/sections/usage/usage-section.module.css'
import {
  layoutUsageCalendar,
  type UsageCalendarDay,
  useUsageCalendar,
} from '@/platform/embedded/lib/data/usage'

const LEVELS = [0, 1, 2, 3, 4] as const
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'] as const
const ARROWS: Record<string, number> = {
  ArrowLeft: -7,
  ArrowRight: 7,
  ArrowUp: -1,
  ArrowDown: 1,
}

/** Calendar dates stay in UTC for layout; they already describe the viewer's local days. */
function Heatmap({ days }: { days: readonly UsageCalendarDay[] }) {
  const layout = useMemo(() => layoutUsageCalendar(days), [days])
  const grid = useRef<HTMLDivElement>(null)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [pinnedDate, setPinnedDate] = useState<string | null>(null)
  const pinned = layout.cells.find((cell) => cell.date === pinnedDate)
  const columns = { gridTemplateColumns: `repeat(${layout.weeks}, minmax(0, 1fr))` }
  return (
    <>
      <ScrollArea label='Daily credit usage' axis='horizontal'>
        <div className={styles.heatmap}>
          <div className={styles.heatMonths} style={columns} aria-hidden='true'>
            {layout.months.map((month) => (
              <span
                key={month.date}
                data-type='T052'
                style={{ gridColumn: `${month.column + 1} / span 3` }}
              >
                {month.label}
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
              style={columns}
              role='group'
              aria-label='Daily credit usage. Use arrow keys to move between days, Home for the first day, or End for today.'
            >
              {layout.cells.map((cell, index) => (
                <div
                  key={cell.date}
                  className={styles.heatCell}
                  style={{ gridColumn: cell.column + 1, gridRow: cell.row + 1 }}
                >
                  <Tooltip label={cell.label}>
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
                        grid.current
                          ?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)
                          ?.focus()
                      }}
                    />
                  </Tooltip>
                </div>
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>
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
    <section className={styles.block} aria-label='Usage heatmap'>
      <div className={styles.heading}>
        <h2 data-type='T042'>Usage heatmap</h2>
        <span className={styles.quiet} data-type='T060'>
          Last 365 days
        </span>
      </div>
      {calendar.failed ? (
        <FailureNotice message='Could not load daily usage' onRetry={calendar.retry} />
      ) : !calendar.days ? (
        <span className={styles.listPlaceholder} role='status' aria-label='Loading daily usage' />
      ) : (
        <Heatmap days={calendar.days} />
      )}
    </section>
  )
}
