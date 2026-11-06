'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import styles from '@/platform/app/(shell)/home/_components/calendar/calendar-day.module.css'
import {
  layoutDay,
  MAX_MEETING_LANES,
  maxLanesForWidth,
} from '@/platform/app/(shell)/home/_components/calendar/day-layout'
import { SkeletonBlock } from '@/platform/app/(shell)/home/_components/widget-skeleton/widget-skeleton'
import { FailureNotice } from '@/platform/design-system/components'
import { AvatarGroup } from '@/platform/design-system/components/avatar/avatar'
import { Button, IconButton } from '@/platform/design-system/components/button/button'
import { ActionMenu } from '@/platform/design-system/components/menu/action-menu'
import { OverflowText } from '@/platform/design-system/components/overflow-text/overflow-text'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import type { CalendarMeeting, HomeCalendarDay } from '@/platform/lib/data/home-view'
import { formatCalendarDate, formatClockTime, formatTimeRange } from '@/platform/lib/time'

interface CalendarDayProps {
  calendar: HomeCalendarDay
  onDayChange: (delta: number) => void
  onReturnToToday: () => void
  onRetry: () => void
}

function externalUrl(url: string | undefined) {
  return url?.startsWith('https://') && URL.canParse(url) ? url : undefined
}

/** An hour label this close to the current time would sit under it. */
const NOW_LABEL_CLEARANCE_MINUTES = 15
const HOURS = Array.from({ length: 24 }, (_, hour) => formatClockTime(hour * 3_600_000))
function timeSlot(startMinute: number, duration = 1) {
  return `${startMinute + 1} / span ${duration}`
}

/** A meeting running past this day's edges reads its own clock, not where its card is cut off. */
function meetingTime({ clock, startMinute, duration }: CalendarMeeting) {
  return formatTimeRange(
    clock?.startMinute ?? startMinute,
    clock?.endMinute ?? startMinute + duration
  )
}

