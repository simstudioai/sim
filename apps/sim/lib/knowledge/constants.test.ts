import { describe, expect, it } from 'vitest'
import { allocateTagSlots } from '@/lib/knowledge/constants'

describe('allocateTagSlots', () => {
  it.concurrent('skips already-used slots', () => {
    const defs = [
      { id: 'a', displayName: 'A', fieldType: 'text' },
      { id: 'b', displayName: 'B', fieldType: 'text' },
    ]

    const usedSlots = new Set(['tag1', 'tag3'])
    const { mapping, skipped } = allocateTagSlots(defs, usedSlots)

    expect(mapping).toEqual({
      a: 'tag2',
      b: 'tag4',
    })
    expect(skipped).toEqual([])
  })

  it.concurrent('skips tags when all slots of that type are used', () => {
    const defs = [
      { id: 'a', displayName: 'Date A', fieldType: 'date' },
      { id: 'b', displayName: 'Date B', fieldType: 'date' },
      { id: 'c', displayName: 'Date C', fieldType: 'date' },
    ]

    const { mapping, skipped } = allocateTagSlots(defs, new Set())

    expect(mapping).toEqual({
      a: 'date1',
      b: 'date2',
    })
    expect(skipped).toEqual(['Date C'])
  })

  it.concurrent('does not mutate the input usedSlots set', () => {
    const defs = [
      { id: 'a', displayName: 'A', fieldType: 'text' },
      { id: 'b', displayName: 'B', fieldType: 'text' },
    ]

    const usedSlots = new Set<string>()
    allocateTagSlots(defs, usedSlots)

    expect(usedSlots.size).toBe(0)
  })
})
