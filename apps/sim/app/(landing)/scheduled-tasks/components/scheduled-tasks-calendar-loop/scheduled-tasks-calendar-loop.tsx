'use client'

import { useState } from 'react'
import { Chip, chipContentGap, chipPrimaryFillTokens, cn } from '@sim/emcn'
import { Calendar, Plus } from '@sim/emcn/icons'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { HeroLoopShell } from '@/app/(landing)/components/shared/hero-loop-shell'
import { RESET_FADE_MS } from '@/app/(landing)/hooks/use-design-scale'
import { useMotionSafeCycle } from '@/app/(landing)/hooks/use-motion-safe-cycle'
import styles from '@/app/(landing)/scheduled-tasks/components/scheduled-tasks-calendar-loop/scheduled-tasks-calendar-loop.module.css'

/** Sidebar content for the scheduled-tasks hero - a recurring-ops workspace. */
const SIDEBAR_CHATS = [
  'Morning digest setup',
  'Move sync to nightly',
  'Weekly KPI report',
  'Retry failed runs',
] as const

/** Deployed workflows in the sidebar - five fill the design height. */
const SIDEBAR_WORKFLOWS = [
  'Morning digest',
  'Nightly data sync',
  'Weekly KPI report',
  'Invoice sweep',
  'Churn-risk alerts',
] as const

/** Weekday header labels, Sunday-start, matching the real month grid. */
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Month the fixed calendar shows - June 2026 opens on a Monday and fills five Sunday-start weeks. */
const MONTH_LABEL = 'June 2026'
/** Day-of-month carrying the today ring, a mid-month Wednesday. */
const TODAY = 10
/** Days in June - the grid's in-month cells span indexes 1..30. */
const DAYS_IN_MONTH = 30
/** Total cells in the five-week Sunday-start grid. */
const CELL_COUNT = 35

interface CalendarPill {
  /** Occurrence start time, preformatted like the real event chip's `h:mm a`. */
  time: string
  /** Scheduled task title. */
  title: string
  /** Paused schedules render dimmed - the one status the real pill signals. */
  paused?: boolean
  /**
   * Position of this pill in the animated stamp-in series (the Weekly KPI
   * report being scheduled across the month's Mondays); unset pills are the
   * settled base calendar.
   */
  stampIndex?: number
}

interface CalendarCell {
  /** Day-of-month number the cell shows. */
  day: number
  /** In-month days get body-colored numbers; leading/trailing days go muted. */
  inMonth: boolean
  /** Today's number gets the real grid's 26px primary-filled square. */
  isToday: boolean
  /** Task occurrences on this day, in start-time order. */
  pills: CalendarPill[]
}

/** Mondays in the grid (cell indexes), in stamp order for the animated series. */
const MONDAY_CELLS: readonly number[] = [1, 8, 15, 22, 29]

/**
 * Derives one day's task pills from the workspace's recurring schedules:
 * the Morning digest on weekdays at 9:00 AM, the paused Churn-risk alerts on
 * Thursdays, the Nightly data sync every night, a monthly Invoice sweep on
 * the 30th, and - as the animated series - the Weekly KPI report landing on
 * each Monday as the schedule is created.
 */
function pillsForCell(index: number): CalendarPill[] {
  const weekday = index % 7
  const pills: CalendarPill[] = []
  const mondayOrder = MONDAY_CELLS.indexOf(index)
  if (mondayOrder !== -1) {
    pills.push({ time: '8:00 AM', title: 'Weekly KPI report', stampIndex: mondayOrder })
  }
  if (weekday >= 1 && weekday <= 5) {
    pills.push({ time: '9:00 AM', title: 'Morning digest' })
  }
  if (index === DAYS_IN_MONTH) {
    pills.push({ time: '3:00 PM', title: 'Invoice sweep' })
  }
  if (weekday === 4) {
    pills.push({ time: '4:00 PM', title: 'Churn-risk alerts', paused: true })
  }
  pills.push({ time: '11:00 PM', title: 'Nightly data sync' })
  return pills
}