export function CalendarDay({ calendar, onDayChange, onReturnToToday, onRetry }: CalendarDayProps) {
  const today = calendar.nowMinute !== null
  const [returnCount, setReturnCount] = useState(0)
  const [atNow, setAtNow] = useState(true)
  const [maxLanes, setMaxLanes] = useState(MAX_MEETING_LANES)
  const viewport = useRef<HTMLDivElement>(null)
  const now = useRef<HTMLSpanElement>(null)
  const firstMeeting = useRef<HTMLElement>(null)
  const restingTop = useRef<number | null>(null)
  const focusOnReturn = useRef(false)
  const scrollEdges = useScrollEdges('vertical', { viewport, tabStop: true })
  const { cards, overflows } = layoutDay(calendar.meetings, maxLanes)
  const earliest = cards[0]?.meeting.id

  // Forgets the reading position only when the viewport changes: the clock ticks underneath it.
  useLayoutEffect(() => {
    restingTop.current = null
  }, [calendar.date, calendar.status, returnCount])

  useLayoutEffect(() => {
    const marker = now.current ?? firstMeeting.current
    const root = viewport.current
    if (!marker || !root) return
    const atRest = () =>
      restingTop.current === null || Math.abs(root.scrollTop - restingTop.current) <= 1
    const updatePosition = () => setAtNow(atRest())
    const measure = () => {
      setMaxLanes(maxLanesForWidth(root.clientWidth))
      const keepCentered = atRest()
      // A meeting taller than the viewport opens at its title rather than its middle.
      const centered = Math.min(
        marker.offsetTop,
        marker.offsetTop + (marker.offsetHeight - root.clientHeight) / 2
      )
      restingTop.current = Math.max(0, Math.min(centered, root.scrollHeight - root.clientHeight))
      if (keepCentered) root.scrollTop = restingTop.current
      updatePosition()
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    if (marker.parentElement) observer.observe(marker.parentElement)
    root.addEventListener('scroll', updatePosition, { passive: true })
    return () => {
      observer.disconnect()
      root.removeEventListener('scroll', updatePosition)
    }
  }, [calendar.date, calendar.nowMinute, calendar.status, earliest, returnCount])

  // Today may still be loading when the reader returns to it, so focus waits for its viewport.
  useLayoutEffect(() => {
    if (!focusOnReturn.current || !viewport.current) return
    focusOnReturn.current = false
    viewport.current.focus({ preventScroll: true })
  }, [calendar.status, returnCount])

  function returnToNow() {
    focusOnReturn.current = true
    onReturnToToday()
    // Remounting the viewport cancels iOS momentum, which can otherwise override a position assigned
    // while it runs. Not tested on a device.
    setReturnCount((count) => count + 1)
  }

  return (
    <>
      <div className={styles.toolbar}>
        <span data-type='T052'>{formatCalendarDate(calendar.date, 'weekday')}</span>
        <div className={styles.dayControls}>
          {(!today || !atNow) && (
            <Button variant='quiet' size='compact' onClick={returnToNow}>
              Now
            </Button>
          )}
          <IconButton
            icon='I032'
            mirrored
            label='Previous day'
            tooltip
            onClick={() => onDayChange(-1)}
          />
          <IconButton icon='I032' label='Next day' tooltip onClick={() => onDayChange(1)} />
        </div>
      </div>
      {calendar.status === 'loading' && <SkeletonBlock label='Loading this day' />}
      {calendar.status === 'error' && (
        <FailureNotice intent='warning' message='This day could not load.' onRetry={onRetry} />
      )}
      {calendar.status === 'ready' && calendar.allDay.length > 0 && (
        <ul className={styles.allDay} aria-label='All-day events'>
          {calendar.allDay.map((event) => (
            <li key={event.id} className={styles.allDayEvent} data-type='T059'>
              <a
                className={styles.eventName}
                href={externalUrl(event.providerUrl)}
                target='_blank'
                rel='noopener noreferrer'
              >
                <OverflowText text={event.title} />
              </a>
            </li>
          ))}
        </ul>
      )}
      {calendar.status === 'ready' && (
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
                style={{
                  gridRow: timeSlot(index * 60, 60),
                  visibility:
                    calendar.nowMinute !== null &&
                    Math.abs(index * 60 - calendar.nowMinute) <= NOW_LABEL_CLEARANCE_MINUTES
                      ? 'hidden'
                      : undefined,
                }}
              >
                {time}
              </span>
            ))}
            {cards.map(
              ({ meeting, startMinute, endMinute, lane, lanes, reservesOverflow, density }) => {
                const time = meetingTime(meeting)
                return (
                  <article
                    key={meeting.id}
                    ref={meeting.id === earliest ? firstMeeting : undefined}
                    className={styles.event}
                    data-lane={lane}
                    data-lanes={lanes}
                    data-reserves-overflow={reservesOverflow || undefined}
                    data-density={density}
                    style={{ gridRow: timeSlot(startMinute, endMinute - startMinute) }}
                  >
                    <a
                      className={styles.eventName}
                      href={externalUrl(meeting.providerUrl)}
                      target='_blank'
                      rel='noopener noreferrer'
                    >
                      <strong data-type='T059'>
                        <OverflowText
                          text={meeting.title}
                          fullValue={lanes > 1 ? `${meeting.title}, ${time}` : meeting.title}
                        />
                      </strong>
                      <small data-type='T035' aria-hidden={lanes > 1 || undefined}>
                        {time}
                      </small>
                    </a>
                    {meeting.people.length > 0 && (
                      <span className={styles.people}>
                        <AvatarGroup people={meeting.people} label='People in this meeting' />
                      </span>
                    )}
                  </article>
                )
              }
            )}
            {overflows.map((overflow) => (
              <div
                key={overflow.id}
                className={styles.overflow}
                style={{
                  gridRow: timeSlot(
                    overflow.startMinute,
                    overflow.endMinute - overflow.startMinute
                  ),
                }}
              >
                <ActionMenu
                  label={`${overflow.meetings.length} more meetings`}
                  triggerText={`+${overflow.meetings.length}`}
                  align='end'
                  actions={overflow.meetings.map((meeting) => {
                    const url = externalUrl(meeting.providerUrl)
                    return {
                      id: meeting.id,
                      label: `${meeting.title}, ${meetingTime(meeting)}`,
                      disabled: !url,
                      onSelect: () => window.open(url, '_blank', 'noopener,noreferrer'),
                    }
                  })}
                />
              </div>
            ))}
            {calendar.nowMinute !== null && (
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
      )}
    </>
  )
}
