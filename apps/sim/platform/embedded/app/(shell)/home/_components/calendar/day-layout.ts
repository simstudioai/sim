import { compareStrings } from '@sim/utils/string'
import type { CalendarMeeting } from '@/platform/embedded/lib/data/home-view'

const MINUTES_PER_DAY = 24 * 60
/** A card shorter than this slot cannot hold one line of text. */
const MIN_DRAWN_MINUTES = 30
/** The shortest slot whose card holds a title above its time. */
const TWO_LINE_MINUTES = 45
const VIEWPORT_PER_LANE_PX = 144
export const MAX_MEETING_LANES = 3

interface DrawnExtent {
  startMinute: number
  endMinute: number
}

interface PlacedMeeting extends DrawnExtent {
  meeting: CalendarMeeting
  lane: number
  lanes: number
  /** The overlapping run has meetings past its lanes, so its cards leave the affordance a column. */
  reservesOverflow: boolean
  density: 'compact' | 'full'
}

interface MeetingOverflow extends DrawnExtent {
  id: string
  meetings: CalendarMeeting[]
}

interface DrawnMeeting extends DrawnExtent {
  meeting: CalendarMeeting
}

function drawnExtent({ startMinute, duration }: CalendarMeeting): DrawnExtent {
  const start = Math.min(Math.max(startMinute, 0), MINUTES_PER_DAY - MIN_DRAWN_MINUTES)
  return {
    startMinute: start,
    endMinute: Math.min(start + Math.max(duration, MIN_DRAWN_MINUTES), MINUTES_PER_DAY),
  }
}

function groupOverflow(hidden: readonly DrawnMeeting[]) {
  const groups: MeetingOverflow[] = []
  for (const { meeting, startMinute, endMinute } of hidden) {
    const group = groups.at(-1)
    if (group && startMinute < group.endMinute) {
      group.meetings.push(meeting)
      group.endMinute = Math.max(group.endMinute, endMinute)
    } else {
      groups.push({ id: meeting.id, startMinute, endMinute, meetings: [meeting] })
    }
  }
  return groups
}

/** How many lanes keep a title readable across a calendar this wide. */
export function maxLanesForWidth(viewportWidth: number) {
  return Math.min(MAX_MEETING_LANES, Math.max(1, Math.floor(viewportWidth / VIEWPORT_PER_LANE_PX)))
}

/**
 * Places a day's meetings by the height each is drawn at, which a short meeting's minimum makes
 * longer than its duration. A meeting ending as the next begins needs no second lane. Meetings past
 * `maxLanes` are never stacked: they leave the cards and wait behind one overflow per hidden group.
 * Cards come back in reading order, so tabbing through them follows the day.
 */
export function layoutDay(meetings: readonly CalendarMeeting[], maxLanes: number) {
  const ordered = meetings
    .map((meeting): DrawnMeeting => ({ meeting, ...drawnExtent(meeting) }))
    .sort(
      (left, right) =>
        left.startMinute - right.startMinute ||
        right.endMinute - left.endMinute ||
        compareStrings(left.meeting.id, right.meeting.id)
    )
  const cards: PlacedMeeting[] = []
  const overflows: MeetingOverflow[] = []
  let run: PlacedMeeting[] = []
  let hidden: DrawnMeeting[] = []
  let laneEnds: number[] = []
  let runEnd = -1
  const closeRun = () => {
    for (const card of run) {
      card.lanes = laneEnds.length
      card.reservesOverflow = hidden.length > 0
    }
    overflows.push(...groupOverflow(hidden))
    run = []
    hidden = []
    laneEnds = []
  }
  for (const drawn of ordered) {
    if (drawn.startMinute >= runEnd) closeRun()
    runEnd = Math.max(runEnd, drawn.endMinute)
    const free = laneEnds.findIndex((laneEnd) => laneEnd <= drawn.startMinute)
    const lane = free === -1 ? laneEnds.length : free
    if (lane >= maxLanes) {
      hidden.push(drawn)
      continue
    }
    laneEnds[lane] = drawn.endMinute
    const card: PlacedMeeting = {
      ...drawn,
      lane,
      lanes: 1,
      reservesOverflow: false,
      density: drawn.endMinute - drawn.startMinute < TWO_LINE_MINUTES ? 'compact' : 'full',
    }
    run.push(card)
    cards.push(card)
  }
  closeRun()
  return { cards, overflows }
}
