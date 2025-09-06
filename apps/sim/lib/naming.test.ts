import { describe, expect, it } from 'vitest'
import { generateUniqueBlockDuplicateName, normalizeBlockName } from '@/lib/naming'

describe('block naming helpers', () => {
  it('normalizes names by lowercasing and removing spaces only', () => {
    expect(normalizeBlockName('My Agent')).toBe('myagent')
    expect(normalizeBlockName(' My   Agent ')).toBe('myagent')
    expect(normalizeBlockName('My__Agent')).toBe('my__agent')
  })

  it('duplicates base without suffix as "Base 1"', () => {
    const existing = ['Agent']
    expect(generateUniqueBlockDuplicateName(existing, 'Agent')).toBe('Agent 1')
  })

  it('skips to next available when immediate next collides (normalized)', () => {
    const existing = ['Agent', 'agent1']
    expect(generateUniqueBlockDuplicateName(existing, 'Agent')).toBe('Agent 2')
  })

  it('increments numeric suffix when present and finds next free', () => {
    const existing = ['Agent', 'Agent 5', 'Agent 6']
    expect(generateUniqueBlockDuplicateName(existing, 'Agent 5')).toBe('Agent 7')
  })

  it('handles names with no whitespace before digits as new base', () => {
    const existing = ['Agent5']
    expect(generateUniqueBlockDuplicateName(existing, 'Agent5')).toBe('Agent5 1')
  })

  it('handles multiple spaces and prevents normalized collisions', () => {
    const existing = ['myagent1', 'My Agent']
    expect(generateUniqueBlockDuplicateName(existing, 'My  Agent')).toBe('My  Agent 2')
  })

  it('fills gaps by choosing the next available number', () => {
    const existing = ['Agent', 'Agent 1', 'Agent 3', 'Agent 4']
    expect(generateUniqueBlockDuplicateName(existing, 'Agent')).toBe('Agent 2')
  })

  it('falls back to "Block" base for empty or whitespace-only names', () => {
    const existing1: string[] = []
    expect(generateUniqueBlockDuplicateName(existing1, '')).toBe('Block 1')

    const existing2 = ['Block 1']
    expect(generateUniqueBlockDuplicateName(existing2, '   ')).toBe('Block 2')
  })
})
