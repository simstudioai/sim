import { describe, expect, it } from 'vitest'
import { BlockCategory, RoutingStrategy } from './routing-strategy'

describe('RoutingStrategy', () => {
  describe('getCategory', () => {
    it.concurrent('should categorize flow control blocks correctly', () => {
      expect(RoutingStrategy.getCategory('parallel')).toBe(BlockCategory.FLOW_CONTROL)
      expect(RoutingStrategy.getCategory('loop')).toBe(BlockCategory.FLOW_CONTROL)
    })

    it.concurrent('should categorize routing blocks correctly', () => {
      expect(RoutingStrategy.getCategory('router')).toBe(BlockCategory.ROUTING_BLOCK)
      expect(RoutingStrategy.getCategory('condition')).toBe(BlockCategory.ROUTING_BLOCK)
    })

    it.concurrent('should categorize regular blocks correctly', () => {
      expect(RoutingStrategy.getCategory('function')).toBe(BlockCategory.REGULAR_BLOCK)
      expect(RoutingStrategy.getCategory('agent')).toBe(BlockCategory.REGULAR_BLOCK)
      expect(RoutingStrategy.getCategory('api')).toBe(BlockCategory.REGULAR_BLOCK)
      expect(RoutingStrategy.getCategory('starter')).toBe(BlockCategory.REGULAR_BLOCK)
    })

    it.concurrent('should default to regular block for unknown types', () => {
      expect(RoutingStrategy.getCategory('unknown')).toBe(BlockCategory.REGULAR_BLOCK)
      expect(RoutingStrategy.getCategory('')).toBe(BlockCategory.REGULAR_BLOCK)
    })
  })

  describe('shouldActivateDownstream', () => {
    it.concurrent('should return true for routing blocks', () => {
      expect(RoutingStrategy.shouldActivateDownstream('router')).toBe(true)
      expect(RoutingStrategy.shouldActivateDownstream('condition')).toBe(true)
    })

    it.concurrent('should return false for flow control blocks', () => {
      expect(RoutingStrategy.shouldActivateDownstream('parallel')).toBe(false)
      expect(RoutingStrategy.shouldActivateDownstream('loop')).toBe(false)
    })

    it.concurrent('should return true for regular blocks', () => {
      expect(RoutingStrategy.shouldActivateDownstream('function')).toBe(true)
      expect(RoutingStrategy.shouldActivateDownstream('agent')).toBe(true)
    })

    it.concurrent('should handle empty/undefined block types', () => {
      expect(RoutingStrategy.shouldActivateDownstream('')).toBe(true)
      expect(RoutingStrategy.shouldActivateDownstream(undefined as any)).toBe(true)
    })
  })

  describe('requiresActivePathCheck', () => {
    it.concurrent('should return true for flow control blocks', () => {
      expect(RoutingStrategy.requiresActivePathCheck('parallel')).toBe(true)
      expect(RoutingStrategy.requiresActivePathCheck('loop')).toBe(true)
    })

    it.concurrent('should return false for routing blocks', () => {
      expect(RoutingStrategy.requiresActivePathCheck('router')).toBe(false)
      expect(RoutingStrategy.requiresActivePathCheck('condition')).toBe(false)
    })

    it.concurrent('should return false for regular blocks', () => {
      expect(RoutingStrategy.requiresActivePathCheck('function')).toBe(false)
      expect(RoutingStrategy.requiresActivePathCheck('agent')).toBe(false)
    })

    it.concurrent('should handle empty/undefined block types', () => {
      expect(RoutingStrategy.requiresActivePathCheck('')).toBe(false)
      expect(RoutingStrategy.requiresActivePathCheck(undefined as any)).toBe(false)
    })
  })

  describe('shouldSkipInSelectiveActivation', () => {
    it.concurrent('should return true for flow control blocks', () => {
      expect(RoutingStrategy.shouldSkipInSelectiveActivation('parallel')).toBe(true)
      expect(RoutingStrategy.shouldSkipInSelectiveActivation('loop')).toBe(true)
    })

    it.concurrent('should return false for routing blocks', () => {
      expect(RoutingStrategy.shouldSkipInSelectiveActivation('router')).toBe(false)
      expect(RoutingStrategy.shouldSkipInSelectiveActivation('condition')).toBe(false)
    })

    it.concurrent('should return false for regular blocks', () => {
      expect(RoutingStrategy.shouldSkipInSelectiveActivation('function')).toBe(false)
      expect(RoutingStrategy.shouldSkipInSelectiveActivation('agent')).toBe(false)
    })
  })

  describe('shouldSkipConnection', () => {
    it.concurrent('should skip flow control blocks', () => {
      expect(RoutingStrategy.shouldSkipConnection(undefined, 'parallel')).toBe(true)
      expect(RoutingStrategy.shouldSkipConnection('source', 'loop')).toBe(true)
    })

    it.concurrent('should skip flow control specific connections', () => {
      expect(RoutingStrategy.shouldSkipConnection('parallel-start-source', 'function')).toBe(true)
      expect(RoutingStrategy.shouldSkipConnection('parallel-end-source', 'agent')).toBe(true)
      expect(RoutingStrategy.shouldSkipConnection('loop-start-source', 'api')).toBe(true)
      expect(RoutingStrategy.shouldSkipConnection('loop-end-source', 'evaluator')).toBe(true)
    })

    it.concurrent('should not skip regular connections to regular blocks', () => {
      expect(RoutingStrategy.shouldSkipConnection('source', 'function')).toBe(false)
      expect(RoutingStrategy.shouldSkipConnection('source', 'agent')).toBe(false)
      expect(RoutingStrategy.shouldSkipConnection(undefined, 'api')).toBe(false)
    })

    it.concurrent('should not skip routing connections', () => {
      expect(RoutingStrategy.shouldSkipConnection('condition-test-if', 'function')).toBe(false)
      expect(RoutingStrategy.shouldSkipConnection('condition-test-else', 'agent')).toBe(false)
    })

    it.concurrent('should handle empty/undefined types', () => {
      expect(RoutingStrategy.shouldSkipConnection('', '')).toBe(false)
      expect(RoutingStrategy.shouldSkipConnection(undefined, '')).toBe(false)
    })
  })

  describe('getBehavior', () => {
    it.concurrent('should return correct behavior for each category', () => {
      const flowControlBehavior = RoutingStrategy.getBehavior('parallel')
      expect(flowControlBehavior).toEqual({
        shouldActivateDownstream: false,
        requiresActivePathCheck: true,
        skipInSelectiveActivation: true,
      })

      const routingBehavior = RoutingStrategy.getBehavior('router')
      expect(routingBehavior).toEqual({
        shouldActivateDownstream: true,
        requiresActivePathCheck: false,
        skipInSelectiveActivation: false,
      })

      const regularBehavior = RoutingStrategy.getBehavior('function')
      expect(regularBehavior).toEqual({
        shouldActivateDownstream: true,
        requiresActivePathCheck: false,
        skipInSelectiveActivation: false,
      })
    })
  })
})
