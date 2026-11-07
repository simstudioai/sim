'use client'

import { useMemo, useState } from 'react'
import { ScrollArea } from '@sim/emcn/scroll-area'
import { FailureNotice } from '@sim/emcn/status'
import styles from '@/platform/app/(shell)/settings/_components/sections/usage/usage-section.module.css'
import { useUsageCalendar } from '@/platform/lib/data/usage'
import { layoutUsageCalendar, type UsageCalendarDay } from '@/platform/shared/usage'

const CELL = 12
const SIZE = 10
const LEFT = 28
const TOP = 16
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
  const [activeDate, setActiveDate] = useState<string | null>(null)
  const selected = layout.cells.findIndex((cell) => cell.date === activeDate)
  const active = selected === -1 ? layout.cells.length - 1 : selected
  return (
    <>
      <ScrollArea label='Daily credit usage' axis='horizontal'>
        <svg
          className={styles.heatmap}
          viewBox={`0 0 ${LEFT + layout.weeks * CELL} ${TOP + 7 * CELL}`}
          role='group'
          aria-label='Daily credit usage. Use arrow keys to move between days, Home for the first day, or End for today.'
        >
          <g>
            {layout.months.map((month) => (
              <text
                key={month.date}
                className={styles.heatLabel}
                x={LEFT + month.column * CELL}
                y={10}
                fontSize={9}
              >
                {month.label}
              </text>
            ))}
            {WEEKDAYS.map((label, index) => (
              <text
                key={index}
                className={styles.heatLabel}
                x={0}
                y={TOP + index * CELL + 8}
                fontSize={9}
              >
                {label}
              </text>
            ))}
          </g>
          {layout.cells.map((cell, index) => (
            <rect
              key={cell.date}
              className={styles.heatDay}
              data-level={cell.level}
              data-day={index}
              data-active={index === active || undefined}
              x={LEFT + cell.column * CELL}
              y={TOP + cell.row * CELL}
              width={SIZE}
              height={SIZE}
              rx={2}
              role='button'
              aria-pressed={index === active}
              aria-label={cell.label}
              tabIndex={index === active ? 0 : -1}
              onPointerEnter={() => setActiveDate(cell.date)}
              onClick={() => setActiveDate(cell.date)}
              onFocus={() => setActiveDate(cell.date)}
              onKeyDown={(event) => {
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
                event.currentTarget.ownerSVGElement
                  ?.querySelector<SVGRectElement>(`[data-day="${next}"]`)
                  ?.focus()
              }}
            />
          ))}
        </svg>
      </ScrollArea>
      <p className={styles.quiet} data-type='T060' aria-live='polite'>
        {layout.cells[active] ? `${layout.cells[active].label}. ` : ''}
        {layout.total}
      </p>
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
        <h2 data-type='T093'>Usage heatmap</h2>
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
