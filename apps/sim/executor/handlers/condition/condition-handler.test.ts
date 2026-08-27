/**
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NonRetryableExecutionError } from '@/lib/execution/non-retryable-error'
import { BlockType } from '@/executor/constants'
import { ConditionBlockHandler } from '@/executor/handlers/condition/condition-handler'
import type { BlockState, ExecutionContext } from '@/executor/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

vi.mock('@/tools', () => ({
  executeTool: vi.fn(),
}))

vi.mock('@/executor/utils/block-data', () => ({
  collectBlockData: vi.fn(() => ({
    blockData: { 'source-block-1': { value: 10, text: 'hello' } },
    blockNameMapping: { sourceblock: 'source-block-1' },
  })),
}))

import { collectBlockData } from '@/executor/utils/block-data'
import { executeTool } from '@/tools'

const mockExecuteTool = executeTool as ReturnType<typeof vi.fn>
const mockCollectBlockData = collectBlockData as ReturnType<typeof vi.fn>

/** The handler evaluates every testable branch in one call, so a whole condition list resolves to a single verdict. */
const matchedAt = (index: number) => ({
  success: true,
  output: { result: { matchedIndex: index } },
})
const noMatch = () => ({ success: true, output: { result: { matchedIndex: -1 } } })
const threwAt = (index: number, message: string) => ({
  success: true,
  output: { result: { matchedIndex: -1, threwAtIndex: index, message } },
})
const mockConditionLogger = vi.mocked(loggerMock.createLogger).mock.results[
  vi
    .mocked(loggerMock.createLogger)
    .mock.calls.findIndex(([name]) => name === 'ConditionBlockHandler')
].value

