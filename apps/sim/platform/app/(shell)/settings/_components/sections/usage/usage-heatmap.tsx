'use client'

import { useState } from 'react'
import styles from '@/platform/app/(shell)/settings/_components/sections/usage/usage-section.module.css'
import { Button, InlineNotice, ScrollArea } from '@/platform/design-system/components'
import {
  formatDayUsage,
  formatYearUsage,
  type UsageCalendarDay,
  useUsageCalendar,
} from '@/platform/lib/data/usage'
import { formatCalendarDate } from '@/platform/lib/time'

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
  const [active, setActive] = useState(days.length - 1)
  const first = days[0]
  if (!first) return null
  const offset = (new Date(`${first.date}T00:00:00Z`).getUTCDay() + 6) % 7
  const weeks = Math.ceil((offset + days.length) / 7)
  const peak = Math.max(...days.map((day) => day.credits), 1)
  const activeDay = days[active]
  const months = days.flatMap((day, index) => {
    if (!day.date.endsWith('-01')) return []
    const column = Math.floor((index + offset) / 7)
    return column > weeks - 3
      ? []
      : [{ date: day.date, column, label: formatCalendarDate(day.date).split(' ')[0] }]
  })
  return (
    <>
      <ScrollArea label='Daily credit usage' axis='horizontal'>
        <svg
          className={styles.heatmap}
          viewBox={`0 0 ${LEFT + weeks * CELL} ${TOP + 7 * CELL}`}
          role='group'
          aria-label='Daily credit usage. Use arrow keys to move between days, Home for the first day, or End for today.'
        >
          <g>
            {months.map((month) => (
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
          {days.map((day, index) => {
            const position = index + offset
            const level = day.hasCost
              ? Math.max(1, Math.min(4, Math.ceil(Math.sqrt(day.credits / peak) * 4)))
              : 0
            return (
              <rect
                key={day.date}
                className={styles.heatDay}
                data-level={level}
                data-day={index}
                data-active={index === active || undefined}
                x={LEFT + Math.floor(position / 7) * CELL}
                y={TOP + (position % 7) * CELL}
                width={SIZE}
                height={SIZE}
                rx={2}
                role='button'
                aria-pressed={index === active}
                aria-label={formatDayUsage(day)}
                tabIndex={index === active ? 0 : -1}
                onPointerEnter={() => setActive(index)}
                onClick={() => setActive(index)}
                onFocus={() => setActive(index)}
                onKeyDown={(event) => {
                  const delta = ARROWS[event.key]
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? days.length - 1
                        : delta === undefined
                          ? null
                          : Math.max(0, Math.min(days.length - 1, index + delta))
                  if (next === null) return
                  event.preventDefault()
                  event.currentTarget.ownerSVGElement
                    ?.querySelector<SVGRectElement>(`[data-day="${next}"]`)
                    ?.focus()
                }}
              />
            )
          })}
        </svg>
      </ScrollArea>
      <p className={styles.quiet} data-type='T060' aria-live='polite'>
        {activeDay ? `${formatDayUsage(activeDay)}. ` : ''}
        {formatYearUsage(days)}
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
      {calendar.failed || !calendar.days ? (
        calendar.pending ? (
          <span className={styles.listPlaceholder} role='status' aria-label='Loading daily usage' />
        ) : (
          <InlineNotice
            intent='danger'
            message='Could not load daily usage'
            action={
              <Button variant='quiet' size='compact' onClick={calendar.retry}>
                Retry
              </Button>
            }
          />
        )
      ) : (
        <Heatmap days={calendar.days} />
      )}
    </section>
  )
}
