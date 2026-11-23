import { expectLinearGrowth } from '@sim/testing/helpers/scaling'
import { describe, expect, it } from 'vitest'
import { localResourceChanges, sourceStatus } from './status'

function changedFiles(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    path: `files/f${index}.txt`,
    change: 'created' as const,
  }))
}

describe('localResourceChanges', () => {
  it('groups the changed files of one kind in linear time', () => {
    expect(localResourceChanges(changedFiles(100))).toHaveLength(100)
    const grouped = (count: number) => {
      const files = changedFiles(count)
      return () => localResourceChanges(files)
    }
    expectLinearGrowth(grouped, 10_000)
  })
})

describe('sourceStatus', () => {
  it('meets many server changes with many local files in linear time', () => {
    const local = localResourceChanges([
      ...changedFiles(100),
      { path: 'secrets.ts', change: 'edited' as const },
    ])
    expect(
      sourceStatus(local, [
        { kind: 'file', key: 'f7.txt', server: 'changed' },
        { kind: 'file', key: 'gone.txt', server: 'deleted' },
        { kind: 'secret', key: 'API_KEY', server: 'changed' },
      ])
    ).toMatchObject({
      state: 'conflict',
      conflicts: [
        { key: 'f7.txt', change: 'created' },
        { kind: 'secret', key: 'API_KEY', change: 'edited' },
      ],
      drift: [{ key: 'gone.txt' }],
    })
    const met = (count: number) => {
      const files = localResourceChanges(changedFiles(count))
      const server = Array.from({ length: count }, (_, index) => ({
        kind: 'file' as const,
        key: `other${index}.txt`,
        server: 'changed' as const,
      }))
      return () => sourceStatus(files, server)
    }
    expectLinearGrowth(met, 2_000)
  })
})