/**
 * The fixed June 2026 grid: May 31 leads the first week, June fills the
 * middle, and July 1-4 close the fifth week - every cell's pills derived
 * from the recurring schedules above.
 */
const CALENDAR_CELLS: readonly CalendarCell[] = Array.from({ length: CELL_COUNT }, (_, index) => {
  const inMonth = index >= 1 && index <= DAYS_IN_MONTH
  const day = index === 0 ? 31 : inMonth ? index : index - DAYS_IN_MONTH
  return {
    day,
    inMonth,
    isToday: index === TODAY,
    pills: pillsForCell(index),
  }
})

/** Total pills the animated Weekly KPI series stamps onto the month's Mondays. */
const TOTAL_STAMPED_PILLS = MONDAY_CELLS.length

/** The settled calendar holds this long before the first KPI pill lands. */
const IDLE_HOLD_MS = 900
/** Stamped pill N lands at IDLE_HOLD_MS + N * PILL_STEP_MS. */
const PILL_STEP_MS = 620
/** The fully scheduled month holds this long before the fade. */
const SCHEDULED_HOLD_MS = 5200

interface CalendarPanePillProps {
  pill: CalendarPill
  /** Stamped pills replay the mount animation each cycle. */
  animate: boolean
}

/**
 * One task pill in a day cell - the real calendar event chip's exact
 * chrome (primary fill, start time + title, paused schedules dimmed) rendered
 * as a plain `<div>` since the whole frame is `aria-hidden` decoration.
 */
function CalendarPanePill({ pill, animate }: CalendarPanePillProps) {
  return (
    <div
      className={cn(
        'flex w-full min-w-0 items-center truncate rounded-md px-1.5 py-0.5 text-left text-caption',
        chipContentGap,
        chipPrimaryFillTokens,
        pill.paused && 'opacity-45',
        animate && styles.pillIn
      )}
    >
      <span className='flex-shrink-0'>{pill.time}</span>
      <span className='min-w-0 truncate'>{pill.title}</span>
    </div>
  )
}

interface ScheduledTasksCalendarPaneProps {
  /** How many Weekly KPI pills the stamp-in series has landed (0..5). */
  stampedCount: number
}

/**
 * The static Scheduled Tasks page in the real workspace's exact vocabulary -
 * the resource header (Calendar icon + title + primary "New scheduled task"
 * chip), the calendar toolbar (Today jump, period label, prev/next chevrons,
 * scope chip), the sticky weekday header, and the five-week month grid of day
 * cells with the today square and stacked task pills - rendered from the
 * parent clock's `stampedCount` beat.
 */
