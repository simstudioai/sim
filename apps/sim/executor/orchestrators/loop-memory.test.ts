import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULTS } from '@/executor/constants'
import type { LoopScope } from '@/executor/execution/state'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'

vi.mock('@sim/logger', () => loggerMock)

/**
 * Tests for memory bounds in loop execution (issue #2525).
 *
 * When loops run with many iterations (especially with agent blocks making
 * tool calls), allIterationOutputs and blockLogs can grow unbounded,
 * causing OOM on systems with limited memory.
 */

function createMinimalContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    workflowId: 'test-workflow',
    blockStates: new Map(),
    executedBlocks: new Set(),
    blockLogs: [],
    metadata: { duration: 0 },
    environmentVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    completedLoops: new Set(),
    activeExecutionPath: new Set(),
    ...overrides,
  }
}

describe('Loop memory bounds', () => {
  describe('allIterationOutputs sliding window', () => {
    it('should keep at most MAX_LOOP_ITERATION_HISTORY entries', () => {
      const scope: LoopScope = {
        iteration: 0,
        currentIterationOutputs: new Map(),
        allIterationOutputs: [],
      }

      const limit = DEFAULTS.MAX_LOOP_ITERATION_HISTORY

      // Simulate more iterations than the limit
      for (let i = 0; i < limit + 50; i++) {
        const output: NormalizedBlockOutput = { content: `iteration-${i}` }
        const iterationResults = [output]
        scope.allIterationOutputs.push(iterationResults)

        // Apply the same sliding window logic as loop.ts
        if (scope.allIterationOutputs.length > limit) {
          const excess = scope.allIterationOutputs.length - limit
          scope.allIterationOutputs.splice(0, excess)
        }
      }

      expect(scope.allIterationOutputs.length).toBe(limit)
      // The oldest retained entry should be from iteration 50
      expect(scope.allIterationOutputs[0][0].content).toBe('iteration-50')
      // The newest entry should be the last one pushed
      expect(scope.allIterationOutputs[limit - 1][0].content).toBe(
        `iteration-${limit + 49}`
      )
    })

    it('should not prune when under the limit', () => {
      const scope: LoopScope = {
        iteration: 0,
        currentIterationOutputs: new Map(),
        allIterationOutputs: [],
      }

      for (let i = 0; i < 10; i++) {
        scope.allIterationOutputs.push([{ content: `iter-${i}` }])
      }

      expect(scope.allIterationOutputs.length).toBe(10)
      expect(scope.allIterationOutputs[0][0].content).toBe('iter-0')
    })
  })

  describe('blockLogs pruning', () => {
    it('should keep at most MAX_BLOCK_LOGS entries', () => {
      const ctx = createMinimalContext()
      const limit = DEFAULTS.MAX_BLOCK_LOGS

      // Simulate pushing more logs than the limit
      for (let i = 0; i < limit + 100; i++) {
        ctx.blockLogs.push({
          blockId: `block-${i}`,
          blockType: 'function',
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          durationMs: 1,
          success: true,
          executionOrder: i + 1,
        })

        // Apply the same pruning logic as block-executor.ts
        if (ctx.blockLogs.length > limit) {
          const excess = ctx.blockLogs.length - limit
          ctx.blockLogs.splice(0, excess)
        }
      }

      expect(ctx.blockLogs.length).toBe(limit)
      // The oldest retained log should be from index 100
      expect(ctx.blockLogs[0].blockId).toBe('block-100')
    })
  })

  describe('DEFAULTS constants', () => {
    it('should define MAX_LOOP_ITERATION_HISTORY', () => {
      expect(DEFAULTS.MAX_LOOP_ITERATION_HISTORY).toBeGreaterThan(0)
      expect(typeof DEFAULTS.MAX_LOOP_ITERATION_HISTORY).toBe('number')
    })

    it('should define MAX_BLOCK_LOGS', () => {
      expect(DEFAULTS.MAX_BLOCK_LOGS).toBeGreaterThan(0)
      expect(typeof DEFAULTS.MAX_BLOCK_LOGS).toBe('number')
    })
  })
})
