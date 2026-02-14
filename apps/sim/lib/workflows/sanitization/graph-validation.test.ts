import { describe, expect, it } from 'vitest'
import { detectDirectedCycle } from './graph-validation'

describe('detectDirectedCycle', () => {
  it('returns no cycle for acyclic graph', () => {
    const result = detectDirectedCycle([
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ])
    expect(result.hasCycle).toBe(false)
    expect(result.cyclePath).toEqual([])
  })

  it('detects simple directed cycle', () => {
    const result = detectDirectedCycle([
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'a' },
    ])
    expect(result.hasCycle).toBe(true)
    expect(result.cyclePath.length).toBeGreaterThanOrEqual(3)
    expect(result.cyclePath[0]).toBe(result.cyclePath[result.cyclePath.length - 1])
  })

  it('detects self loop as cycle', () => {
    const result = detectDirectedCycle([{ source: 'a', target: 'a' }])
    expect(result.hasCycle).toBe(true)
    expect(result.cyclePath).toEqual(['a', 'a'])
  })
})

