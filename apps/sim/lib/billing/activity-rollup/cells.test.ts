import { describe, expect, it, vi } from 'vitest'
import {
  type ActivityCell,
  aggregateHour,
  HeavyHourError,
  type HourReaders,
} from '@/lib/billing/activity-rollup/cells'
import type { InstantRange } from '@/lib/billing/activity-rollup/source'

const HOUR = 60 * 60 * 1000
const hour = new Date('2026-05-01T10:00:00.000Z')

function cell(workflowId: string, runs: number, durationSumMs: number): ActivityCell {
  return {
    workspaceId: 'ws',
    workflowId,
    trigger: 'api',
    runs,
    completed: runs,
    failed: 0,
    cancelled: 0,
    inFlight: 0,
    durationSumMs,
    durationCount: runs,
  }
}

function cancellation(message: string, code: string) {
  return Object.assign(new Error(message), { code })
}

const timeout = () => cancellation('canceling statement due to statement timeout', '57014')
const quarter = (range: InstantRange) => (range.from.getTime() - hour.getTime()) / (HOUR / 4)
const isWholeHour = (range: InstantRange) => range.to.getTime() - range.from.getTime() === HOUR

function readers(overrides: Partial<HourReaders>): HourReaders {
  return {
    span: vi.fn(async () => {
      throw new Error('span not expected')
    }),
    workspacePage: vi.fn(async () => {
      throw new Error('workspace page not expected')
    }),
    ...overrides,
  }
}

describe('aggregateHour', () => {
  it.each([
    ['times out', timeout()],
    [
      'is cancelled by replica recovery',
      cancellation('canceling statement due to conflict with recovery', '40001'),
    ],
  ])(
    'reads an hour whose whole read %s in quarter-hour slices summed by cell',
    async (_, error) => {
      const span = vi.fn(async (range: InstantRange) => {
        if (isWholeHour(range)) throw error
        return quarter(range) === 2 ? [cell('a', 1, 10), cell('b', 2, 30)] : [cell('a', 1, 5)]
      })

      const cells = await aggregateHour(hour, Number.POSITIVE_INFINITY, readers({ span }))

      expect(span.mock.calls.map(([range]) => range.from.toISOString())).toEqual([
        '2026-05-01T10:00:00.000Z',
        '2026-05-01T10:00:00.000Z',
        '2026-05-01T10:15:00.000Z',
        '2026-05-01T10:30:00.000Z',
        '2026-05-01T10:45:00.000Z',
      ])
      expect(span.mock.calls.at(-1)?.[0].to.toISOString()).toBe('2026-05-01T11:00:00.000Z')
      expect(cells).toEqual([cell('a', 4, 25), cell('b', 2, 30)])
    }
  )

  it('reads a slice that still times out a page of workspaces at a time', async () => {
    const span = vi.fn(async (range: InstantRange) => {
      if (isWholeHour(range) || quarter(range) === 3) throw timeout()
      return [cell('a', 1, 5)]
    })
    const workspacePage = vi.fn(async (_range: InstantRange, after: string | null) =>
      after === null
        ? { cells: [cell('a', 2, 7)], last: 'ws-500' }
        : { cells: [cell('b', 1, 1)], last: null }
    )

    const cells = await aggregateHour(
      hour,
      Number.POSITIVE_INFINITY,
      readers({ span, workspacePage })
    )

    expect(workspacePage.mock.calls.map(([range, after]) => [quarter(range), after])).toEqual([
      [3, null],
      [3, 'ws-500'],
    ])
    expect(cells).toEqual([cell('a', 5, 22), cell('b', 1, 1)])
  })

  it('gives the hour up as too heavy rather than page workspaces past the pass budget', async () => {
    const span = vi.fn(async () => {
      throw timeout()
    })
    const workspacePage = vi.fn(async () => ({ cells: [], last: null }))

    await expect(
      aggregateHour(hour, Date.now() - 1, readers({ span, workspacePage }))
    ).rejects.toBeInstanceOf(HeavyHourError)
    expect(workspacePage).not.toHaveBeenCalled()
  })

  it('fails without slicing when the read fails for any other reason', async () => {
    const span = vi.fn(async () => {
      throw cancellation('relation "workflow_execution_logs" does not exist', '42P01')
    })

    await expect(aggregateHour(hour, Number.POSITIVE_INFINITY, readers({ span }))).rejects.toThrow(
      'does not exist'
    )
    expect(span).toHaveBeenCalledTimes(1)
  })
})