function ScheduledTasksCalendarPane({ stampedCount }: ScheduledTasksCalendarPaneProps) {
  return (
    <div className='flex h-full flex-col overflow-hidden bg-[var(--bg)]'>
      <div className='flex items-center justify-between border-[var(--border)] border-b px-4 py-[8.5px]'>
        <span className='inline-flex items-center px-2 py-1 font-medium text-[var(--text-primary)] text-sm'>
          <Calendar className='mr-3 size-[14px] text-[var(--text-icon)]' />
          Scheduled Tasks
        </span>
        <Chip variant='primary' leftIcon={Plus} tabIndex={-1}>
          New scheduled task
        </Chip>
      </div>

      <div className='flex items-center justify-between border-[var(--border)] border-b px-4 py-2.5'>
        <div className='flex items-center'>
          <Chip tabIndex={-1}>Today</Chip>
          <span className='px-2 text-[var(--text-body)] text-sm'>{MONTH_LABEL}</span>
        </div>
        <div className='flex items-center'>
          <Chip leftIcon={ChevronLeft} aria-label='Previous' tabIndex={-1} />
          <Chip leftIcon={ChevronRight} aria-label='Next' tabIndex={-1} />
          <Chip tabIndex={-1}>Month</Chip>
        </div>
      </div>

      <div className='grid grid-cols-7 border-[var(--border)] border-b bg-[var(--bg)]'>
        {WEEKDAY_LABELS.map((label, index) => (
          <div
            key={label}
            className={cn(
              'p-1.5 text-[var(--text-muted)] text-caption',
              index === 0 && 'pl-6',
              index === WEEKDAY_LABELS.length - 1 && 'pr-6'
            )}
          >
            {label}
          </div>
        ))}
      </div>

      <div className='grid min-h-0 flex-1 grid-cols-7 grid-rows-5'>
        {CALENDAR_CELLS.map((cell, index) => (
          <div
            key={index}
            className={cn(
              'flex min-h-0 min-w-0 flex-col items-start gap-1 overflow-hidden border-[var(--border)] border-r border-b p-1.5',
              index % 7 === 0 && 'pl-6',
              index % 7 === 6 && 'pr-6'
            )}
          >
            <span
              className={cn(
                'ml-px flex h-[26px] flex-shrink-0 items-center rounded-lg text-caption',
                cell.isToday
                  ? cn('w-[26px] justify-center', chipPrimaryFillTokens)
                  : cell.inMonth
                    ? 'text-[var(--text-body)]'
                    : 'text-[var(--text-muted)]'
              )}
            >
              {cell.day}
            </span>
            <div className='flex w-full min-w-0 flex-col gap-0.5'>
              {cell.pills.map((pill) =>
                pill.stampIndex !== undefined && pill.stampIndex >= stampedCount ? null : (
                  <CalendarPanePill
                    key={`${pill.time}-${pill.title}`}
                    pill={pill}
                    animate={pill.stampIndex !== undefined}
                  />
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The scheduled-tasks hero's calendar loop - the workspace's real Scheduled
 * Tasks surface as the workspace pane. Same architecture as the sibling hero
 * loops (the {@link HeroLoopShell}'s fixed 1280x735 design-space layer scaled
 * to the window, a parent-owned clock driving a presentational pane,
 * reduced-motion showing the finished frame) and the same live sidebar with
 * its Scheduled tasks nav row highlighted, but the pane is the month calendar
 * itself: the settled recurring schedules hold, then a new Weekly KPI report
 * schedule lands pill by pill across the month's Mondays, the fully
 * scheduled month holds, and the scene fades before the cycle restarts.
 *
 * Everything is `pointer-events-none` decorative, matching the hero's
 * `aria-hidden` frame. Under `prefers-reduced-motion` the loop never starts:
 * the fully scheduled calendar renders statically.
 */
export function ScheduledTasksCalendarLoop() {
  const [stampedCount, setStampedCount] = useState(0)
  const [fading, setFading] = useState(false)
  const [cycleId, setCycleId] = useState(0)

  useMotionSafeCycle({
    scheduleCycle: () => {
      setFading(false)
      setStampedCount(0)
      setCycleId((c) => c + 1)
      const totalMs = IDLE_HOLD_MS + (TOTAL_STAMPED_PILLS - 1) * PILL_STEP_MS + SCHEDULED_HOLD_MS
      return {
        timers: [
          ...Array.from({ length: TOTAL_STAMPED_PILLS }, (_, i) =>
            setTimeout(() => setStampedCount(i + 1), IDLE_HOLD_MS + i * PILL_STEP_MS)
          ),
          setTimeout(() => setFading(true), totalMs - RESET_FADE_MS),
        ],
        totalMs,
      }
    },
    showFinished: () => {
      setFading(false)
      setStampedCount(TOTAL_STAMPED_PILLS)
    },
  })

  return (
    <HeroLoopShell chats={SIDEBAR_CHATS} workflows={SIDEBAR_WORKFLOWS} activeNav='Scheduled tasks'>
      <div className='h-full w-full overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--bg)]'>
        <div
          className={cn(
            'h-full w-full transition-opacity duration-300 ease-out',
            fading ? 'opacity-0' : 'opacity-100'
          )}
        >
          <ScheduledTasksCalendarPane key={cycleId} stampedCount={stampedCount} />
        </div>
      </div>
    </HeroLoopShell>
  )
}
