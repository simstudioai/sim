import { describe, expect, it, vi } from 'vitest'
import { type ActivityCell, aggregateHour } from '@/lib/billing/activity-rollup/cells'
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

describe('aggregateHour', () => {
  it.each([
    ['times out', cancellation('canceling statement due to statement timeout', '57014')],
    [
      'is cancelled by replica recovery',
      cancellation('canceling statement due to conflict with recovery', '40001'),
    ],
  ])(
    'reads an hour whose whole read %s in quarter-hour slices summed by cell',
    async (_, error) => {
      const read = vi.fn(async (range: InstantRange) => {
        if (range.to.getTime() - range.from.getTime() === HOUR) throw error
        const quarter = (range.from.getTime() - hour.getTime()) / (HOUR / 4)
        return quarter === 2 ? [cell('a', 1, 10), cell('b', 2, 30)] : [cell('a', 1, 5)]
      })

      const cells = await aggregateHour(hour, read)

      expect(read.mock.calls.map(([range]) => range.from.toISOString())).toEqual([
        '2026-05-01T10:00:00.000Z',
        '2026-05-01T10:00:00.000Z',
        '2026-05-01T10:15:00.000Z',
        '2026-05-01T10:30:00.000Z',
        '2026-05-01T10:45:00.000Z',
      ])
      expect(read.mock.calls.at(-1)?.[0].to.toISOString()).toBe('2026-05-01T11:00:00.000Z')
      expect(cells).toEqual([cell('a', 4, 25), cell('b', 2, 30)])
    }
  )

  it('fails without slicing when the read fails for any other reason', async () => {
    const read = vi.fn(async () => {
      throw cancellation('relation "workflow_execution_logs" does not exist', '42P01')
    })

    await expect(aggregateHour(hour, read)).rejects.toThrow('does not exist')
    expect(read).toHaveBeenCalledTimes(1)
  })
})
