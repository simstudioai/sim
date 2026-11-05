'use client'

import { type KeyboardEvent, type RefObject, useState } from 'react'
import { flushSync } from 'react-dom'
import { IconButton } from '@/platform/design-system/components/button/button'
import styles from '@/platform/design-system/components/picker/calendar.module.css'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const
const WEEKDAYS = [
  ['Su', 'Sunday'],
  ['Mo', 'Monday'],
  ['Tu', 'Tuesday'],
  ['We', 'Wednesday'],
  ['Th', 'Thursday'],
  ['Fr', 'Friday'],
  ['Sa', 'Saturday'],
] as const
const WEEKS_SHOWN = 6

/** Calendar days stay ISO strings, computed in UTC so no viewer's zone can shift them. */
function toDate(day: string) {
  return new Date(`${day}T00:00:00Z`)
}

function toDay(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(day: string, amount: number) {
  const date = toDate(day)
  date.setUTCDate(date.getUTCDate() + amount)
  return toDay(date)
}

function addMonths(day: string, amount: number) {
  const date = toDate(day)
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0))
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay.getUTCDate()))
  return toDay(target)
}

function viewerToday() {
  const now = new Date()
  return toDay(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())))
}

/** `Nov 4, 2026`, for an ISO calendar day. */
export function formatDay(day: string) {
  const date = toDate(day)
  const month = MONTHS[date.getUTCMonth()].slice(0, 3)
  return `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
}

interface CalendarProps {
  label: string
  start?: string
  end?: string
  min?: string
  max?: string
  /** Receives the day that should take focus when the popup opens. */
  focusTarget: RefObject<HTMLButtonElement | null>
  onSelect: (day: string) => void
}

export function Calendar({ label, start, end, min, max, focusTarget, onSelect }: CalendarProps) {
  const today = viewerToday()
  const clamp = (day: string) => {
    if (min && day < min) return min
    if (max && day > max) return max
    return day
  }
  const [cursor, setCursor] = useState(() => clamp(start ?? today))
  const [navigating, setNavigating] = useState(false)

  const cursorDate = toDate(cursor)
  const firstOfMonth = addDays(cursor, 1 - cursorDate.getUTCDate())
  const gridStart = addDays(firstOfMonth, -toDate(firstOfMonth).getUTCDay())
  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => addDays(gridStart, week * 7 + weekday))
  )
  const monthTitle = `${MONTHS[cursorDate.getUTCMonth()]} ${cursorDate.getUTCFullYear()}`

  function moveCursor(day: string) {
    flushSync(() => {
      setNavigating(true)
      setCursor(clamp(day))
    })
    focusTarget.current?.focus()
  }

  function handleKeyDown(event: KeyboardEvent) {
    const weekday = cursorDate.getUTCDay()
    const target = {
      ArrowLeft: addDays(cursor, -1),
      ArrowRight: addDays(cursor, 1),
      ArrowUp: addDays(cursor, -7),
      ArrowDown: addDays(cursor, 7),
      Home: addDays(cursor, -weekday),
      End: addDays(cursor, 6 - weekday),
      PageUp: addMonths(cursor, -1),
      PageDown: addMonths(cursor, 1),
    }[event.key]
    if (!target) return
    event.preventDefault()
    moveCursor(target)
  }

  return (
    <div className={styles.calendar}>
      <div className={styles.header}>
        <span className={styles.previous}>
          <IconButton
            label='Previous month'
            icon='I032'
            onClick={() => setCursor(clamp(addMonths(cursor, -1)))}
          />
        </span>
        <span aria-live='polite' data-type='T059'>
          {monthTitle}
        </span>
        <IconButton
          label='Next month'
          icon='I032'
          onClick={() => setCursor(clamp(addMonths(cursor, 1)))}
        />
      </div>
      <div className={styles.grid} role='grid' aria-label={`${label}, ${monthTitle}`}>
        <div className={styles.week} role='row'>
          {WEEKDAYS.map(([short, full]) => (
            <span
              key={full}
              className={styles.weekday}
              role='columnheader'
              aria-label={full}
              data-type='T052'
            >
              {short}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className={styles.week} role='row'>
            {week.map((day) => {
              const unavailable = Boolean((min && day < min) || (max && day > max))
              const selected = day === start || day === end
              return (
                <span key={day} role='gridcell' aria-selected={selected}>
                  <button
                    ref={day === cursor ? focusTarget : undefined}
                    type='button'
                    className={styles.day}
                    tabIndex={day === cursor ? 0 : -1}
                    aria-label={formatDay(day)}
                    aria-current={day === today ? 'date' : undefined}
                    aria-disabled={unavailable || undefined}
                    data-selected={selected || undefined}
                    data-in-range={(start && end && day > start && day < end) || undefined}
                    data-outside={
                      toDate(day).getUTCMonth() !== cursorDate.getUTCMonth() || undefined
                    }
                    data-active={(navigating && day === cursor) || undefined}
                    data-type='T060'
                    onClick={() => {
                      if (unavailable) return
                      setCursor(day)
                      onSelect(day)
                    }}
                    onKeyDown={handleKeyDown}
                  >
                    {toDate(day).getUTCDate()}
                  </button>
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
