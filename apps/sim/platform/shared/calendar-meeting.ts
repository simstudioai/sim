import { getWallClockParts } from '@/lib/core/utils/timezone'

const MINUTES_PER_DAY = 24 * 60

interface Instants {
  startAt: string
  endAt: string
}

export function wallClockMinute(instantMs: number, timeZone: string): number {
  const { hour, minute } = getWallClockParts(new Date(instantMs), timeZone)
  return hour * 60 + minute
}

/** A wall-clock minute of the requested day; an instant outside it clamps to that day's edge. */
function minuteOfDay(instant: string, window: Instants, timeZone: string) {
  if (instant <= window.startAt) return 0
  if (instant >= window.endAt) return MINUTES_PER_DAY
  return wallClockMinute(Date.parse(instant), timeZone)
}

/**
 * Where a timed event sits on the day on screen, plus its own wall clock when it runs past that day's
 * edges, so its label can read the real meeting rather than where its card is cut off.
 */
export function placeMeeting(event: Instants, window: Instants, timeZone: string) {
  const startMinute = minuteOfDay(event.startAt, window, timeZone)
  const cutOff = event.startAt < window.startAt || event.endAt > window.endAt
  return {
    startMinute,
    duration: Math.max(0, minuteOfDay(event.endAt, window, timeZone) - startMinute),
    ...(cutOff
      ? {
          clock: {
            startMinute: wallClockMinute(Date.parse(event.startAt), timeZone),
            endMinute: wallClockMinute(Date.parse(event.endAt), timeZone),
          },
        }
      : {}),
  }
}
