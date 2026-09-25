import { describe, expect, it } from 'vitest'
import { MintlifyBlock } from '@/blocks/blocks/mintlify'

/**
 * The executor merges `tools.config.params` on top of the raw inputs, so every
 * assertion runs against the merged result rather than the transform's return
 * value alone.
 */
function resolveParams(inputs: Record<string, unknown>) {
  return { ...inputs, ...MintlifyBlock.tools.config.params!(inputs) }
}

describe('MintlifyBlock', () => {
  describe('operation scoping', () => {
    it('clears advanced values retained from another operation', () => {
      const result = resolveParams({
        operation: 'get_feedback',
        projectId: 'proj_1',
        // Retained from a prior Get Page Views selection, whose limit ceiling is 250.
        offset: '100',
        limit: '200',
      })

      expect(result.offset).toBeUndefined()
      expect(result.limit).toBe(200)
    })
  })

  describe('numeric coercion', () => {
    it('coerces numeric inputs delivered as strings', () => {
      const result = resolveParams({
        operation: 'search',
        domain: 'acme',
        query: 'custom domains',
        pageSize: '25',
        scoreThreshold: '0.4',
      })

      expect(result.pageSize).toBe(25)
      expect(result.scoreThreshold).toBe(0.4)
    })

    it('drops a numeric input that cannot be parsed', () => {
      const result = resolveParams({
        operation: 'get_views',
        projectId: 'proj_1',
        limit: 'not-a-number',
      })

      expect(result.limit).toBeUndefined()
    })
  })
})
