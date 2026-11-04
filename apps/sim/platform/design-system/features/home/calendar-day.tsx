'use client'

import { useState } from 'react'
import { AvatarGroup, EmptyState, IconButton } from '@/platform/design-system/components'
import styles from '@/platform/design-system/features/home/home.module.css'
import type { HomeData } from '@/platform/design-system/models/conversation'

interface CalendarDayProps {
  calendar?: HomeData['calendar']
}
const dayLabel = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
})
export function CalendarDay({ calendar }: CalendarDayProps) {
  const [offset, setOffset] = useState(0)
  const date = calendar ? new Date(`${calendar.date}T12:00:00Z`) : new Date()
  date.setUTCDate(date.getUTCDate() + offset)
  const meetings = offset === 0 ? calendar?.meetings : []
  const windowMinutes = Math.max(1, (calendar?.times.length ?? 1) - 1) * 60 + 15
  return (
    <>
      <div className={styles.dayToolbar}>
        <span data-type='T052'>{dayLabel.format(date)}</span>
        <div>
          <span className={styles.previous}>
            <IconButton
              icon='I032'
              size='compact'
              label='Previous day'
              onClick={() => setOffset(offset - 1)}
            />
          </span>
          <span>
            <IconButton
              icon='I032'
              size='compact'
              label='Next day'
              onClick={() => setOffset(offset + 1)}
            />
          </span>
        </div>
      </div>
      {meetings?.length && calendar ? (
        <div className={styles.timeline} aria-label='Calendar schedule'>
          {calendar.times.map((time) => (
            <div className={styles.hour} key={time} data-type='T035'>
              {time}
            </div>
          ))}
          <div className={styles.lanes}>
            <svg className={styles.events} aria-label='Meetings'>
              {meetings.map((event) => (
                <foreignObject
                  key={event.id}
                  x='0'
                  y={`${(event.startMinute / windowMinutes) * 100}%`}
                  width='100%'
                  height={`${(event.duration / windowMinutes) * 100}%`}
                >
                  <div className={styles.event}>
                    <span className={styles.eventName}>
                      <strong data-type='T057'>{event.title}</strong>
                      <small data-type='T035'>{event.time}</small>
                    </span>
                    <AvatarGroup people={event.people} label='People in this meeting' />
                  </div>
                </foreignObject>
              ))}
            </svg>
          </div>
          {calendar.now && calendar.nowMinute !== undefined && (
            <svg className={styles.marker} aria-label='Current time'>
              <foreignObject
                width='100%'
                height='12%'
                y={`${(calendar.nowMinute / windowMinutes) * 100}%`}
              >
                <div className={styles.now} data-type='T021'>
                  {calendar.now}
                  <i />
                </div>
              </foreignObject>
            </svg>
          )}
        </div>
      ) : (
        <EmptyState title='No meetings today' description='Your day is clear.' />
      )}
    </>
  )
}
