'use client'

import { useState } from 'react'
import { Badge, cn } from '@sim/emcn'
import { Building, Download } from '@sim/emcn/icons'
import {
  PLATFORM_LOOP_DESIGN,
  PLATFORM_LOOP_RESET_FADE_MS,
} from '@/app/(landing)/components/shared/platform-loop-constants'
import { ResponsiveDesignStage } from '@/app/(landing)/components/shared/responsive-design-stage'
import { useMotionSafeCycle } from '@/app/(landing)/hooks/use-motion-safe-cycle'
import { SegmentedMeter } from '@/app/workspace/[workspaceId]/settings/components/segmented-meter/segmented-meter'

/** The organization's monthly budget and where spend stands against it. */
const BUDGET = 6_000
const SPEND = 3_480
const METER_SEGMENTS = 24

interface WorkspaceRow {
  name: string
  agents: number
  runs: string
  spend: string
  limit: string
  /** Spend against the workspace's own cap; `near` trips the amber status. */
  status: 'under' | 'near'
}

const WORKSPACE_ROWS: readonly WorkspaceRow[] = [
  { name: 'Support', agents: 12, runs: '6,410', spend: '$1,240', limit: '$2,000', status: 'under' },
  { name: 'Sales', agents: 9, runs: '4,120', spend: '$860', limit: '$1,500', status: 'under' },
  { name: 'Finance', agents: 6, runs: '2,980', spend: '$720', limit: '$800', status: 'near' },
  { name: 'Operations', agents: 8, runs: '2,760', spend: '$410', limit: '$1,000', status: 'under' },
  { name: 'Research', agents: 7, runs: '1,934', spend: '$250', limit: '$500', status: 'under' },
] as const

const COL_WIDTHS = ['24%', '12%', '15%', '13%', '14%', '22%'] as const
const COL_HEADERS = ['Workspace', 'Agents', 'Runs (30d)', 'Spend', 'Limit', 'Status'] as const

/** The cycle, in ms from its start. */
const ROWS_START_MS = 500
const ROW_STEP_MS = 160
const METER_START_MS = 900
const METER_STEPS = 24
const METER_STEP_MS = 45
const NEAR_LIMIT_AT_MS = METER_START_MS + METER_STEPS * METER_STEP_MS + 500
const HOLD_MS = 3_600

/** Stat card chrome, the settings panel's card on the product's bg. */
const STAT_CARD = 'flex flex-col gap-2 rounded-[8px] border border-[var(--border)] px-4 py-3.5'

/**
 * The platform suite's "Govern at scale" preview: the organization's
 * overview, where an admin sees and controls every agent - spend this month
 * against the org budget on the settings meter, active agents and runs, and
 * each workspace's spend against its own limit. On each cycle the workspace
 * rows land one by one, the budget meter fills to this month's spend, and
 * Finance trips its near-limit status; the frame holds and fades back.
 * Decorative; the host window takes no input. Reduced motion shows the
 * finished state.
 */
