import { describe, expect, it } from 'vitest'
import { BlockType } from '@/executor/consts'
import { BlockCategory, Routing } from '@/executor/routing/routing'

describe('Routing', () => {
  describe('getCategory', () => {
    it.concurrent('should categorize flow control blocks correctly', () => {
      expect(Routing.getCategory(BlockType.PARALLEL)).toBe(BlockCategory.FLOW_CONTROL)
      expect(Routing.getCategory(BlockType.LOOP)).toBe(BlockCategory.FLOW_CONTROL)
    })

    it.concurrent('should categorize routing blocks correctly', () => {
      expect(Routing.getCategory(BlockType.ROUTER)).toBe(BlockCategory.ROUTING_BLOCK)
      expect(Routing.getCategory(BlockType.CONDITION)).toBe(BlockCategory.ROUTING_BLOCK)
    })

    it.concurrent('should categorize regular blocks correctly', () => {
      expect(Routing.getCategory(BlockType.FUNCTION)).toBe(BlockCategory.REGULAR_BLOCK)
      expect(Routing.getCategory(BlockType.AGENT)).toBe(BlockCategory.REGULAR_BLOCK)
      expect(Routing.getCategory(BlockType.API)).toBe(BlockCategory.REGULAR_BLOCK)
      expect(Routing.getCategory(BlockType.STARTER)).toBe(BlockCategory.REGULAR_BLOCK)
    })

    it.concurrent('should default to regular block for unknown types', () => {
      expect(Routing.getCategory('unknown')).toBe(BlockCategory.REGULAR_BLOCK)
      expect(Routing.getCategory('')).toBe(BlockCategory.REGULAR_BLOCK)
    })
  })

  describe('shouldActivateDownstream', () => {
    it.concurrent('should return true for routing blocks', () => {
      expect(Routing.shouldActivateDownstream(BlockType.ROUTER)).toBe(true)
      expect(Routing.shouldActivateDownstream(BlockType.CONDITION)).toBe(true)
    })

    it.concurrent('should return false for flow control blocks', () => {
      expect(Routing.shouldActivateDownstream(BlockType.PARALLEL)).toBe(false)
      expect(Routing.shouldActivateDownstream(BlockType.LOOP)).toBe(false)
    })

    it.concurrent('should return true for regular blocks', () => {
      expect(Routing.shouldActivateDownstream(BlockType.FUNCTION)).toBe(true)
      expect(Routing.shouldActivateDownstream(BlockType.AGENT)).toBe(true)
    })

    it.concurrent('should handle empty/undefined block types', () => {
      expect(Routing.shouldActivateDownstream('')).toBe(true)
      expect(Routing.shouldActivateDownstream(undefined as any)).toBe(true)
    })
  })

  describe('requiresActivePathCheck', () => {
    it.concurrent('should return true for flow control blocks', () => {
      expect(Routing.requiresActivePathCheck(BlockType.PARALLEL)).toBe(true)
      expect(Routing.requiresActivePathCheck(BlockType.LOOP)).toBe(true)
    })

    it.concurrent('should return false for routing blocks', () => {
      expect(Routing.requiresActivePathCheck(BlockType.ROUTER)).toBe(false)
      expect(Routing.requiresActivePathCheck(BlockType.CONDITION)).toBe(false)
    })

    it.concurrent('should return false for regular blocks', () => {
      expect(Routing.requiresActivePathCheck(BlockType.FUNCTION)).toBe(false)
      expect(Routing.requiresActivePathCheck(BlockType.AGENT)).toBe(false)
    })

    it.concurrent('should handle empty/undefined block types', () => {
      expect(Routing.requiresActivePathCheck('')).toBe(false)
      expect(Routing.requiresActivePathCheck(undefined as any)).toBe(false)
    })
  })

  describe('shouldSkipInSelectiveActivation', () => {
    it.concurrent('should return true for flow control blocks', () => {
      expect(Routing.shouldSkipInSelectiveActivation(BlockType.PARALLEL)).toBe(true)
      expect(Routing.shouldSkipInSelectiveActivation(BlockType.LOOP)).toBe(true)
    })

    it.concurrent('should return false for routing blocks', () => {
      expect(Routing.shouldSkipInSelectiveActivation(BlockType.ROUTER)).toBe(false)
      expect(Routing.shouldSkipInSelectiveActivation(BlockType.CONDITION)).toBe(false)
    })

    it.concurrent('should return false for regular blocks', () => {
      expect(Routing.shouldSkipInSelectiveActivation(BlockType.FUNCTION)).toBe(false)
      expect(Routing.shouldSkipInSelectiveActivation(BlockType.AGENT)).toBe(false)
    })
  })

  describe('shouldSkipConnection', () => {
    it.concurrent('should allow regular connections to flow control blocks', () => {
      expect(Routing.shouldSkipConnection(undefined, BlockType.PARALLEL)).toBe(false)
      expect(Routing.shouldSkipConnection('source', BlockType.LOOP)).toBe(false)
    })

    it.concurrent('should skip flow control specific connections', () => {
      expect(Routing.shouldSkipConnection('parallel-start-source', BlockType.FUNCTION)).toBe(true)
      expect(Routing.shouldSkipConnection('parallel-end-source', BlockType.AGENT)).toBe(true)
      expect(Routing.shouldSkipConnection('loop-start-source', BlockType.API)).toBe(true)
      expect(Routing.shouldSkipConnection('loop-end-source', BlockType.EVALUATOR)).toBe(true)
    })

    it.concurrent('should not skip regular connections to regular blocks', () => {
      expect(Routing.shouldSkipConnection('source', BlockType.FUNCTION)).toBe(false)
      expect(Routing.shouldSkipConnection('source', BlockType.AGENT)).toBe(false)
      expect(Routing.shouldSkipConnection(undefined, BlockType.API)).toBe(false)
    })

    it.concurrent('should skip condition-specific connections during selective activation', () => {
      expect(Routing.shouldSkipConnection('condition-test-if', BlockType.FUNCTION)).toBe(true)
      expect(Routing.shouldSkipConnection('condition-test-else', BlockType.AGENT)).toBe(true)
    })

    it.concurrent('should handle empty/undefined types', () => {
      expect(Routing.shouldSkipConnection('', '')).toBe(false)
      expect(Routing.shouldSkipConnection(undefined, '')).toBe(false)
    })
  })

  describe('getBehavior', () => {
    it.concurrent('should return correct behavior for each category', () => {
      const flowControlBehavior = Routing.getBehavior(BlockType.PARALLEL)
      expect(flowControlBehavior).toEqual({
        shouldActivateDownstream: false,
        requiresActivePathCheck: true,
        skipInSelectiveActivation: true,
      })

      const routingBehavior = Routing.getBehavior(BlockType.ROUTER)
      expect(routingBehavior).toEqual({
        shouldActivateDownstream: true,
        requiresActivePathCheck: false,
        skipInSelectiveActivation: false,
      })

      const regularBehavior = Routing.getBehavior(BlockType.FUNCTION)
      expect(regularBehavior).toEqual({
        shouldActivateDownstream: true,
        requiresActivePathCheck: false,
        skipInSelectiveActivation: false,
      })
    })
  })
})
