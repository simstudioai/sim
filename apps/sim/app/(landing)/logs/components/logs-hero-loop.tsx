'use client'

import { useState } from 'react'
import type { BadgeProps } from '@sim/emcn'
import { Badge, cn } from '@sim/emcn'
import { ArrowUpDown, Download, Library, ListFilter, Search, Workflow } from '@sim/emcn/icons'
import { HeroLoopShell } from '@/app/(landing)/components/shared/hero-loop-shell'
import { RESET_FADE_MS } from '@/app/(landing)/hooks/use-design-scale'
import { useMotionSafeCycle } from '@/app/(landing)/hooks/use-motion-safe-cycle'

/** Sidebar content for the logs hero - a team living in its run history. */
const SIDEBAR_CHATS = [
  'Debug nightly sync failure',
  'Cost of the support agent',
  'Error rate this week',
  'Export June run history',
] as const

/** Deployed workflows in the sidebar - the same names the runs table shows. */
const SIDEBAR_WORKFLOWS = [
  'Support ticket routing',
  'Lead enrichment',
  'Invoice matching',
  'Nightly data sync',
  'Churn-risk alerts',
] as const

type LogStatus = 'completed' | 'error' | 'running'

interface LogRowData {
  workflowName: string
  date: string
  status: LogStatus
  cost: string
  triggerLabel: string
  duration: string
}

type BadgeVariant = BadgeProps['variant']

/** Status → Badge variant, matching the real Logs table's treatment. */
const STATUS_VARIANT: Record<LogStatus, BadgeVariant> = {
  completed: 'gray-secondary',
  error: 'gray',
  running: 'gray',
}

const STATUS_LABELS: Record<LogStatus, string> = {
  completed: 'Completed',
  error: 'Error',
  running: 'Running',
}

/**
 * The run the loop watches land live: it fades in at the top of the table
 * as "Running", then flips to "Completed" with its cost and duration.
 */
const LIVE_ROW = {
  workflowName: 'Support ticket routing',
  date: 'Jul 12  9:41 AM',
  triggerLabel: 'Webhook',
  runningCost: '-',
  runningDuration: '-',
  completedCost: '3 credits',
  completedDuration: '1.8s',
} as const

/**
 * The settled run history beneath the live row - eleven rows fill the
 * design height under the title and options bars. Chat-triggered runs
 * read "Sim agent" per the constitution's run-log rule.
 */
const HISTORY_ROWS: readonly LogRowData[] = [
  {
    workflowName: 'Lead enrichment',
    date: 'Jul 12  9:12 AM',
    status: 'completed',
    cost: '2 credits',
    triggerLabel: 'API',
    duration: '2.4s',
  },
  {
    workflowName: 'Nightly data sync',
    date: 'Jul 12  2:14 AM',
    status: 'error',
    cost: '1 credit',
    triggerLabel: 'Schedule',
    duration: '38.2s',
  },
  {
    workflowName: 'Invoice matching',
    date: 'Jul 11  6:48 PM',
    status: 'completed',
    cost: '4 credits',
    triggerLabel: 'Sim agent',
    duration: '5.3s',
  },
  {
    workflowName: 'Support ticket routing',
    date: 'Jul 11  4:02 PM',
    status: 'completed',
    cost: '3 credits',
    triggerLabel: 'Webhook',
    duration: '1.7s',
  },
  {
    workflowName: 'Churn-risk alerts',
    date: 'Jul 11  9:00 AM',
    status: 'completed',
    cost: '5 credits',
    triggerLabel: 'Schedule',
    duration: '11.9s',
  },
  {
    workflowName: 'Lead enrichment',
    date: 'Jul 11  8:31 AM',
    status: 'completed',
    cost: '2 credits',
    triggerLabel: 'API',
    duration: '2.1s',
  },
  {
    workflowName: 'Weekly digest',
    date: 'Jul 11  7:00 AM',
    status: 'completed',
    cost: '6 credits',
    triggerLabel: 'Schedule',
    duration: '24.6s',
  },
  {
    workflowName: 'Invoice matching',
    date: 'Jul 10  5:19 PM',
    status: 'completed',
    cost: '4 credits',
    triggerLabel: 'Manual',
    duration: '4.8s',
  },
  {
    workflowName: 'Support ticket routing',
    date: 'Jul 10  2:44 PM',
    status: 'completed',
    cost: '3 credits',
    triggerLabel: 'Webhook',
    duration: '2.0s',
  },
  {
    workflowName: 'Nightly data sync',
    date: 'Jul 10  2:14 AM',
    status: 'completed',
    cost: '1 credit',
    triggerLabel: 'Schedule',
    duration: '31.5s',
  },
  {
    workflowName: 'Churn-risk alerts',
    date: 'Jul 9  9:00 AM',
    status: 'completed',
    cost: '5 credits',
    triggerLabel: 'Schedule',
    duration: '12.4s',
  },
] as const