export function GovernanceLoop() {
  const [rowCount, setRowCount] = useState(WORKSPACE_ROWS.length)
  const [meterStep, setMeterStep] = useState(METER_STEPS)
  const [nearLimit, setNearLimit] = useState(true)
  const [fading, setFading] = useState(false)
  const [cycleId, setCycleId] = useState(0)

  useMotionSafeCycle({
    scheduleCycle: () => {
      setFading(false)
      setRowCount(0)
      setMeterStep(0)
      setNearLimit(false)
      setCycleId((id) => id + 1)
      const totalMs = NEAR_LIMIT_AT_MS + HOLD_MS
      return {
        timers: [
          ...WORKSPACE_ROWS.map((_, index) =>
            setTimeout(() => setRowCount(index + 1), ROWS_START_MS + index * ROW_STEP_MS)
          ),
          ...Array.from({ length: METER_STEPS }, (_, index) =>
            setTimeout(() => setMeterStep(index + 1), METER_START_MS + index * METER_STEP_MS)
          ),
          setTimeout(() => setNearLimit(true), NEAR_LIMIT_AT_MS),
          setTimeout(() => setFading(true), totalMs - PLATFORM_LOOP_RESET_FADE_MS),
        ],
        totalMs,
      }
    },
    showFinished: () => {
      setFading(false)
      setRowCount(WORKSPACE_ROWS.length)
      setMeterStep(METER_STEPS)
      setNearLimit(true)
    },
  })

  const spendShown = Math.round((SPEND * meterStep) / METER_STEPS)
  const percent = Math.round((spendShown / BUDGET) * 100)

  return (
    <ResponsiveDesignStage
      width={PLATFORM_LOOP_DESIGN.width}
      height={PLATFORM_LOOP_DESIGN.height}
      align='start'
      className='pointer-events-none absolute inset-0'
      contentClassName='bg-[var(--surface-1)] p-2'
    >
      <div className='h-full w-full overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--bg)]'>
        <div
          key={cycleId}
          className={cn(
            'flex h-full w-full flex-col transition-opacity duration-300 ease-out',
            fading ? 'opacity-0' : 'opacity-100'
          )}
        >
          <div className='flex h-[44px] shrink-0 items-center border-[var(--border)] border-b px-6'>
            <div className='flex w-full items-center justify-between'>
              <div className='flex items-center gap-3'>
                <Building className='size-[14px] text-[var(--text-icon)]' />
                <span className='text-[var(--text-body)] text-sm'>Organization</span>
              </div>
              <div className='flex items-center gap-1'>
                <span className='flex items-center rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
                  <Download className='mr-1.5 size-[14px] text-[var(--text-icon)]' />
                  Export
                </span>
                <span className='rounded-md bg-[var(--surface-active)] px-2 py-1 text-[var(--text-body)] text-caption'>
                  Overview
                </span>
                <span className='rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
                  Members
                </span>
                <span className='rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
                  Usage
                </span>
              </div>
            </div>
          </div>

          <div className='grid shrink-0 grid-cols-3 gap-4 px-6 pt-5 pb-4'>
            <div className={STAT_CARD}>
              <span className='text-[var(--text-muted)] text-caption'>Spend this month</span>
              <span className='text-[var(--text-primary)] text-lg leading-none'>
                ${spendShown.toLocaleString('en-US')}
                <span className='text-[var(--text-muted)] text-caption'>
                  {' '}
                  of ${BUDGET.toLocaleString('en-US')}
                </span>
              </span>
              <SegmentedMeter used={spendShown} total={BUDGET} segments={METER_SEGMENTS} />
              <span className='text-[var(--text-muted)] text-caption'>
                {percent}% of the org budget · resets Aug 1
              </span>
            </div>
            <div className={STAT_CARD}>
              <span className='text-[var(--text-muted)] text-caption'>Active agents</span>
              <span className='text-[var(--text-primary)] text-lg leading-none'>42</span>
              <span className='text-[var(--text-muted)] text-caption'>Across 5 workspaces</span>
            </div>
            <div className={STAT_CARD}>
              <span className='text-[var(--text-muted)] text-caption'>Runs (30d)</span>
              <span className='text-[var(--text-primary)] text-lg leading-none'>18,204</span>
              <span className='text-[var(--text-muted)] text-caption'>99.2% completed</span>
            </div>
          </div>

          <div className='min-h-0 flex-1 overflow-hidden'>
            <div className='flex items-center justify-between px-6 pt-1 pb-2'>
              <span className='text-[var(--text-body)] text-sm'>Workspaces</span>
              <span className='rounded-md border border-[var(--border)] px-2 py-1 text-[var(--text-secondary)] text-caption'>
                Set limits
              </span>
            </div>
            <table className='w-full table-fixed text-sm'>
              <colgroup>
                {COL_WIDTHS.map((width, index) => (
                  <col key={index} style={{ width }} />
                ))}
              </colgroup>
              <thead className='border-[var(--border)] border-y'>
                <tr>
                  {COL_HEADERS.map((label) => (
                    <th
                      key={label}
                      className='h-9 px-6 py-1 text-left align-middle font-normal text-[var(--text-muted)] text-caption'
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {WORKSPACE_ROWS.map((row, index) => {
                  const near = row.status === 'near' && nearLimit
                  return (
                    <tr
                      key={row.name}
                      className={cn(
                        'h-[42px] border-[var(--border)] border-b transition-opacity duration-300 ease-out',
                        index < rowCount ? 'opacity-100' : 'opacity-0'
                      )}
                    >
                      <td className='px-6 align-middle text-[var(--text-primary)] text-caption'>
                        {row.name}
                      </td>
                      <td className='px-6 align-middle text-[var(--text-secondary)] text-caption'>
                        {row.agents}
                      </td>
                      <td className='px-6 align-middle text-[var(--text-secondary)] text-caption'>
                        {row.runs}
                      </td>
                      <td className='px-6 align-middle text-[var(--text-secondary)] text-caption'>
                        {row.spend}
                      </td>
                      <td className='px-6 align-middle'>
                        <Badge variant='gray-secondary' size='sm'>
                          {row.limit} cap
                        </Badge>
                      </td>
                      <td className='px-6 align-middle'>
                        <Badge variant='gray-secondary' size='sm' dot>
                          {near ? 'Near limit' : 'Under limit'}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ResponsiveDesignStage>
  )
}
