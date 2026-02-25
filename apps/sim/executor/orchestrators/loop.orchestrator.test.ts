import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import { LoopOrchestrator } from '@/executor/orchestrators/loop'

vi.mock('@sim/logger', () => loggerMock)

describe('LoopOrchestrator retention', () => {
  it('retains only the tail of allIterationOutputs and tracks dropped count', async () => {
    const state = { setBlockOutput: vi.fn() } as any
    const orchestrator = new LoopOrchestrator({} as any, state, {} as any)

    vi.spyOn(orchestrator as any, 'evaluateCondition').mockResolvedValue(true)

    const scope: any = {
      iteration: 0,
      currentIterationOutputs: new Map(),
      allIterationOutputs: [],
      allIterationOutputsDroppedCount: 0,
      allIterationOutputsLimit: 3,
    }

    const ctx: any = {
      loopExecutions: new Map([['loop-1', scope]]),
      metadata: { duration: 0 },
    }

    for (let i = 0; i < 5; i++) {
      scope.currentIterationOutputs.set('block', { i })
      const result = await orchestrator.evaluateLoopContinuation(ctx, 'loop-1')
      expect(result.shouldContinue).toBe(true)
    }

    expect(scope.allIterationOutputs).toHaveLength(3)
    expect(scope.allIterationOutputsDroppedCount).toBe(2)
    expect(scope.allIterationOutputs[0][0]).toEqual({ i: 2 })
    expect(scope.allIterationOutputs[2][0]).toEqual({ i: 4 })
  })

  it('includes truncation metadata in exit output', () => {
    const state = { setBlockOutput: vi.fn() } as any
    const orchestrator = new LoopOrchestrator({} as any, state, {} as any)

    const scope: any = {
      iteration: 0,
      currentIterationOutputs: new Map(),
      allIterationOutputs: [[{ a: 1 }]],
      allIterationOutputsDroppedCount: 5,
      allIterationOutputsLimit: 1,
    }

    const ctx: any = {
      metadata: { duration: 0 },
    }

    const result = (orchestrator as any).createExitResult(ctx, 'loop-1', scope)

    expect(result.resultsTruncated).toBe(true)
    expect(result.totalIterations).toBe(6)
    expect(result.droppedIterations).toBe(5)
    expect(result.retainedIterations).toBe(1)
    expect(result.retentionLimit).toBe(1)

    expect(state.setBlockOutput).toHaveBeenCalledWith(
      'loop-1',
      expect.objectContaining({
        results: scope.allIterationOutputs,
        resultsTruncated: true,
        totalIterations: 6,
        droppedIterations: 5,
        retainedIterations: 1,
        retentionLimit: 1,
      }),
      expect.any(Number)
    )
  })
})
