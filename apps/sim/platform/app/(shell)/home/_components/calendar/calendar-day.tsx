'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { AvatarGroup } from '@sim/emcn/avatar'
import { Button, IconButton } from '@sim/emcn/button'
import { OverflowText } from '@sim/emcn/overflow-text'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { InlineNotice } from '@sim/emcn/status'
import styles from '@/platform/app/(shell)/home/_components/calendar/calendar-day.module.css'
import type {
  CalendarMeeting,
  HomeCalendarDay,
} from '@/platform/app/(shell)/home/_components/model'
import { RetryButton } from '@/platform/app/(shell)/home/_components/retry-button/retry-button'
import { SkeletonBlock } from '@/platform/app/(shell)/home/_components/widget-skeleton/widget-skeleton'
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
/** A short meeting still needs room for its name and time. */
const MIN_MEETING_ROWS = 30
const MAX_MEETING_LANES = 3

function timeSlot(startMinute: number, duration = 1) {
  return `${startMinute + 1} / span ${duration}`
}

/**
 * Places meetings that overlap side by side, in as few lanes as each overlapping run needs. Past
 * the lanes the width can show, later meetings share a lane rather than shrink out of reading.
 */
function meetingLanes(meetings: readonly CalendarMeeting[]) {
  const placed = new Map<string, { lane: number; lanes: number }>()
  const ordered = [...meetings].sort((a, b) => a.startMinute - b.startMinute)
  let run: CalendarMeeting[] = []
  let laneEnds: number[] = []
  let runEnd = -1
  const closeRun = () => {
    for (const meeting of run) {
      const position = placed.get(meeting.id)
      if (position) position.lanes = Math.min(laneEnds.length, MAX_MEETING_LANES)
    }
    run = []
    laneEnds = []
  }
  for (const meeting of ordered) {
    if (meeting.startMinute >= runEnd) closeRun()
    const end = meeting.startMinute + Math.max(meeting.duration, MIN_MEETING_ROWS)
    const free = laneEnds.findIndex((laneEnd) => laneEnd <= meeting.startMinute)
    const lane = free === -1 ? laneEnds.length : free
    laneEnds[lane] = end
    placed.set(meeting.id, { lane: lane % MAX_MEETING_LANES, lanes: 1 })
    run.push(meeting)
    runEnd = Math.max(runEnd, end)
  }
  closeRun()
  return placed
}

export function CalendarDay({ calendar, onDayChange, onReturnToToday, onRetry }: CalendarDayProps) {
  const today = calendar.nowMinute !== null
  const [returnCount, setReturnCount] = useState(0)
  const [atNow, setAtNow] = useState(true)
  const viewport = useRef<HTMLDivElement>(null)
  const now = useRef<HTMLSpanElement>(null)
  const firstMeeting = useRef<HTMLElement>(null)
  const restingTop = useRef<number | null>(null)
  const focusOnReturn = useRef(false)
  const scrollEdges = useScrollEdges('vertical', { viewport, tabStop: true })
  const earliest = calendar.meetings.reduce<CalendarMeeting | undefined>(
    (first, event) => (!first || event.startMinute < first.startMinute ? event : first),
    undefined
  )?.id

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
      const keepCentered = atRest()
      const centered = marker.offsetTop + (marker.offsetHeight - root.clientHeight) / 2
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
    // Replacing the viewport cancels an in-flight native keyboard or momentum scroll.
    setReturnCount((count) => count + 1)
  }

  const lanes = meetingLanes(calendar.meetings)
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
          <IconButton icon='I032' label='Previous day' tooltip onClick={() => onDayChange(-1)} />
          <IconButton icon='I032' label='Next day' tooltip onClick={() => onDayChange(1)} />
        </div>
      </div>
      {calendar.status === 'loading' && <SkeletonBlock label='Loading this day' />}
      {calendar.status === 'error' && (
        <InlineNotice
          intent='warning'
          message='This day could not load.'
          action={<RetryButton onRetry={onRetry} />}
        />
      )}
      {calendar.status === 'ready' && (
        <div
          key={returnCount}
          ref={scrollEdges}
          role='region'
          aria-label='Calendar schedule'
          className={styles.viewport}
        >
          {calendar.allDay.length > 0 && (
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
                    Math.abs(index * 60 - calendar.nowMinute) < NOW_LABEL_CLEARANCE_MINUTES
                      ? 'hidden'
                      : undefined,
                }}
              >
                {time}
              </span>
            ))}
            {calendar.meetings.map((event) => (
              <article
                key={event.id}
                ref={event.id === earliest ? firstMeeting : undefined}
                className={styles.event}
                data-lane={lanes.get(event.id)?.lane}
                data-lanes={lanes.get(event.id)?.lanes}
                style={{
                  gridRow: timeSlot(event.startMinute, Math.max(event.duration, MIN_MEETING_ROWS)),
                }}
              >
                <a
                  className={styles.eventName}
                  href={externalUrl(event.providerUrl)}
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
