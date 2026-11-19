import { describe, expect, it } from 'vitest'
import { localResourceChanges } from './status'

describe('localResourceChanges', () => {
  it('groups 40,000 changed files of one kind in linear time', () => {
    const files = Array.from({ length: 40_000 }, (_, index) => ({
      path: `files/f${index}.txt`,
      change: 'created' as const,
    }))
    const started = Date.now()
    const changes = localResourceChanges(files)
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(changes).toHaveLength(40_000)
  })
})