/** Column headers matching the real Logs table. */
const COL_HEADERS = ['Workflow', 'Date', 'Status', 'Cost', 'Trigger', 'Duration'] as const

/** Column widths matching the workspace Logs table's proportions. */
const COL_WIDTHS = ['22%', '18%', '13%', '15%', '14%', '18%'] as const

/** The empty table holds this long before history rows stamp in. */
const HISTORY_START_MS = 500
/** History row N fades in at HISTORY_START_MS + N * HISTORY_STEP_MS. */
const HISTORY_STEP_MS = 90
/** The live run appears at the top of the table as "Running" here. */
const LIVE_APPEAR_MS = 2400
/** The live run flips to "Completed" with cost and duration here. */
const LIVE_COMPLETE_MS = 4800
/** The finished table holds this long before the fade. */
const COMPLETED_HOLD_MS = 4400

type LiveState = 'hidden' | 'running' | 'completed'

interface LogsTableRowProps {
  row: LogRowData
  visible: boolean
}

/** One settled history row - fades in on its scheduled beat. */
function LogsTableRow({ row, visible }: LogsTableRowProps) {
  return (
    <tr
      className={cn(
        'h-[44px] transition-opacity duration-300 ease-out',
        visible ? 'opacity-100' : 'opacity-0'
      )}
    >
      <td className='px-6 align-middle'>
        <div className='flex items-center gap-2'>
          <Workflow className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
          <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-caption'>
            {row.workflowName}
          </span>
        </div>
      </td>
      <td className='px-6 align-middle text-[var(--text-secondary)] text-caption'>{row.date}</td>
      <td className='px-6 align-middle'>
        <Badge variant={STATUS_VARIANT[row.status]} size='sm' dot>
          {STATUS_LABELS[row.status]}
        </Badge>
      </td>
      <td className='px-6 align-middle text-[var(--text-secondary)] text-caption'>{row.cost}</td>
      <td className='px-6 align-middle'>
        <Badge variant='gray-secondary' size='sm'>
          {row.triggerLabel}
        </Badge>
      </td>
      <td className='px-6 align-middle text-[var(--text-secondary)] text-caption'>
        {row.duration}
      </td>
    </tr>
  )
}

/**
 * The logs hero's platform loop - the workflows editor loop's architecture
 * (fixed 1280x735 design-space layer scaled to the window via ResizeObserver
 * + `transform: scale`, a parent-owned clock, reduced-motion showing the
 * finished frame) with the workspace pane replaced by a static rendering of
 * the real Logs surface: the 44px title bar (Library icon, "Logs", Export,
 * Logs/Dashboard tabs), the search/Filter/Sort options bar, and the runs
 * table with Workflow / Date / Status / Cost / Trigger / Duration columns.
 *
 * The loop's beats: the run history stamps in row by row, a new run then
 * fades in at the top as "Running" (its slot is reserved from the start, so
 * nothing shifts), flips to "Completed" with its cost and duration, holds,
 * fades, and restarts. Under `prefers-reduced-motion` the loop never
 * starts: the finished table - live run completed - renders statically.
 *
 * Everything is `pointer-events-none` decorative, matching the hero's
 * `aria-hidden` frame.
 */
