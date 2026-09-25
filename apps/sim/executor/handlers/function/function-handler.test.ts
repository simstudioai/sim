import { toolsMock } from '@sim/testing/mocks/tools.mock'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { createTimeoutAbortController } from '@/lib/core/execution-limits'
import { NonRetryableExecutionError } from '@/lib/execution/non-retryable-error'
import { BlockType } from '@/executor/constants'
import { FunctionBlockHandler } from '@/executor/handlers/function/function-handler'
import type { ExecutionContext } from '@/executor/types'
import { readTrustedExecutionCost } from '@/executor/utils/errors'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'

vi.mock('@/tools', () => toolsMock)

const mockExecuteTool = executeTool as Mock

describe('FunctionBlockHandler', () => {
  let handler: FunctionBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext

  beforeEach(() => {
    handler = new FunctionBlockHandler()

    mockBlock = {
      id: 'func-block-1',
      metadata: { id: BlockType.FUNCTION, name: 'Test Function' },
      position: { x: 30, y: 30 },
      config: { tool: BlockType.FUNCTION, params: {} },
      inputs: { code: 'string', timeout: 'number' }, // Using ParamType strings
      outputs: {},
      enabled: true,
    }

    mockContext = {
      workflowId: 'test-workflow-id',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      completedLoops: new Set(),
    }

    // Default mock implementation for executeTool
    mockExecuteTool.mockResolvedValue({ success: true, output: { result: 'Success' } })
  })

  it('caps the block timeout to the remaining workflow execution budget', async () => {
    const controller = createTimeoutAbortController(20_000)
    mockContext.abortSignal = controller.signal

    try {
      await handler.execute(mockContext, mockBlock, {
        code: 'return true;',
        timeout: 60_000,
      })

      const toolParams = mockExecuteTool.mock.calls[0][1]
      expect(toolParams.timeout).toBeGreaterThan(0)
      expect(toolParams.timeout).toBeLessThanOrEqual(20_000)
    } finally {
      controller.cleanup()
    }
  })

  it('fails closed for an invalid explicit secret scope', async () => {
    await handler.execute(mockContext, mockBlock, {
      code: 'return {{API_KEY}}',
      secretScope: 'invalid',
      mountedSecrets: ['API_KEY'],
    })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({
        secretScope: 'selected',
        mountedSecrets: [],
      }),
      { executionContext: mockContext }
    )
  })

  it.each([
    { retryable: true, nonRetryable: false },
    { retryable: false, nonRetryable: true },
  ])(
    'attaches trusted cost to a failed execution when retryable is $retryable',
    async ({ retryable, nonRetryable }) => {
      const cost = { input: 0, output: 0, total: 0.125 }
      mockExecuteTool.mockResolvedValue({
        success: false,
        error: 'Remote Function failed',
        retryable,
        output: { result: null, stdout: '', cost },
      })

      let thrown: unknown
      try {
        await handler.execute(mockContext, mockBlock, { code: 'throw new Error("failed")' })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(Error)
      expect(thrown instanceof NonRetryableExecutionError).toBe(nonRetryable)
      expect(readTrustedExecutionCost(thrown)).toEqual(cost)
    }
  )
})
