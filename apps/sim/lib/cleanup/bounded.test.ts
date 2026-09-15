import { describe, expect, it, vi } from 'vitest'
import { BoundedCleanup } from '@/lib/cleanup/bounded'
import type { CleanupProgress } from '@/lib/cleanup/bounded-types'

function setup(dryRun = false, now = () => 0) {
  const snapshots: CleanupProgress[] = []
  const control = new BoundedCleanup(
    { limits: { workflows: 5 }, batchSize: 2, dryRun, requestId: 'test' },
    async (progress) => {
      snapshots.push(progress)
    },
    now
  )
  return { control, snapshots }
}

describe('bounded cleanup accounting', () => {
  it('shares one budget across owner scopes and shrinks the final batch', async () => {
    const { control } = setup()
    const limits: number[] = []
    for (const scope of [
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]) {
      await control.batches(
        'workflows',
        async (limit, seen) => {
          limits.push(limit)
          return scope.filter((id) => !seen.includes(id)).slice(0, limit)
        },
        (id) => id,
        (rows) => control.deleted('workflows', rows.length)
      )
    }
    expect(control.progress.stages.workflows).toMatchObject({ selected: 5, deleted: 5 })
    expect(limits).toEqual([2, 2, 2])
    expect((await control.finish()).stopReason).toBe('budgets_exhausted')
  })
  it('charges restored/skipped roots instead of refilling the budget', async () => {
    const { control } = setup()
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const limits: number[] = []
    await control.batches(
      'workflows',
      async (limit, seen) => {
        limits.push(limit)
        return ids.filter((id) => !seen.includes(id)).slice(0, limit)
      },
      (id) => id,
      async () => {}
    )
    expect(limits).toEqual([2, 2, 1])
    expect(control.progress.stages.workflows).toMatchObject({ selected: 5, deleted: 0, skipped: 5 })
  })
  it('dry runs enumerate distinct roots without invoking side effects', async () => {
    const { control } = setup(true)
    const remove = vi.fn()
    await control.batches(
      'workflows',
      async (limit, seen) => ['a', 'b', 'c'].filter((id) => !seen.includes(id)).slice(0, limit),
      (id) => id,
      remove
    )
    expect(remove).not.toHaveBeenCalled()
    expect(control.progress.stages.workflows).toMatchObject({ selected: 3, deleted: 0, skipped: 0 })
    expect((await control.finish()).stopReason).toBe('scopes_exhausted')
  })
  it('never selects omitted types', async () => {
    const { control } = setup()
    const select = vi.fn()
    await control.batches('chats', select, (id: string) => id, vi.fn())
    expect(select).not.toHaveBeenCalled()
  })
  it('stops before another batch when its work deadline passes', async () => {
    let time = 0
    const { control } = setup(false, () => time)
    const select = vi.fn(async () => ['a', 'b'])
    await control.batches(
      'workflows',
      select,
      (id) => id,
      async (rows) => {
        await control.deleted('workflows', rows.length)
        time = 120_000
      }
    )
    expect(select).toHaveBeenCalledTimes(1)
    expect((await control.finish()).stopReason).toBe('time_budget')
  })
  it('persists completed effects and fails without starting a later batch', async () => {
    const { control, snapshots } = setup()
    const select = vi.fn(async () => ['a', 'b'])
    const failure = new Error('storage unavailable')
    await expect(
      control.batches(
        'workflows',
        select,
        (id) => id,
        async () => {
          await control.deleted('workflows', 1)
          throw failure
        }
      )
    ).rejects.toThrow(failure)
    await control.fail(failure)
    expect(select).toHaveBeenCalledTimes(1)
    expect(snapshots.at(-1)).toMatchObject({
      stopReason: 'failed',
      stage: 'workflows',
      error: 'storage unavailable',
      stages: { workflows: { selected: 2, deleted: 1 } },
    })
  })
})
