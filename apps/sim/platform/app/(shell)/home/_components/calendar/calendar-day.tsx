'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import styles from '@/platform/app/(shell)/home/_components/calendar/calendar-day.module.css'
import type { HomeData } from '@/platform/app/(shell)/home/_components/model'
import { AvatarGroup, Button, IconButton, OverflowText } from '@/platform/design-system/components'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import { formatCalendarDate, formatClockTime, formatTimeRange } from '@/platform/lib/time'

interface CalendarDayProps {
  calendar: HomeData['calendar']
}

const HOURS = Array.from({ length: 24 }, (_, hour) => formatClockTime(hour * 3_600_000))

function timeSlot(startMinute: number, duration = 1) {
  return `${startMinute + 1} / span ${duration}`
}

export function CalendarDay({ calendar }: CalendarDayProps) {
  const [offset, setOffset] = useState(0)
  const [returnCount, setReturnCount] = useState(0)
  const [timeVisible, setTimeVisible] = useState(true)
  const viewport = useRef<HTMLDivElement>(null)
  const now = useRef<HTMLSpanElement>(null)
  const scrollEdges = useScrollEdges('vertical', { viewport, tabStop: true })

  useLayoutEffect(() => {
    const marker = now.current
    const root = viewport.current
    if (!marker || !root) return
    root.scrollTop = marker.offsetTop + (marker.offsetHeight - root.clientHeight) / 2
    const observer = new IntersectionObserver(([entry]) => setTimeVisible(entry.isIntersecting), {
      root,
    })
    observer.observe(marker)
    return () => observer.disconnect()
  }, [calendar.date, calendar.nowMinute, offset, returnCount])

  useLayoutEffect(() => {
    if (returnCount) viewport.current?.focus({ preventScroll: true })
  }, [returnCount])

  function returnToNow() {
    setOffset(0)
    // Replacing the viewport cancels an in-flight native keyboard or momentum scroll.
    setReturnCount((count) => count + 1)
  }

  const date = new Date(`${calendar.date}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  const dayLabel = formatCalendarDate(date.toISOString().slice(0, 10), 'weekday')
  return (
    <>
      <div className={styles.toolbar}>
        <span data-type='T052'>{dayLabel}</span>
        <div className={styles.dayControls}>
          {(offset !== 0 || !timeVisible) && (
            <Button variant='quiet' size='compact' onClick={returnToNow}>
              Now
            </Button>
          )}
          <IconButton
            icon='I032'
            label='Previous day'
            tooltip
            onClick={() => setOffset((day) => day - 1)}
          />
          <IconButton
            icon='I032'
            label='Next day'
            tooltip
            onClick={() => setOffset((day) => day + 1)}
          />
        </div>
      </div>
      <div
        key={returnCount}
        ref={scrollEdges}
        role='region'
        aria-label='Calendar schedule'
        className={styles.viewport}
      >
        <div className={styles.timeline}>
          {HOURS.map((time, index) => (
            <span
              key={time}
              className={styles.hour}
              data-type='T035'
              style={{ gridRow: timeSlot(index * 60, 60) }}
            >
              {time}
            </span>
          ))}
          {offset === 0 &&
            calendar.meetings.map((event) => {
              const href =
                event.providerUrl?.startsWith('https://') && URL.canParse(event.providerUrl)
                  ? event.providerUrl
                  : undefined
              return (
                <article
                  key={event.id}
                  className={styles.event}
                  style={{ gridRow: timeSlot(event.startMinute, event.duration) }}
                >
                  <a
                    className={styles.eventName}
                    href={href}
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    <strong data-type='T059'>
                      <OverflowText text={event.title} />
                    </strong>
                    <small data-type='T050'>
                      {formatTimeRange(event.startMinute, event.startMinute + event.duration)}
                    </small>
                  </a>
                  <AvatarGroup people={event.people} label='People in this meeting' />
                </article>
              )
            })}
          {offset === 0 && (
            <span
              ref={now}
              className={styles.now}
              aria-label='Current time'
              data-type='T021'
              style={{ gridRow: timeSlot(calendar.nowMinute) }}
            >
              {formatClockTime(calendar.nowMinute * 60_000)}
            </span>
          )}
        </div>
      </div>
    </>
  )
}
