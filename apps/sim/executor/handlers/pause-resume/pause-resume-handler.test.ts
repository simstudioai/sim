import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PauseResumeBlockHandler } from '@/executor/handlers/pause-resume/pause-resume-handler'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('PauseResumeBlockHandler', () => {
  let handler: PauseResumeBlockHandler

  beforeEach(() => {
    handler = new PauseResumeBlockHandler()
  })

  it('returns pause metadata with parallel and loop scope information', async () => {
    const executionContext: ExecutionContext = {
      workflowId: 'wf_1',
      blockStates: new Map(),
      executedBlocks: new Set(),
      blockLogs: [],
      metadata: {
        duration: 0,
        startTime: new Date().toISOString(),
      },
      environmentVariables: {},
      decisions: {
        router: new Map(),
        condition: new Map(),
      },
      loopIterations: new Map([['loop-1', 2]]),
      loopItems: new Map(),
      completedLoops: new Set(),
      activeExecutionPath: new Set(),
    }

    const block = {
      id: 'pause_block',
      metadata: { id: 'pause_resume' },
      config: { params: {} },
    } as any

    const inputs = {
      dataMode: 'json',
      data: '{"message": "ok"}',
      status: '202',
      headers: [
        {
          id: 'header-1',
          cells: { Key: 'X-Test', Value: 'value' },
        },
      ],
    }

    const nodeMetadata = {
      nodeId: 'pause_block',
      loopId: 'loop-1',
      parallelId: 'parallel-1',
      branchIndex: 1,
      branchTotal: 3,
    }

    const output = (await handler.executeWithNode(
      executionContext,
      block,
      inputs,
      nodeMetadata
    )) as NormalizedBlockOutput

    expect(output.response).toEqual({
      data: { message: 'ok' },
      status: 202,
      headers: {
        'Content-Type': 'application/json',
        'X-Test': 'value',
      },
    })

    expect(output._pauseMetadata).toBeDefined()
    expect(output._pauseMetadata?.contextId).toBe('pause_block₍1₎_loop2')
    expect(output._pauseMetadata?.triggerBlockId).toBe('pause_block__trigger')
    expect(output._pauseMetadata?.parallelScope).toEqual({
      parallelId: 'parallel-1',
      branchIndex: 1,
      branchTotal: 3,
    })
    expect(output._pauseMetadata?.loopScope).toEqual({
      loopId: 'loop-1',
      iteration: 2,
    })
    expect(output._pauseMetadata?.timestamp).toBeTypeOf('string')
  })
})

