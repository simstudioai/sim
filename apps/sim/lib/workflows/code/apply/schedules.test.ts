/**
 * A source apply refuses a schedule deploy would refuse for its timing, so a green dry run is not
 * followed by a failed deploy, while a draft still missing a field keeps applying.
 */
import type { BlockState } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { diffGraphs, type SourceGraph } from '@/lib/workflows/code/apply/graph-diff'
import { findInvalidSchedules } from '@/lib/workflows/code/apply/schedules'

function schedule(id: string, values: Record<string, string>, enabled = true): BlockState {
  return {
    id,
    type: 'schedule',
    name: id,
    position: { x: 0, y: 0 },
    subBlocks: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, { id: key, type: 'short-input', value }])
    ),
    outputs: {},
    enabled,
    data: {},
  }
}

function refusals(next: BlockState, prev?: BlockState) {
  const base: SourceGraph = { blocks: prev ? { [prev.id]: prev } : {}, edges: [] }
  const target: SourceGraph = { blocks: { [next.id]: next }, edges: [] }
  return findInvalidSchedules(target, diffGraphs(base, target), (id) => id)
}

describe('findInvalidSchedules', () => {
  it.each([
    ['a malformed cron expression', { scheduleType: 'custom', cronExpression: '61 * * * *' }],
    ['a cron expression that is not one', { scheduleType: 'custom', cronExpression: 'every day' }],
    [
      'an unknown timezone',
      { scheduleType: 'daily', dailyTime: '09:00', timezone: 'Mars/Olympus_Mons' },
    ],
    ['an out-of-range interval', { scheduleType: 'minutes', minutesInterval: '5000' }],
  ])('refuses %s', (_label, values) => {
    const [refusal] = refusals(schedule('nightly', values))
    expect(refusal?.code).toBe('E_APPLY_INVALID_SCHEDULE')
    expect(refusal?.blockKey).toBe('nightly')
  })

  it.each([
    [
      'a valid cron in a timezone',
      { scheduleType: 'custom', cronExpression: '0 9 * * 1-5', timezone: 'America/New_York' },
    ],
    ['a daily schedule', { scheduleType: 'daily', dailyTime: '09:00' }],
    ['a draft still missing its time', { scheduleType: 'daily' }],
  ])('admits %s', (_label, values) => {
    expect(refusals(schedule('nightly', values))).toEqual([])
  })

  it('leaves an unchanged or disabled schedule alone', () => {
    const broken = schedule('nightly', { scheduleType: 'custom', cronExpression: 'nope' })
    expect(refusals(broken, broken)).toEqual([])
    expect(
      refusals(schedule('off', { scheduleType: 'custom', cronExpression: 'nope' }, false))
    ).toEqual([])
  })
})