describe('ConditionBlockHandler', () => {
  let handler: ConditionBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let mockWorkflow: Partial<SerializedWorkflow>
  let mockSourceBlock: SerializedBlock
  let mockTargetBlock1: SerializedBlock
  let mockTargetBlock2: SerializedBlock

  beforeEach(() => {
    mockSourceBlock = {
      id: 'source-block-1',
      metadata: { id: 'source', name: 'Source Block' },
      position: { x: 10, y: 10 },
      config: { tool: 'source_tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockBlock = {
      id: 'cond-block-1',
      metadata: { id: BlockType.CONDITION, name: 'Test Condition' },
      position: { x: 50, y: 50 },
      config: { tool: BlockType.CONDITION, params: {} },
      inputs: { conditions: 'json' },
      outputs: {},
      enabled: true,
    }
    mockTargetBlock1 = {
      id: 'target-block-1',
      metadata: { id: 'target', name: 'Target Block 1' },
      position: { x: 100, y: 100 },
      config: { tool: 'target_tool_1', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockTargetBlock2 = {
      id: 'target-block-2',
      metadata: { id: 'target', name: 'Target Block 2' },
      position: { x: 100, y: 150 },
      config: { tool: 'target_tool_2', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    }

    mockWorkflow = {
      blocks: [mockSourceBlock, mockBlock, mockTargetBlock1, mockTargetBlock2],
      connections: [
        { source: mockSourceBlock.id, target: mockBlock.id },
        {
          source: mockBlock.id,
          target: mockTargetBlock1.id,
          sourceHandle: 'condition-cond1',
        },
        {
          source: mockBlock.id,
          target: mockTargetBlock2.id,
          sourceHandle: 'condition-else1',
        },
      ],
    }

    handler = new ConditionBlockHandler()

    mockContext = {
      workflowId: 'test-workflow-id',
      workspaceId: 'test-workspace-id',
      blockStates: new Map<string, BlockState>([
        [
          mockSourceBlock.id,
          {
            output: { value: 10, text: 'hello' },
            executed: true,
            executionTime: 100,
          },
        ],
      ]),
      blockLogs: [],
      metadata: { duration: 0 },
      environmentVariables: { API_KEY: 'test-key' },
      workflowVariables: { userName: { name: 'userName', value: 'john', type: 'plain' } },
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      executedBlocks: new Set([mockSourceBlock.id]),
      activeExecutionPath: new Set(),
      workflow: mockWorkflow as SerializedWorkflow,
      completedLoops: new Set(),
    }

    vi.clearAllMocks()

    // Default: no branch matches (else path). Individual tests override with mockResolvedValueOnce.
    mockExecuteTool.mockResolvedValue(noMatch())
  })

  it('should handle condition blocks', () => {
    expect(handler.canHandle(mockBlock)).toBe(true)
    const nonCondBlock: SerializedBlock = { ...mockBlock, metadata: { id: 'other' } }
    expect(handler.canHandle(nonCondBlock)).toBe(false)
  })

  it('should execute condition block correctly and select first path', async () => {
    // Mock executeTool to return true for the condition
    mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

    const conditions = [
      { id: 'cond1', title: 'if', value: 'context.value > 5' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    const expectedOutput = {
      value: 10,
      text: 'hello',
      conditionResult: true,
      selectedPath: {
        blockId: mockTargetBlock1.id,
        blockType: 'target',
        blockTitle: 'Target Block 1',
      },
      selectedOption: 'cond1',
    }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(result).toEqual(expectedOutput)
    expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('cond1')
  })

  it('should pass correct parameters to function_execute tool', async () => {
    mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

    const conditions = [
      { id: 'cond1', title: 'if', value: 'context.value > 5' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    await handler.execute(mockContext, mockBlock, inputs)

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({
        code: expect.stringContaining('context.value > 5'),
        timeout: 5000,
        envVars: mockContext.environmentVariables,
        workflowVariables: mockContext.workflowVariables,
        blockData: {},
        blockNameMapping: { sourceblock: 'source-block-1' },
        _context: {
          workflowId: 'test-workflow-id',
          workspaceId: 'test-workspace-id',
        },
      }),
      { executionContext: mockContext }
    )
  })

  it('should never forward collected block outputs in the request body', async () => {
    mockCollectBlockData.mockReturnValueOnce({
      blockData: { 'huge-block': { payload: 'x'.repeat(1024) } },
      blockNameMapping: { hugeblock: 'huge-block' },
    })
    mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

    const conditions = [
      { id: 'cond1', title: 'if', value: 'true' },
      { id: 'else1', title: 'else', value: '' },
    ]

    await handler.execute(mockContext, mockBlock, { conditions: JSON.stringify(conditions) })

    const [, toolParams] = mockExecuteTool.mock.calls[0]
    expect(toolParams.blockData).toEqual({})
  })

  it('should select the else path if other conditions fail', async () => {
    mockExecuteTool.mockResolvedValueOnce(noMatch())

    const conditions = [
      { id: 'cond1', title: 'if', value: 'context.value < 0' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    const expectedOutput = {
      value: 10,
      text: 'hello',
      conditionResult: true,
      selectedPath: {
        blockId: mockTargetBlock2.id,
        blockType: 'target',
        blockTitle: 'Target Block 2',
      },
      selectedOption: 'else1',
    }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(result).toEqual(expectedOutput)
    expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('else1')
  })

  it('recognizes legacy-capitalized else branches without evaluating them', async () => {
    const conditions = [{ id: 'else1', title: 'Else', value: '' }]
    const inputs = { conditions: JSON.stringify(conditions) }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(mockExecuteTool).not.toHaveBeenCalled()
    expect((result as any).selectedOption).toBe('else1')
    expect((result as any).selectedPath?.blockId).toBe(mockTargetBlock2.id)
  })

  it('finds whitespace and mixed-case else branches during fallback', async () => {
    mockExecuteTool.mockResolvedValueOnce(noMatch())

    const conditions = [
      { id: 'cond1', title: 'if', value: 'false' },
      { id: 'else1', title: ' \t eLsE \n', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }
    mockContext.workflow!.connections = [
      { source: mockSourceBlock.id, target: mockBlock.id },
      {
        source: mockBlock.id,
        target: mockTargetBlock1.id,
        sourceHandle: 'condition-cond1',
      },
    ]

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(mockExecuteTool).toHaveBeenCalledOnce()
    expect((result as any).selectedOption).toBe('else1')
    expect((result as any).selectedPath).toBeNull()
  })

  it('should handle invalid conditions JSON format', async () => {
    const secret = 'condition-parse-secret-value'
    const inputs = { conditions: `{ "invalid json ${secret}` }

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      /^Invalid conditions format:/
    )
    expect(JSON.stringify(mockConditionLogger.error.mock.calls)).not.toContain(secret)
  })

  it('should handle evaluation errors gracefully', async () => {
    const secret = 'condition-runtime-secret-value'
    mockExecuteTool.mockResolvedValue({
      success: false,
      error: `Cannot read ${secret} through __var_API_KEY`,
    })

    const conditions = [
      { id: 'cond1', title: 'if', value: 'context.nonExistentProperty.doSomething()' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      /Evaluation error in condition "if"/
    )
    expect(JSON.stringify(mockConditionLogger.error.mock.calls)).not.toContain(secret)
    expect(JSON.stringify(mockConditionLogger.error.mock.calls)).not.toContain('__var_API_KEY')
  })

  it('names the branch an expression threw on without leaking the failure into logs', async () => {
    const secret = 'condition-throw-secret-value'
    mockExecuteTool.mockResolvedValueOnce(threwAt(1, `Cannot read ${secret}`))

    const conditions = [
      { id: 'cond1', title: 'if', value: 'context.value > 5' },
      { id: 'cond2', title: 'else if', value: 'context.missing.deep()' },
      { id: 'else1', title: 'else', value: '' },
    ]

    await expect(
      handler.execute(mockContext, mockBlock, { conditions: JSON.stringify(conditions) })
    ).rejects.toThrow(/Evaluation error in condition "else if": Cannot read/)
    expect(mockExecuteTool).toHaveBeenCalledOnce()
    expect(JSON.stringify(mockConditionLogger.error.mock.calls)).not.toContain(secret)
  })

  it('should handle missing source block output gracefully', async () => {
    mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

    const conditions = [{ id: 'cond1', title: 'if', value: 'true' }]
    const inputs = { conditions: JSON.stringify(conditions) }

    const contextWithoutSource = {
      ...mockContext,
      blockStates: new Map<string, BlockState>(),
    }

    const result = await handler.execute(contextWithoutSource, mockBlock, inputs)

    expect(result).toHaveProperty('conditionResult', true)
    expect(result).toHaveProperty('selectedOption', 'cond1')
  })

  it('should throw error if target block is missing', async () => {
    mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

    const conditions = [{ id: 'cond1', title: 'if', value: 'true' }]
    const inputs = { conditions: JSON.stringify(conditions) }

    mockContext.workflow!.blocks = [mockSourceBlock, mockBlock, mockTargetBlock2]

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      `Target block ${mockTargetBlock1.id} not found`
    )
  })

  it('should return no-match result if no condition matches and no else exists', async () => {
    mockExecuteTool.mockResolvedValueOnce(noMatch())

    const conditions = [
      { id: 'cond1', title: 'if', value: 'false' },
      { id: 'cond2', title: 'else if', value: 'context.value === 99' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    mockContext.workflow!.connections = [
      { source: mockSourceBlock.id, target: mockBlock.id },
      {
        source: mockBlock.id,
        target: mockTargetBlock1.id,
        sourceHandle: 'condition-cond1',
      },
    ]

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect((result as any).conditionResult).toBe(false)
    expect((result as any).selectedPath).toBeNull()
    expect((result as any).selectedOption).toBeNull()
    expect(mockContext.decisions.condition.has(mockBlock.id)).toBe(false)
  })

  it('falls back to else path when loop context data is unavailable', async () => {
    mockExecuteTool.mockResolvedValueOnce(noMatch())

    const conditions = [
      { id: 'cond1', title: 'if', value: 'context.item === "apple"' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('else1')
    expect((result as any).selectedOption).toBe('else1')
  })

  it('should use collectBlockData to gather block state', async () => {
    mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

    const conditions = [
      { id: 'cond1', title: 'if', value: 'true' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    await handler.execute(mockContext, mockBlock, inputs)

    expect(mockCollectBlockData).toHaveBeenCalledWith(mockContext, mockBlock.id)
  })

  it('should handle function_execute tool failure', async () => {
    mockExecuteTool.mockResolvedValueOnce({
      success: false,
      error: 'Execution timeout',
    })

    const conditions = [
      { id: 'cond1', title: 'if', value: 'context.value > 5' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      /Evaluation error in condition "if".*Execution timeout/
    )
  })

  describe('Batched evaluation', () => {
    const manyConditions = [
      { id: 'cond1', title: 'if', value: 'context.value === 1' },
      { id: 'cond2', title: 'else if', value: 'context.value === 2' },
      { id: 'cond3', title: 'else if', value: 'context.value === 3' },
      { id: 'cond4', title: 'else if', value: 'context.value === 4' },
      { id: 'else1', title: 'else', value: '' },
    ]

    it('evaluates every testable branch in a single call', async () => {
      mockExecuteTool.mockResolvedValueOnce(noMatch())

      await handler.execute(mockContext, mockBlock, {
        conditions: JSON.stringify(manyConditions),
      })

      expect(mockExecuteTool).toHaveBeenCalledOnce()
    })

    it('tests the expressions in declaration order and stops at the first truthy one', async () => {
      mockExecuteTool.mockResolvedValueOnce(noMatch())

      await handler.execute(mockContext, mockBlock, {
        conditions: JSON.stringify(manyConditions),
      })

      const [, toolParams] = mockExecuteTool.mock.calls[0]
      const code = toolParams.code as string
      const positions = manyConditions.slice(0, 4).map((condition) => code.indexOf(condition.value))

      expect(positions.every((position) => position >= 0)).toBe(true)
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
      // The else branch carries no expression and must never reach the sandbox.
      expect(code).toContain('return { matchedIndex: -1 }')
    })

    it('never sends the else branch for evaluation', async () => {
      mockExecuteTool.mockResolvedValueOnce(noMatch())

      await handler.execute(mockContext, mockBlock, {
        conditions: JSON.stringify([
          { id: 'cond1', title: 'if', value: 'context.value === 1' },
          { id: 'else1', title: 'else', value: 'SHOULD_NEVER_BE_EVALUATED' },
          { id: 'cond2', title: 'else if', value: 'context.value === 2' },
        ]),
      })

      const [, toolParams] = mockExecuteTool.mock.calls[0]
      expect(toolParams.code).not.toContain('SHOULD_NEVER_BE_EVALUATED')
      expect(toolParams.code).not.toContain('context.value === 2')
    })

    it('re-evaluates one branch at a time when the batch returns no verdict', async () => {
      // A syntax error anywhere fails the whole script at parse time, so the
      // fallback must still take the branch an earlier condition matches.
      mockExecuteTool.mockResolvedValueOnce({
        success: false,
        error: 'SyntaxError: Unexpected identifier',
      })
      mockExecuteTool.mockResolvedValueOnce({ success: true, output: { result: true } })

      const result = await handler.execute(mockContext, mockBlock, {
        conditions: JSON.stringify(manyConditions),
      })

      expect((result as any).selectedOption).toBe('cond1')
      expect(mockExecuteTool).toHaveBeenCalledTimes(2)
    })

    it('emits a batch script a trailing line comment cannot break', async () => {
      mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

      await handler.execute(mockContext, mockBlock, {
        conditions: JSON.stringify([
          { id: 'cond1', title: 'if', value: 'context.value > 5 // gate' },
          { id: 'else1', title: 'else', value: '' },
        ]),
      })

      const [, toolParams] = mockExecuteTool.mock.calls[0]
      // Compiling is the assertion: a comment that swallowed the closing
      // parenthesis would fail the whole script at parse time.
      expect(() => new Function(toolParams.code as string)).not.toThrow()
    })

    it('wraps a comment-bearing expression the same way when falling back', async () => {
      // The fallback recovers a batch the sandbox could not parse, so it has to
      // accept every expression the batch accepts — otherwise the recovery path
      // rejects a branch the primary path would have matched.
      mockExecuteTool.mockResolvedValueOnce({
        success: false,
        error: 'Invalid JavaScript syntax: Unexpected token',
      })
      mockExecuteTool.mockResolvedValueOnce({ success: true, output: { result: true } })

      const result = await handler.execute(mockContext, mockBlock, {
        conditions: JSON.stringify([
          { id: 'cond1', title: 'if', value: 'context.value > 5 // gate' },
          { id: 'cond2', title: 'else if', value: 'context.value ===' },
          { id: 'else1', title: 'else', value: '' },
        ]),
      })

      expect((result as any).selectedOption).toBe('cond1')
      const [, fallbackParams] = mockExecuteTool.mock.calls[1]
      expect(() => new Function(fallbackParams.code as string)).not.toThrow()
    })

    it('does not fan a timed-out batch out into one call per branch', async () => {
      mockExecuteTool.mockResolvedValue({
        success: false,
        error: 'Request timed out after 5000ms',
      })

      await expect(
        handler.execute(mockContext, mockBlock, { conditions: JSON.stringify(manyConditions) })
      ).rejects.toThrow(/Evaluation error in condition "if".*Request timed out/)
      expect(mockExecuteTool).toHaveBeenCalledOnce()
    })

    it('does not replay an indeterminate Function execution', async () => {
      mockExecuteTool.mockResolvedValue({
        success: false,
        error: 'The sandbox may have started this Function',
        retryable: false,
      })

      await expect(
        handler.execute(mockContext, mockBlock, { conditions: JSON.stringify(manyConditions) })
      ).rejects.toMatchObject({
        name: 'NonRetryableExecutionError',
        retryable: false,
      })
      expect(mockExecuteTool).toHaveBeenCalledOnce()
    })

    it('does not enter per-branch fallback when the batched Function call throws indeterminate', async () => {
      mockExecuteTool.mockRejectedValueOnce(
        new NonRetryableExecutionError('The sandbox may have started this Function')
      )

      await expect(
        handler.execute(mockContext, mockBlock, { conditions: JSON.stringify(manyConditions) })
      ).rejects.toMatchObject({
        name: 'NonRetryableExecutionError',
        retryable: false,
      })
      expect(mockExecuteTool).toHaveBeenCalledOnce()
    })

    it('preserves an indeterminate result during individual fallback', async () => {
      mockExecuteTool
        .mockResolvedValueOnce({
          success: false,
          error: 'Invalid JavaScript syntax: Unexpected token',
        })
        .mockResolvedValueOnce({
          success: false,
          error: 'The sandbox may have started this Function',
          retryable: false,
        })

      await expect(
        handler.execute(mockContext, mockBlock, { conditions: JSON.stringify(manyConditions) })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          name: 'NonRetryableExecutionError',
          retryable: false,
        }),
      })
      expect(mockExecuteTool).toHaveBeenCalledTimes(2)
    })

    it('falls back when the batch reports a branch index outside the list', async () => {
      mockExecuteTool.mockResolvedValueOnce(matchedAt(99))
      mockExecuteTool.mockResolvedValueOnce({ success: true, output: { result: true } })

      const result = await handler.execute(mockContext, mockBlock, {
        conditions: JSON.stringify(manyConditions),
      })

      expect((result as any).selectedOption).toBe('cond1')
      expect(mockExecuteTool).toHaveBeenCalledTimes(2)
    })

    it('does not take the else path on a reply that carries no verdict', async () => {
      // Reading a garbled reply as "nothing matched" would silently reroute the
      // run, so an unrecognized shape has to fall back rather than fall through.
      mockExecuteTool.mockResolvedValueOnce({ success: true, output: { result: { ok: true } } })
      mockExecuteTool.mockResolvedValueOnce({ success: true, output: { result: true } })

      const result = await handler.execute(mockContext, mockBlock, {
        conditions: JSON.stringify(manyConditions),
      })

      expect((result as any).selectedOption).toBe('cond1')
      expect(mockExecuteTool).toHaveBeenCalledTimes(2)
    })

    it('does not retry per branch once the run has been cancelled', async () => {
      mockContext.abortSignal = AbortSignal.abort()
      mockExecuteTool.mockResolvedValue({ success: false, error: 'Execution cancelled' })

      await expect(
        handler.execute(mockContext, mockBlock, { conditions: JSON.stringify(manyConditions) })
      ).rejects.toThrow(/Evaluation error in condition "if".*Execution cancelled/)
      expect(mockExecuteTool).toHaveBeenCalledOnce()
    })
  })

  describe('Multiple branches to same target', () => {
    it('should handle if and else pointing to same target', async () => {
      mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.value > 5' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      mockContext.workflow!.connections = [
        { source: mockSourceBlock.id, target: mockBlock.id },
        { source: mockBlock.id, target: mockTargetBlock1.id, sourceHandle: 'condition-cond1' },
        { source: mockBlock.id, target: mockTargetBlock1.id, sourceHandle: 'condition-else1' },
      ]

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).conditionResult).toBe(true)
      expect((result as any).selectedOption).toBe('cond1')
      expect((result as any).selectedPath).toEqual({
        blockId: mockTargetBlock1.id,
        blockType: 'target',
        blockTitle: 'Target Block 1',
      })
    })

    it('should select else branch to same target when if fails', async () => {
      mockExecuteTool.mockResolvedValueOnce(noMatch())

      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.value < 0' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      mockContext.workflow!.connections = [
        { source: mockSourceBlock.id, target: mockBlock.id },
        { source: mockBlock.id, target: mockTargetBlock1.id, sourceHandle: 'condition-cond1' },
        { source: mockBlock.id, target: mockTargetBlock1.id, sourceHandle: 'condition-else1' },
      ]

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).conditionResult).toBe(true)
      expect((result as any).selectedOption).toBe('else1')
      expect((result as any).selectedPath).toEqual({
        blockId: mockTargetBlock1.id,
        blockType: 'target',
        blockTitle: 'Target Block 1',
      })
    })

    it('should handle if→A, elseif→B, else→A pattern', async () => {
      // Neither cond1 nor cond2 matches, so the else branch wins.
      mockExecuteTool.mockResolvedValueOnce(noMatch())

      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.value === 1' },
        { id: 'cond2', title: 'else if', value: 'context.value === 2' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      mockContext.workflow!.connections = [
        { source: mockSourceBlock.id, target: mockBlock.id },
        { source: mockBlock.id, target: mockTargetBlock1.id, sourceHandle: 'condition-cond1' },
        { source: mockBlock.id, target: mockTargetBlock2.id, sourceHandle: 'condition-cond2' },
        { source: mockBlock.id, target: mockTargetBlock1.id, sourceHandle: 'condition-else1' },
      ]

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).conditionResult).toBe(true)
      expect((result as any).selectedOption).toBe('else1')
      expect((result as any).selectedPath?.blockId).toBe(mockTargetBlock1.id)
    })
  })

  describe('Condition evaluation with different data types', () => {
    it('should evaluate string comparison conditions', async () => {
      mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

      ;(mockContext.blockStates as any).set(mockSourceBlock.id, {
        output: { name: 'test', status: 'active' },
        executed: true,
        executionTime: 100,
      })

      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.status === "active"' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).selectedOption).toBe('cond1')
    })

    it('should evaluate boolean conditions', async () => {
      mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

      ;(mockContext.blockStates as any).set(mockSourceBlock.id, {
        output: { isEnabled: true, count: 5 },
        executed: true,
        executionTime: 100,
      })

      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.isEnabled' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).selectedOption).toBe('cond1')
    })

    it('should evaluate array length conditions', async () => {
      mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

      ;(mockContext.blockStates as any).set(mockSourceBlock.id, {
        output: { items: [1, 2, 3, 4, 5] },
        executed: true,
        executionTime: 100,
      })

      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.items.length > 3' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).selectedOption).toBe('cond1')
    })

    it('should evaluate null/undefined check conditions', async () => {
      mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

      ;(mockContext.blockStates as any).set(mockSourceBlock.id, {
        output: { data: null },
        executed: true,
        executionTime: 100,
      })

      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.data === null' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).selectedOption).toBe('cond1')
    })
  })

  describe('Multiple else-if conditions', () => {
    it('should evaluate multiple else-if conditions in order', async () => {
      mockExecuteTool.mockResolvedValueOnce(matchedAt(1))

      ;(mockContext.blockStates as any).set(mockSourceBlock.id, {
        output: { score: 75 },
        executed: true,
        executionTime: 100,
      })

      const mockTargetBlock3: SerializedBlock = {
        id: 'target-block-3',
        metadata: { id: 'target', name: 'Target Block 3' },
        position: { x: 100, y: 200 },
        config: { tool: 'target_tool_3', params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      }

      mockContext.workflow!.blocks!.push(mockTargetBlock3)

      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.score >= 90' },
        { id: 'cond2', title: 'else if', value: 'context.score >= 70' },
        { id: 'cond3', title: 'else if', value: 'context.score >= 50' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      mockContext.workflow!.connections = [
        { source: mockSourceBlock.id, target: mockBlock.id },
        { source: mockBlock.id, target: mockTargetBlock1.id, sourceHandle: 'condition-cond1' },
        { source: mockBlock.id, target: mockTargetBlock2.id, sourceHandle: 'condition-cond2' },
        { source: mockBlock.id, target: mockTargetBlock3.id, sourceHandle: 'condition-cond3' },
        { source: mockBlock.id, target: mockTargetBlock1.id, sourceHandle: 'condition-else1' },
      ]

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).selectedOption).toBe('cond2')
      expect((result as any).selectedPath?.blockId).toBe(mockTargetBlock2.id)
    })

    it('should skip to else when all else-if fail', async () => {
      mockExecuteTool.mockResolvedValueOnce(noMatch())

      ;(mockContext.blockStates as any).set(mockSourceBlock.id, {
        output: { score: 30 },
        executed: true,
        executionTime: 100,
      })

      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.score >= 90' },
        { id: 'cond2', title: 'else if', value: 'context.score >= 70' },
        { id: 'cond3', title: 'else if', value: 'context.score >= 50' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).selectedOption).toBe('else1')
    })
  })

  describe('Condition with no outgoing edge', () => {
    it('should set selectedOption when condition matches but has no edge', async () => {
      mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

      const conditions = [
        { id: 'cond1', title: 'if', value: 'true' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      mockContext.workflow!.connections = [
        { source: mockSourceBlock.id, target: mockBlock.id },
        { source: mockBlock.id, target: mockTargetBlock2.id, sourceHandle: 'condition-else1' },
      ]

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).conditionResult).toBe(true)
      expect((result as any).selectedPath).toBeNull()
      expect((result as any).selectedOption).toBe('cond1')
      expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('cond1')
    })

    it('should set selectedOption when else is selected but has no edge', async () => {
      mockExecuteTool.mockResolvedValueOnce(noMatch())

      const conditions = [
        { id: 'cond1', title: 'if', value: 'false' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      mockContext.workflow!.connections = [
        { source: mockSourceBlock.id, target: mockBlock.id },
        { source: mockBlock.id, target: mockTargetBlock1.id, sourceHandle: 'condition-cond1' },
      ]

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).conditionResult).toBe(true)
      expect((result as any).selectedPath).toBeNull()
      expect((result as any).selectedOption).toBe('else1')
      expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('else1')
    })

    it('should deactivate if-path when else is selected with no edge', async () => {
      mockExecuteTool.mockResolvedValueOnce(noMatch())

      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.value > 100' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      mockContext.workflow!.connections = [
        { source: mockSourceBlock.id, target: mockBlock.id },
        { source: mockBlock.id, target: mockTargetBlock1.id, sourceHandle: 'condition-cond1' },
      ]

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).selectedOption).toBe('else1')
      expect((result as any).conditionResult).toBe(true)
    })
  })

  describe('Empty conditions handling', () => {
    it('should handle empty conditions array', async () => {
      const conditions: unknown[] = []
      const inputs = { conditions: JSON.stringify(conditions) }

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).conditionResult).toBe(false)
      expect((result as any).selectedPath).toBeNull()
      expect((result as any).selectedOption).toBeNull()
    })

    it('should handle conditions passed as array directly', async () => {
      mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

      const conditions = [
        { id: 'cond1', title: 'if', value: 'true' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions }

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).selectedOption).toBe('cond1')
    })
  })

  describe('Source output filtering', () => {
    it('should not propagate error field from source block output', async () => {
      mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

      ;(mockContext.blockStates as any).set(mockSourceBlock.id, {
        output: { value: 10, text: 'hello', error: 'upstream block failed' },
        executed: true,
        executionTime: 100,
      })

      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.value > 5' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).conditionResult).toBe(true)
      expect((result as any).selectedOption).toBe('cond1')
      expect(result).not.toHaveProperty('error')
    })

    it('should not propagate _pauseMetadata from source block output', async () => {
      mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

      ;(mockContext.blockStates as any).set(mockSourceBlock.id, {
        output: { value: 10, _pauseMetadata: { contextId: 'abc' } },
        executed: true,
        executionTime: 100,
      })

      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.value > 5' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).conditionResult).toBe(true)
      expect(result).not.toHaveProperty('_pauseMetadata')
    })

    it('should still pass through non-control fields from source output', async () => {
      mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

      ;(mockContext.blockStates as any).set(mockSourceBlock.id, {
        output: { value: 10, text: 'hello', customData: { nested: true } },
        executed: true,
        executionTime: 100,
      })

      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.value > 5' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).value).toBe(10)
      expect((result as any).text).toBe('hello')
      expect((result as any).customData).toEqual({ nested: true })
    })
  })

  describe('Virtual block ID handling', () => {
    it('should use currentVirtualBlockId for decision key when available', async () => {
      mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

      mockContext.currentVirtualBlockId = 'virtual-block-123'

      const conditions = [
        { id: 'cond1', title: 'if', value: 'true' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      await handler.execute(mockContext, mockBlock, inputs)

      expect(mockContext.decisions.condition.get('virtual-block-123')).toBe('cond1')
      expect(mockContext.decisions.condition.has(mockBlock.id)).toBe(false)
    })
  })

  describe('Parallel branch handling', () => {
    it('should resolve connections and block data correctly when inside a parallel branch', async () => {
      mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

      const parallelConditionBlock: SerializedBlock = {
        id: 'cond-block-1₍0₎',
        metadata: { id: 'condition', name: 'Condition' },
        position: { x: 0, y: 0 },
        config: {},
      }

      const sourceBlockVirtualId = 'agent-block-1₍0₎'

      const parallelWorkflow: SerializedWorkflow = {
        blocks: [
          {
            id: 'agent-block-1',
            metadata: { id: 'agent', name: 'Agent' },
            position: { x: 0, y: 0 },
            config: {},
          },
          {
            id: 'cond-block-1',
            metadata: { id: 'condition', name: 'Condition' },
            position: { x: 100, y: 0 },
            config: {},
          },
          {
            id: 'target-block-1',
            metadata: { id: 'api', name: 'Target' },
            position: { x: 200, y: 0 },
            config: {},
          },
        ],
        connections: [
          { source: 'agent-block-1', target: 'cond-block-1' },
          { source: 'cond-block-1', target: 'target-block-1', sourceHandle: 'condition-cond1' },
        ],
        loops: [],
        parallels: [],
      }

      const parallelBlockStates = new Map<string, BlockState>([
        [
          sourceBlockVirtualId,
          { output: { response: 'hello from branch 0', success: true }, executed: true },
        ],
      ])

      const parallelContext: ExecutionContext = {
        workflowId: 'test-workflow-id',
        workspaceId: 'test-workspace-id',
        workflow: parallelWorkflow,
        blockStates: parallelBlockStates,
        blockLogs: [],
        completedBlocks: new Set(),
        decisions: {
          router: new Map(),
          condition: new Map(),
        },
        environmentVariables: {},
        workflowVariables: {},
      }

      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.response === "hello from branch 0"' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      const result = await handler.execute(parallelContext, parallelConditionBlock, inputs)

      expect((result as any).conditionResult).toBe(true)
      expect((result as any).selectedOption).toBe('cond1')
      expect((result as any).selectedPath).toEqual({
        blockId: 'target-block-1',
        blockType: 'api',
        blockTitle: 'Target',
      })
    })

    it('should find correct source block output in parallel branch context', async () => {
      mockExecuteTool.mockResolvedValueOnce(matchedAt(0))

      const parallelConditionBlock: SerializedBlock = {
        id: 'cond-block-1₍1₎',
        metadata: { id: 'condition', name: 'Condition' },
        position: { x: 0, y: 0 },
        config: {},
      }

      const parallelWorkflow: SerializedWorkflow = {
        blocks: [
          {
            id: 'agent-block-1',
            metadata: { id: 'agent', name: 'Agent' },
            position: { x: 0, y: 0 },
            config: {},
          },
          {
            id: 'cond-block-1',
            metadata: { id: 'condition', name: 'Condition' },
            position: { x: 100, y: 0 },
            config: {},
          },
          {
            id: 'target-block-1',
            metadata: { id: 'api', name: 'Target' },
            position: { x: 200, y: 0 },
            config: {},
          },
        ],
        connections: [
          { source: 'agent-block-1', target: 'cond-block-1' },
          { source: 'cond-block-1', target: 'target-block-1', sourceHandle: 'condition-cond1' },
        ],
        loops: [],
        parallels: [],
      }

      const parallelBlockStates = new Map<string, BlockState>([
        ['agent-block-1₍0₎', { output: { value: 10 }, executed: true }],
        ['agent-block-1₍1₎', { output: { value: 25 }, executed: true }],
        ['agent-block-1₍2₎', { output: { value: 5 }, executed: true }],
      ])

      const parallelContext: ExecutionContext = {
        workflowId: 'test-workflow-id',
        workspaceId: 'test-workspace-id',
        workflow: parallelWorkflow,
        blockStates: parallelBlockStates,
        blockLogs: [],
        completedBlocks: new Set(),
        decisions: {
          router: new Map(),
          condition: new Map(),
        },
        environmentVariables: {},
        workflowVariables: {},
      }

      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.value > 20' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      const result = await handler.execute(parallelContext, parallelConditionBlock, inputs)

      expect((result as any).conditionResult).toBe(true)
      expect((result as any).selectedOption).toBe('cond1')
    })

    it('should fall back to else when condition is false in parallel branch', async () => {
      mockExecuteTool.mockResolvedValueOnce(noMatch())

      const parallelConditionBlock: SerializedBlock = {
        id: 'cond-block-1₍2₎',
        metadata: { id: 'condition', name: 'Condition' },
        position: { x: 0, y: 0 },
        config: {},
      }

      const parallelWorkflow: SerializedWorkflow = {
        blocks: [
          {
            id: 'agent-block-1',
            metadata: { id: 'agent', name: 'Agent' },
            position: { x: 0, y: 0 },
            config: {},
          },
          {
            id: 'cond-block-1',
            metadata: { id: 'condition', name: 'Condition' },
            position: { x: 100, y: 0 },
            config: {},
          },
          {
            id: 'target-true',
            metadata: { id: 'api', name: 'True Path' },
            position: { x: 200, y: 0 },
            config: {},
          },
          {
            id: 'target-false',
            metadata: { id: 'api', name: 'False Path' },
            position: { x: 200, y: 100 },
            config: {},
          },
        ],
        connections: [
          { source: 'agent-block-1', target: 'cond-block-1' },
          { source: 'cond-block-1', target: 'target-true', sourceHandle: 'condition-cond1' },
          { source: 'cond-block-1', target: 'target-false', sourceHandle: 'condition-else1' },
        ],
        loops: [],
        parallels: [],
      }

      const parallelBlockStates = new Map<string, BlockState>([
        ['agent-block-1₍0₎', { output: { value: 100 }, executed: true }],
        ['agent-block-1₍1₎', { output: { value: 50 }, executed: true }],
        ['agent-block-1₍2₎', { output: { value: 5 }, executed: true }],
      ])

      const parallelContext: ExecutionContext = {
        workflowId: 'test-workflow-id',
        workspaceId: 'test-workspace-id',
        workflow: parallelWorkflow,
        blockStates: parallelBlockStates,
        blockLogs: [],
        completedBlocks: new Set(),
        decisions: {
          router: new Map(),
          condition: new Map(),
        },
        environmentVariables: {},
        workflowVariables: {},
      }

      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.value > 20' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      const result = await handler.execute(parallelContext, parallelConditionBlock, inputs)

      expect((result as any).conditionResult).toBe(true)
      expect((result as any).selectedOption).toBe('else1')
      expect((result as any).selectedPath.blockId).toBe('target-false')
    })
  })
})
