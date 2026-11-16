import { describe, expect, it } from 'vitest'
import { ParallelBlock } from '@/blocks/blocks/parallel'

const blockParams = ParallelBlock.tools.config?.params
if (!blockParams) throw new Error('ParallelBlock has no params mapper')

describe('ParallelBlock', () => {
  it('maps an agent search call, whose operation arrives only in context', () => {
    const args: Record<string, unknown> = {
      objective: 'When was the UN founded?',
      include_domains: 'un.org',
    }
    const result = {
      ...args,
      ...blockParams(args, { operation: 'search' }),
    }

    expect(result.search_queries).toBe('When was the UN founded?')
    expect(result.include_domains).toBe('un.org')
  })
})
