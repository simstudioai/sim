/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { allocateTagSlots, getSlotsForFieldType } from '@/lib/knowledge/constants'

describe('allocateTagSlots', () => {
  it.concurrent('assigns unique slots for multiple text tags', () => {
    const defs = [
      { id: 'issueType', displayName: 'Issue Type', fieldType: 'text' },
      { id: 'status', displayName: 'Status', fieldType: 'text' },
      { id: 'priority', displayName: 'Priority', fieldType: 'text' },
    ]

    const { mapping, skipped } = allocateTagSlots(defs, new Set())

    expect(mapping).toEqual({
      issueType: 'tag1',
      status: 'tag2',
      priority: 'tag3',
    })
    expect(skipped).toEqual([])
  })

  it.concurrent('assigns slots across different field types', () => {
    const defs = [
      { id: 'label', displayName: 'Label', fieldType: 'text' },
      { id: 'count', displayName: 'Count', fieldType: 'number' },
      { id: 'updated', displayName: 'Updated', fieldType: 'date' },
      { id: 'active', displayName: 'Active', fieldType: 'boolean' },
    ]

    const { mapping, skipped } = allocateTagSlots(defs, new Set())

    expect(mapping).toEqual({
      label: 'tag1',
      count: 'number1',
      updated: 'date1',
      active: 'boolean1',
    })
    expect(skipped).toEqual([])
  })

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

  it.concurrent('returns empty mapping when all slots are used', () => {
    const allTextSlots = getSlotsForFieldType('text')
    const usedSlots = new Set<string>(allTextSlots)

    const defs = [{ id: 'label', displayName: 'Label', fieldType: 'text' }]
    const { mapping, skipped } = allocateTagSlots(defs, usedSlots)

    expect(mapping).toEqual({})
    expect(skipped).toEqual(['Label'])
  })

  it.concurrent('handles empty definitions list', () => {
    const { mapping, skipped } = allocateTagSlots([], new Set())

    expect(mapping).toEqual({})
    expect(skipped).toEqual([])
  })

  it.concurrent('handles unknown field type gracefully', () => {
    const defs = [{ id: 'x', displayName: 'Unknown', fieldType: 'unknown' }]
    const { mapping, skipped } = allocateTagSlots(defs, new Set())

    expect(mapping).toEqual({})
    expect(skipped).toEqual(['Unknown'])
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
