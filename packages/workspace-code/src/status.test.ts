import { growth, MAX_GROWTH } from '@sim/workflow-code/scaling.test-helpers'
import { describe, expect, it } from 'vitest'
import { localResourceChanges } from './status'

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
    expect(growth(grouped, 10_000)).toBeLessThan(MAX_GROWTH)
  })
})