export function LogsHeroLoop() {
  const [historyCount, setHistoryCount] = useState(0)
  const [liveState, setLiveState] = useState<LiveState>('hidden')
  const [fading, setFading] = useState(false)
  const [cycleId, setCycleId] = useState(0)

  useMotionSafeCycle({
    scheduleCycle: () => {
      setFading(false)
      setHistoryCount(0)
      setLiveState('hidden')
      setCycleId((c) => c + 1)
      const totalMs = LIVE_COMPLETE_MS + COMPLETED_HOLD_MS
      return {
        timers: [
          ...HISTORY_ROWS.map((_, i) =>
            setTimeout(() => setHistoryCount(i + 1), HISTORY_START_MS + i * HISTORY_STEP_MS)
          ),
          setTimeout(() => setLiveState('running'), LIVE_APPEAR_MS),
          setTimeout(() => setLiveState('completed'), LIVE_COMPLETE_MS),
          setTimeout(() => setFading(true), totalMs - RESET_FADE_MS),
        ],
        totalMs,
      }
    },
    showFinished: () => {
      setFading(false)
      setHistoryCount(HISTORY_ROWS.length)
      setLiveState('completed')
    },
  })

  const liveCompleted = liveState === 'completed'

  return (
    <HeroLoopShell chats={SIDEBAR_CHATS} workflows={SIDEBAR_WORKFLOWS} activeNav='Logs'>
      <div className='h-full w-full overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--bg)]'>
        <div
          key={cycleId}
          className={cn(
            'flex h-full w-full flex-col transition-opacity duration-300 ease-out',
            fading ? 'opacity-0' : 'opacity-100'
          )}
        >
          <div className='flex h-[44px] flex-shrink-0 items-center border-[var(--border)] border-b px-6'>
            <div className='flex w-full items-center justify-between'>
              <div className='flex items-center gap-3'>
                <Library className='size-[14px] text-[var(--text-icon)]' />
                <span className='font-medium text-[var(--text-body)] text-sm'>Logs</span>
              </div>
              <div className='flex items-center gap-1'>
                <span className='flex items-center rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
                  <Download className='mr-1.5 size-[14px] text-[var(--text-icon)]' />
                  Export
                </span>
                <span className='rounded-md bg-[var(--surface-active)] px-2 py-1 text-[var(--text-body)] text-caption'>
                  Logs
                </span>
                <span className='rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
                  Dashboard
                </span>
              </div>
            </div>
          </div>

          <div className='flex-shrink-0 border-[var(--border)] border-b px-6 py-2.5'>
            <div className='flex items-center justify-between'>
              <div className='flex flex-1 items-center gap-2.5'>
                <Search className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                <span className='flex-1 text-[var(--text-muted)] text-caption'>Search logs...</span>
              </div>
              <div className='flex items-center gap-1.5'>
                <span className='flex items-center rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
                  <ListFilter className='mr-1.5 size-[14px] text-[var(--text-icon)]' />
                  Filter
                </span>
                <span className='flex items-center rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
                  <ArrowUpDown className='mr-1.5 size-[14px] text-[var(--text-icon)]' />
                  Sort
                </span>
              </div>
            </div>
          </div>

          <div className='min-h-0 flex-1 overflow-hidden'>
            <table className='w-full table-fixed text-sm'>
              <colgroup>
                {COL_WIDTHS.map((width, index) => (
                  <col key={index} style={{ width }} />
                ))}
              </colgroup>
              <thead className='shadow-[inset_0_-1px_0_var(--border)]'>
                <tr>
                  {COL_HEADERS.map((label) => (
                    <th
                      key={label}
                      className='h-10 px-6 py-1.5 text-left align-middle font-normal text-[var(--text-muted)] text-caption'
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr
                  className={cn(
                    'h-[44px] transition-opacity duration-300 ease-out',
                    liveState === 'hidden' ? 'opacity-0' : 'opacity-100'
                  )}
                >
                  <td className='px-6 align-middle'>
                    <div className='flex items-center gap-2'>
                      <Workflow className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                      <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-caption'>
                        {LIVE_ROW.workflowName}
                      </span>
                    </div>
                  </td>
                  <td className='px-6 align-middle text-[var(--text-secondary)] text-caption'>
                    {LIVE_ROW.date}
                  </td>
                  <td className='px-6 align-middle'>
                    <Badge variant={liveCompleted ? 'gray-secondary' : 'gray'} size='sm' dot>
                      {liveCompleted ? 'Completed' : 'Running'}
                    </Badge>
                  </td>
                  <td className='px-6 align-middle text-[var(--text-secondary)] text-caption'>
                    {liveCompleted ? LIVE_ROW.completedCost : LIVE_ROW.runningCost}
                  </td>
                  <td className='px-6 align-middle'>
                    <Badge variant='gray-secondary' size='sm'>
                      {LIVE_ROW.triggerLabel}
                    </Badge>
                  </td>
                  <td className='px-6 align-middle text-[var(--text-secondary)] text-caption'>
                    {liveCompleted ? LIVE_ROW.completedDuration : LIVE_ROW.runningDuration}
                  </td>
                </tr>
                {HISTORY_ROWS.map((row, index) => (
                  <LogsTableRow
                    key={`${row.workflowName}-${row.date}`}
                    row={row}
                    visible={index < historyCount}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </HeroLoopShell>
  )
}
