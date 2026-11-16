import { describe, expect, it } from 'vitest'
import { ParallelBlock } from '@/blocks/blocks/parallel'

describe('ParallelBlock', () => {
  it('maps an agent search call, whose operation arrives only in context', () => {
    const args = { objective: 'When was the UN founded?', include_domains: 'un.org' }
    const result = {
      ...args,
      ...ParallelBlock.tools.config.params!(args, { operation: 'search' }),
    }

    expect(result.search_queries).toBe('When was the UN founded?')
    expect(result.include_domains).toBe('un.org')
  })
})
