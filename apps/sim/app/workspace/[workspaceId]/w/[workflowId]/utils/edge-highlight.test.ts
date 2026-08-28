import { describe, expect, it } from 'vitest'
import { isEdgeHighlighted } from './edge-highlight'

describe('isEdgeHighlighted', () => {
  it('highlights a directly selected edge', () => {
    expect(isEdgeHighlighted({ isEdgeSelected: true })).toBe(true)
  })

  it('leaves an unrelated edge idle', () => {
    expect(isEdgeHighlighted({})).toBe(false)
  })
})
