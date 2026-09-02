/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { applyPipeline } from '@/lib/mothership/agent-cli/pipeline'
import type { AgentCliGrepStage } from '@/lib/mothership/generated/agent-cli'

function grep(overrides: Partial<AgentCliGrepStage> & { pattern: string }): AgentCliGrepStage {
  return {
    kind: 'grep',
    ignoreCase: false,
    invert: false,
    countOnly: false,
    lineNumbers: false,
    linesBefore: 0,
    linesAfter: 0,
    ...overrides,
  }
}

describe('applyPipeline over typed grep stages', () => {
  const input = 'alpha slack\nbeta\ngamma SLACK\nslack delta\n'

  it('filters lines by pattern', () => {
    expect(applyPipeline(input, [grep({ pattern: 'slack' })])).toBe('alpha slack\nslack delta')
  })

  it('honours ignoreCase, lineNumbers, invert, countOnly, and maxCount', () => {
    expect(applyPipeline(input, [grep({ pattern: 'slack', ignoreCase: true })])).toBe(
      'alpha slack\ngamma SLACK\nslack delta'
    )
    expect(applyPipeline(input, [grep({ pattern: 'slack', lineNumbers: true })])).toBe(
      '1:alpha slack\n4:slack delta'
    )
    expect(applyPipeline(input, [grep({ pattern: 'slack', invert: true })])).toBe(
      'beta\ngamma SLACK\n'
    )
    expect(
      applyPipeline(input, [grep({ pattern: 'slack', ignoreCase: true, countOnly: true })])
    ).toBe('3')
    expect(applyPipeline(input, [grep({ pattern: 'slack', ignoreCase: true, maxCount: 2 })])).toBe(
      'alpha slack\ngamma SLACK'
    )
  })

  it('treats the pattern as a regex with a literal fallback', () => {
    expect(applyPipeline('a1\nb2\nc3', [grep({ pattern: '^[ab]' })])).toBe('a1\nb2')
    expect(applyPipeline('cost is $4 (net', [grep({ pattern: '$4 (net' })])).toBe('cost is $4 (net')
  })

  it('chains stages left to right', () => {
    expect(
      applyPipeline(input, [
        grep({ pattern: 'slack', ignoreCase: true }),
        grep({ pattern: 'delta', invert: true }),
      ])
    ).toBe('alpha slack\ngamma SLACK')
  })

  describe('context windows', () => {
    const lines = 'a\nb\nHIT\nc\nd\ne\nHIT\nf'
    it('trailing context', () => {
      expect(applyPipeline(lines, [grep({ pattern: 'HIT', linesAfter: 1 })])).toBe('HIT\nc\nHIT\nf')
    })
    it('windows without duplicating overlaps', () => {
      expect(
        applyPipeline('x\nHIT\nHIT\ny', [grep({ pattern: 'HIT', linesBefore: 1, linesAfter: 1 })])
      ).toBe('x\nHIT\nHIT\ny')
    })
    it('counts hits, not context lines', () => {
      expect(applyPipeline(lines, [grep({ pattern: 'HIT', countOnly: true, linesAfter: 2 })])).toBe(
        '2'
      )
    })
  })
})
