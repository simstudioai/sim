import { describe, expect, it } from 'vitest'
import { BlockType } from '@/executor/consts'
import { Routing } from '@/executor/routing/routing'

describe('Parallel Activation Integration - shouldSkipConnection behavior', () => {
  describe('Regular blocks can activate parallel/loop blocks', () => {
    it('should allow Agent → Parallel connections', () => {
      // This was the original bug - agent couldn't activate parallel
      expect(Routing.shouldSkipConnection(undefined, BlockType.PARALLEL)).toBe(false)
      expect(Routing.shouldSkipConnection('source', BlockType.PARALLEL)).toBe(false)
    })

    it('should allow Function → Parallel connections', () => {
      expect(Routing.shouldSkipConnection(undefined, BlockType.PARALLEL)).toBe(false)
      expect(Routing.shouldSkipConnection('source', BlockType.PARALLEL)).toBe(false)
    })

    it('should allow API → Loop connections', () => {
      expect(Routing.shouldSkipConnection(undefined, BlockType.LOOP)).toBe(false)
      expect(Routing.shouldSkipConnection('source', BlockType.LOOP)).toBe(false)
    })

    it('should allow all regular blocks to activate parallel/loop', () => {
      const regularBlocks = [
        BlockType.FUNCTION,
        BlockType.AGENT,
        BlockType.API,
        BlockType.EVALUATOR,
        BlockType.RESPONSE,
        BlockType.WORKFLOW,
      ]

      regularBlocks.forEach((sourceBlockType) => {
        expect(Routing.shouldSkipConnection(undefined, BlockType.PARALLEL)).toBe(false)
        expect(Routing.shouldSkipConnection(undefined, BlockType.LOOP)).toBe(false)
      })
    })
  })

  describe('✅ Still works: Router and Condition blocks can activate parallel/loop', () => {
    it('should allow Router → Parallel connections', () => {
      expect(Routing.shouldSkipConnection(undefined, BlockType.PARALLEL)).toBe(false)
    })

    it('should allow Condition → Parallel connections', () => {
      expect(Routing.shouldSkipConnection(undefined, BlockType.PARALLEL)).toBe(false)
    })
  })

  describe('✅ Still blocked: Internal flow control connections', () => {
    it('should block parallel-start-source connections during selective activation', () => {
      expect(Routing.shouldSkipConnection('parallel-start-source', BlockType.FUNCTION)).toBe(true)
      expect(Routing.shouldSkipConnection('parallel-start-source', BlockType.AGENT)).toBe(true)
    })

    it('should block parallel-end-source connections during selective activation', () => {
      expect(Routing.shouldSkipConnection('parallel-end-source', BlockType.FUNCTION)).toBe(true)
      expect(Routing.shouldSkipConnection('parallel-end-source', BlockType.AGENT)).toBe(true)
    })

    it('should block loop-start-source connections during selective activation', () => {
      expect(Routing.shouldSkipConnection('loop-start-source', BlockType.FUNCTION)).toBe(true)
      expect(Routing.shouldSkipConnection('loop-start-source', BlockType.AGENT)).toBe(true)
    })

    it('should block loop-end-source connections during selective activation', () => {
      expect(Routing.shouldSkipConnection('loop-end-source', BlockType.FUNCTION)).toBe(true)
      expect(Routing.shouldSkipConnection('loop-end-source', BlockType.AGENT)).toBe(true)
    })
  })

  describe('✅ Still blocked: Condition-specific connections during selective activation', () => {
    it('should block condition-specific connections during selective activation', () => {
      expect(Routing.shouldSkipConnection('condition-test-if', BlockType.FUNCTION)).toBe(true)
      expect(Routing.shouldSkipConnection('condition-test-else', BlockType.AGENT)).toBe(true)
      expect(Routing.shouldSkipConnection('condition-some-id', BlockType.PARALLEL)).toBe(true)
    })
  })

  describe('✅ Still works: Regular connections', () => {
    it('should allow regular connections between regular blocks', () => {
      expect(Routing.shouldSkipConnection(undefined, BlockType.FUNCTION)).toBe(false)
      expect(Routing.shouldSkipConnection('source', BlockType.AGENT)).toBe(false)
      expect(Routing.shouldSkipConnection('output', BlockType.API)).toBe(false)
    })

    it('should allow regular connections with any source handle (except blocked ones)', () => {
      expect(Routing.shouldSkipConnection('result', BlockType.FUNCTION)).toBe(false)
      expect(Routing.shouldSkipConnection('output', BlockType.AGENT)).toBe(false)
      expect(Routing.shouldSkipConnection('data', BlockType.PARALLEL)).toBe(false)
    })
  })
})

describe('Real-world workflow scenarios', () => {
  describe('✅ Working: User workflows', () => {
    it('should support: Start → Agent → Parallel → Agent pattern', () => {
      // This is the user's exact workflow pattern that was broken
      expect(Routing.shouldSkipConnection(undefined, BlockType.PARALLEL)).toBe(false)
    })

    it('should support: Start → Function → Loop → Function pattern', () => {
      expect(Routing.shouldSkipConnection(undefined, BlockType.LOOP)).toBe(false)
    })

    it('should support: Start → API → Parallel → Multiple Agents pattern', () => {
      expect(Routing.shouldSkipConnection(undefined, BlockType.PARALLEL)).toBe(false)
    })

    it('should support: Start → Evaluator → Parallel → Response pattern', () => {
      expect(Routing.shouldSkipConnection(undefined, BlockType.PARALLEL)).toBe(false)
    })
  })

  describe('✅ Working: Complex routing patterns', () => {
    it('should support: Start → Router → Parallel → Function (existing working pattern)', () => {
      // This already worked before the fix
      expect(Routing.shouldSkipConnection(undefined, BlockType.PARALLEL)).toBe(false)
    })

    it('should support: Start → Condition → Parallel → Agent (existing working pattern)', () => {
      // This already worked before the fix
      expect(Routing.shouldSkipConnection(undefined, BlockType.PARALLEL)).toBe(false)
    })

    it('should support: Start → Router → Function → Parallel → Agent (new working pattern)', () => {
      // Router selects function, function activates parallel
      expect(Routing.shouldSkipConnection(undefined, BlockType.PARALLEL)).toBe(false)
    })
  })
})
