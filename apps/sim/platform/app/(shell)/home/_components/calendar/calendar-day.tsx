'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import styles from '@/platform/app/(shell)/home/_components/calendar/calendar-day.module.css'
import type { HomeData } from '@/platform/app/(shell)/home/_components/model'
import {
  AvatarGroup,
  IconButton,
  OverflowText,
  PersonRow,
} from '@/platform/design-system/components'
import { OverlayDialog } from '@/platform/design-system/components/modal/overlay-dialog'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import { formatCalendarDate, formatClockTime, formatTimeRange } from '@/platform/lib/time'

interface CalendarDayProps {
  calendar?: HomeData['calendar']
}

const HOURS = Array.from({ length: 24 }, (_, hour) => formatClockTime(hour * 3_600_000))

function timeSlot(startMinute: number, duration = 1) {
  return `${startMinute + 1} / span ${duration}`
}

export function CalendarDay({ calendar }: CalendarDayProps) {
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<HomeData['calendar']['meetings'][number] | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const initialHour = useRef<HTMLSpanElement>(null)
  const scrollEdges = useScrollEdges('vertical', { viewport, tabStop: true })
  const startMinute = calendar?.nowMinute ?? calendar?.meetings[0]?.startMinute ?? 9 * 60
  const initialHourIndex = Math.max(0, Math.floor(startMinute / 60) - 1)

  useLayoutEffect(() => {
    const element = viewport.current
    const anchor = initialHour.current
    if (element && anchor) element.scrollTop = anchor.offsetTop
  }, [initialHourIndex])

  const date = calendar ? new Date(`${calendar.date}T12:00:00Z`) : new Date()
  date.setUTCDate(date.getUTCDate() + offset)
  const dayLabel = formatCalendarDate(date.toISOString().slice(0, 10), 'weekday')
  return (
    <>
      <div className={styles.toolbar}>
        <span data-type='T052'>{dayLabel}</span>
        <div className={styles.dayControls}>
          <IconButton
            icon='I032'
            label='Previous day'
            tooltip
            onClick={() => setOffset(offset - 1)}
          />
          <IconButton icon='I032' label='Next day' tooltip onClick={() => setOffset(offset + 1)} />
        </div>
      </div>
      <div
        ref={scrollEdges}
        role='region'
        aria-label='Calendar schedule'
        className={styles.viewport}
      >
        <div className={styles.timeline}>
          {HOURS.map((time, index) => (
            <span
              key={time}
              ref={index === initialHourIndex ? initialHour : undefined}
              className={styles.hour}
              data-type='T035'
              style={{
                gridRow: timeSlot(index * 60, 60),
              }}
            >
              {time}
            </span>
          ))}
          {offset === 0 &&
            calendar?.meetings.map((event) => (
              <article
                key={event.id}
                className={styles.event}
                style={{ gridRow: timeSlot(event.startMinute, event.duration) }}
              >
                <button
                  type='button'
                  className={styles.eventName}
                  aria-haspopup='dialog'
                  onClick={() => setSelected(event)}
                >
                  <strong data-type='T059'>
                    <OverflowText text={event.title} />
                  </strong>
                  <small data-type='T050'>
                    {formatTimeRange(event.startMinute, event.startMinute + event.duration)}
                  </small>
                </button>
                <AvatarGroup people={event.people} label='People in this meeting' />
              </article>
            ))}
          {offset === 0 && calendar?.nowMinute !== undefined && (
            <span
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
      <OverlayDialog
        open={selected !== null}
        title={selected?.title ?? 'Calendar event'}
        description={
          selected
            ? `${dayLabel} · ${formatTimeRange(selected.startMinute, selected.startMinute + selected.duration)}`
            : undefined
        }
        onClose={() => setSelected(null)}
      >
        {selected && selected.people.length > 0 && (
          <section aria-label='Attendees'>
            {selected.people.map((person) => (
              <PersonRow key={person.name} name={person.name} src={person.src} />
            ))}
          </section>
        )}
      </OverlayDialog>
    </>
  )
}
