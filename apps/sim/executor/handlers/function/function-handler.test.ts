import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { createTimeoutAbortController } from '@/lib/core/execution-limits'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'
import { NonRetryableExecutionError } from '@/lib/execution/non-retryable-error'
import { BlockType } from '@/executor/constants'
import { FunctionBlockHandler } from '@/executor/handlers/function/function-handler'
import type { ExecutionContext } from '@/executor/types'
import { readTrustedExecutionCost } from '@/executor/utils/errors'
import {
  FUNCTION_BLOCK_CONTEXT_VARS_KEY,
  FUNCTION_BLOCK_DISPLAY_CODE_KEY,
} from '@/executor/variables/resolver'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'

vi.mock('@/tools', () => ({
  executeTool: vi.fn(),
}))

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

    // Reset mocks using vi
    vi.clearAllMocks()

    // Default mock implementation for executeTool
    mockExecuteTool.mockResolvedValue({ success: true, output: { result: 'Success' } })
  })

  it('should handle function blocks', () => {
    expect(handler.canHandle(mockBlock)).toBe(true)
    const nonFuncBlock: SerializedBlock = { ...mockBlock, metadata: { id: 'other' } }
    expect(handler.canHandle(nonFuncBlock)).toBe(false)
  })

  it('should execute function block with string code', async () => {
    const inputs = {
      code: 'console.log("Hello"); return 1 + 1;',
      timeout: 10000,
      envVars: {},
      isCustomTool: false,
      workflowId: undefined,
    }
    const expectedToolParams = {
      code: inputs.code,
      language: 'javascript',
      timeout: inputs.timeout,
      envVars: {},
      workflowVariables: {},
      blockData: {},
      blockNameMapping: {},
      blockOutputSchemas: {},
      contextVariables: {},
      _context: {
        workflowId: mockContext.workflowId,
        workspaceId: mockContext.workspaceId,
        executionId: mockContext.executionId,
        userId: mockContext.userId,
        isDeployedContext: mockContext.isDeployedContext,
        enforceCredentialAccess: mockContext.enforceCredentialAccess,
      },
    }
    const expectedOutput: any = { result: 'Success' }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(mockExecuteTool).toHaveBeenCalledWith('function_execute', expectedToolParams, {
      executionContext: mockContext,
    })
    expect(result).toEqual(expectedOutput)
  })

  it('should execute function block with array code', async () => {
    const inputs = {
      code: [{ content: 'const x = 5;' }, { content: 'return x * 2;' }],
      timeout: 5000,
      envVars: {},
      isCustomTool: false,
      workflowId: undefined,
    }
    const expectedCode = 'const x = 5;\nreturn x * 2;'
    const expectedToolParams = {
      code: expectedCode,
      language: 'javascript',
      timeout: inputs.timeout,
      envVars: {},
      workflowVariables: {},
      blockData: {},
      blockNameMapping: {},
      blockOutputSchemas: {},
      contextVariables: {},
      _context: {
        workflowId: mockContext.workflowId,
        workspaceId: mockContext.workspaceId,
        executionId: mockContext.executionId,
        userId: mockContext.userId,
        isDeployedContext: mockContext.isDeployedContext,
        enforceCredentialAccess: mockContext.enforceCredentialAccess,
      },
    }
    const expectedOutput: any = { result: 'Success' }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(mockExecuteTool).toHaveBeenCalledWith('function_execute', expectedToolParams, {
      executionContext: mockContext,
    })
    expect(result).toEqual(expectedOutput)
  })

  it('should use default timeout if not provided', async () => {
    const inputs = { code: 'return true;' }
    const expectedToolParams = {
      code: inputs.code,
      language: 'javascript',
      timeout: DEFAULT_EXECUTION_TIMEOUT_MS,
      envVars: {},
      workflowVariables: {},
      blockData: {},
      blockNameMapping: {},
      blockOutputSchemas: {},
      contextVariables: {},
      _context: {
        workflowId: mockContext.workflowId,
        workspaceId: mockContext.workspaceId,
        executionId: mockContext.executionId,
        userId: mockContext.userId,
        isDeployedContext: mockContext.isDeployedContext,
        enforceCredentialAccess: mockContext.enforceCredentialAccess,
      },
    }

    await handler.execute(mockContext, mockBlock, inputs)

    expect(mockExecuteTool).toHaveBeenCalledWith('function_execute', expectedToolParams, {
      executionContext: mockContext,
    })
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

  it('uses the remaining workflow budget when no block timeout is configured', async () => {
    const controller = createTimeoutAbortController(DEFAULT_EXECUTION_TIMEOUT_MS * 2)
    mockContext.abortSignal = controller.signal

    try {
      await handler.execute(mockContext, mockBlock, {
        code: 'return true;',
      })

      const timeout = mockExecuteTool.mock.calls[0][1].timeout
      expect(timeout).toBeGreaterThan(DEFAULT_EXECUTION_TIMEOUT_MS)
      expect(timeout).toBeLessThanOrEqual(DEFAULT_EXECUTION_TIMEOUT_MS * 2)
    } finally {
      controller.cleanup()
    }
  })

  it('forwards an explicit selected secret scope without changing legacy unset blocks', async () => {
    await handler.execute(mockContext, mockBlock, {
      code: 'return {{API_KEY}}',
      secretScope: 'selected',
      mountedSecrets: [' API_KEY ', 42, 'SECOND_KEY', '', 'API_KEY'],
    })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({
        secretScope: 'selected',
        mountedSecrets: ['API_KEY', 'SECOND_KEY'],
      }),
      { executionContext: mockContext }
    )

    vi.clearAllMocks()
    mockExecuteTool.mockResolvedValue({ success: true, output: { result: 'Success' } })

    await handler.execute(mockContext, mockBlock, { code: 'return {{API_KEY}}' })

    const legacyParams = mockExecuteTool.mock.calls[0][1]
    expect(legacyParams).not.toHaveProperty('secretScope')
    expect(legacyParams).not.toHaveProperty('mountedSecrets')
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

  it('should handle execution errors from the tool', async () => {
    const inputs = { code: 'throw new Error("Code failed");' }
    const errorResult = { success: false, error: 'Function execution failed: Code failed' }
    mockExecuteTool.mockResolvedValue(errorResult)

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Function execution failed: Code failed'
    )
    expect(mockExecuteTool).toHaveBeenCalled()
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

  it('attaches trusted cost to a successful execution for retry aggregation', async () => {
    const cost = { input: 0, output: 0, total: 0.25 }
    mockExecuteTool.mockResolvedValue({
      success: true,
      output: { result: 42, stdout: '', cost },
    })

    const output = await handler.execute(mockContext, mockBlock, { code: 'return 42' })

    expect(readTrustedExecutionCost(output)).toEqual(cost)
  })

  it('should pass runtime context variables to function_execute', async () => {
    const contextVariables = { __blockRef_0: { result: 'from-block' } }

    await handler.execute(mockContext, mockBlock, {
      code: 'return globalThis["__blockRef_0"]',
      [FUNCTION_BLOCK_CONTEXT_VARS_KEY]: contextVariables,
    })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({
        contextVariables,
      }),
      { executionContext: mockContext }
    )
  })

  it('should pass display-resolved function code for error display', async () => {
    mockBlock.config.params = { code: 'retur <start.reqerror>' }

    await handler.execute(mockContext, mockBlock, {
      code: 'retur globalThis["__blockRef_0"]',
      [FUNCTION_BLOCK_DISPLAY_CODE_KEY]: 'retur "value"',
      [FUNCTION_BLOCK_CONTEXT_VARS_KEY]: { __blockRef_0: 'value' },
    })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({
        code: 'retur globalThis["__blockRef_0"]',
        sourceCode: 'retur "value"',
      }),
      { executionContext: mockContext }
    )
  })

  it('should normalize malformed execution context records before calling function_execute', async () => {
    const legacyVariable = { id: 'var-1', name: 'brand', type: 'plain', value: 'myfitness' }
    mockContext.workflowVariables = [legacyVariable] as unknown as Record<string, any>
    mockContext.environmentVariables = ['invalid-env'] as unknown as Record<string, string>

    await handler.execute(mockContext, mockBlock, {
      code: 'return "myfitness"',
      [FUNCTION_BLOCK_CONTEXT_VARS_KEY]: ['invalid-context'],
    })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({
        envVars: {},
        workflowVariables: { 'var-1': legacyVariable },
        contextVariables: {},
      }),
      { executionContext: mockContext }
    )
  })

  it('should handle tool error with no specific message', async () => {
    const inputs = { code: 'some code' }
    const errorResult = { success: false }
    mockExecuteTool.mockResolvedValue(errorResult)

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Function execution failed'
    )
  })
})
