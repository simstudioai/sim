'use client'

import { useState } from 'react'
import styles from '@/platform/app/(shell)/home/_components/calendar/calendar-day.module.css'
import type { HomeData } from '@/platform/app/(shell)/home/_components/model'
import {
  AvatarGroup,
  EmptyState,
  IconButton,
  OverflowText,
} from '@/platform/design-system/components'

interface CalendarDayProps {
  calendar?: HomeData['calendar']
}

const DAY_LABEL = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
})

function timeSlot(startMinute: number, duration = 1) {
  return `${startMinute + 1} / span ${duration}`
}

export function CalendarDay({ calendar }: CalendarDayProps) {
  const [offset, setOffset] = useState(0)
  const date = calendar ? new Date(`${calendar.date}T12:00:00Z`) : new Date()
  date.setUTCDate(date.getUTCDate() + offset)
  return (
    <>
      <div className={styles.toolbar}>
        <span data-type='T052'>{DAY_LABEL.format(date)}</span>
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
      {offset === 0 && calendar?.meetings.length ? (
        <div className={styles.timeline} aria-label='Calendar schedule'>
          {calendar.times.map((time, index) => (
            <span
              key={time}
              className={styles.hour}
              data-type='T035'
              style={{
                gridRow: timeSlot(index * 60, index === calendar.times.length - 1 ? 15 : 60),
              }}
            >
              {time}
            </span>
          ))}
          {calendar.meetings.map((event) => (
            <article
              key={event.id}
              className={styles.event}
              style={{ gridRow: timeSlot(event.startMinute, event.duration) }}
            >
              <div className={styles.eventName}>
                <strong data-type='T059'>
                  <OverflowText text={event.title} />
                </strong>
                <small data-type='T050'>{event.time}</small>
              </div>
              <AvatarGroup people={event.people} label='People in this meeting' />
            </article>
          ))}
          {calendar.now && calendar.nowMinute !== undefined && (
            <span
              className={styles.now}
              aria-label='Current time'
              data-type='T021'
              style={{ gridRow: timeSlot(calendar.nowMinute) }}
            >
              {calendar.now}
            </span>
          )}
        </div>
      ) : (
        <EmptyState title='No meetings today' description='Your day is clear.' />
      )}
    </>
  )
}
