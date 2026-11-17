import { describe, expect, it } from 'vitest'
import { pauseBaseBlockId } from '@/lib/workflows/executor/pause-block-names'

describe('pauseBaseBlockId', () => {
  it.each([
    ['a loop iteration', 'approval_loop2', 'approval'],
    ['a parallel branch inside a loop', 'approval₍1₎_loop2', 'approval'],
    ['a cloned subflow branch inside a loop', 'approval__obranch-3₍0₎_loop4', 'approval'],
  ])('resolves the workflow block of a point keyed only by %s context', (_, contextId, base) => {
    expect(pauseBaseBlockId({ contextId })).toBe(base)
  })
})
