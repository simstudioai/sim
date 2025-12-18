import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockType } from '@/executor/constants'
import { ConditionBlockHandler } from '@/executor/handlers/condition/condition-handler'
import type { BlockState, ExecutionContext } from '@/executor/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn(() => 'test-request-id'),
}))

vi.mock('@/lib/execution/isolated-vm', () => ({
  executeInIsolatedVM: vi.fn(),
}))

import { executeInIsolatedVM } from '@/lib/execution/isolated-vm'

const mockExecuteInIsolatedVM = executeInIsolatedVM as ReturnType<typeof vi.fn>

function simulateIsolatedVMExecution(
  code: string,
  contextVariables: Record<string, unknown>
): { result: unknown; stdout: string; error?: { message: string; name: string } } {
  try {
    const fn = new Function(...Object.keys(contextVariables), code)
    const result = fn(...Object.values(contextVariables))
    return { result, stdout: '' }
  } catch (error: any) {
    return {
      result: null,
      stdout: '',
      error: { message: error.message, name: error.name || 'Error' },
    }
  }
}

describe('ConditionBlockHandler', () => {
  let handler: ConditionBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let mockWorkflow: Partial<SerializedWorkflow>
  let mockSourceBlock: SerializedBlock
  let mockTargetBlock1: SerializedBlock
  let mockTargetBlock2: SerializedBlock
  let mockResolver: any
  let mockPathTracker: any

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

    mockResolver = {
      resolveVariableReferences: vi.fn((expr) => expr),
      resolveBlockReferences: vi.fn((expr) => expr),
      resolveEnvVariables: vi.fn((expr) => expr),
    }

    mockPathTracker = {}

    handler = new ConditionBlockHandler(mockPathTracker, mockResolver)

    mockContext = {
      workflowId: 'test-workflow-id',
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
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      executedBlocks: new Set([mockSourceBlock.id]),
      activeExecutionPath: new Set(),
      workflow: mockWorkflow as SerializedWorkflow,
      completedLoops: new Set(),
    }

    vi.clearAllMocks()

    mockExecuteInIsolatedVM.mockImplementation(async ({ code, contextVariables }) => {
      return simulateIsolatedVMExecution(code, contextVariables)
    })
  })

  it('should handle condition blocks', () => {
    expect(handler.canHandle(mockBlock)).toBe(true)
    const nonCondBlock: SerializedBlock = { ...mockBlock, metadata: { id: 'other' } }
    expect(handler.canHandle(nonCondBlock)).toBe(false)
  })

  it('should execute condition block correctly and select first path', async () => {
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

    mockResolver.resolveVariableReferences.mockReturnValue('context.value > 5')
    mockResolver.resolveBlockReferences.mockReturnValue('context.value > 5')
    mockResolver.resolveEnvVariables.mockReturnValue('context.value > 5')

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(mockResolver.resolveVariableReferences).toHaveBeenCalledWith(
      'context.value > 5',
      mockBlock
    )
    expect(mockResolver.resolveBlockReferences).toHaveBeenCalledWith(
      'context.value > 5',
      mockContext,
      mockBlock
    )
    expect(mockResolver.resolveEnvVariables).toHaveBeenCalledWith('context.value > 5')
    expect(result).toEqual(expectedOutput)
    expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('cond1')
  })

  it('should select the else path if other conditions fail', async () => {
    const conditions = [
      { id: 'cond1', title: 'if', value: 'context.value < 0' }, // Should fail (10 < 0 is false)
      { id: 'else1', title: 'else', value: '' }, // Should be selected
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

    mockResolver.resolveVariableReferences.mockReturnValue('context.value < 0')
    mockResolver.resolveBlockReferences.mockReturnValue('context.value < 0')
    mockResolver.resolveEnvVariables.mockReturnValue('context.value < 0')

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(mockResolver.resolveVariableReferences).toHaveBeenCalledWith(
      'context.value < 0',
      mockBlock
    )
    expect(mockResolver.resolveBlockReferences).toHaveBeenCalledWith(
      'context.value < 0',
      mockContext,
      mockBlock
    )
    expect(mockResolver.resolveEnvVariables).toHaveBeenCalledWith('context.value < 0')
    expect(result).toEqual(expectedOutput)
    expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('else1')
  })

  it('should handle invalid conditions JSON format', async () => {
    const inputs = { conditions: '{ "invalid json ' }

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      /^Invalid conditions format:/
    )
  })

  it('should resolve references in conditions before evaluation', async () => {
    const conditions = [
      { id: 'cond1', title: 'if', value: '{{source-block-1.value}} > 5' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    mockResolver.resolveVariableReferences.mockReturnValue('{{source-block-1.value}} > 5')
    mockResolver.resolveBlockReferences.mockReturnValue('10 > 5')
    mockResolver.resolveEnvVariables.mockReturnValue('10 > 5')

    await handler.execute(mockContext, mockBlock, inputs)

    expect(mockResolver.resolveVariableReferences).toHaveBeenCalledWith(
      '{{source-block-1.value}} > 5',
      mockBlock
    )
    expect(mockResolver.resolveBlockReferences).toHaveBeenCalledWith(
      '{{source-block-1.value}} > 5',
      mockContext,
      mockBlock
    )
    expect(mockResolver.resolveEnvVariables).toHaveBeenCalledWith('10 > 5')
    expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('cond1')
  })

  it('should resolve variable references in conditions', async () => {
    const conditions = [
      { id: 'cond1', title: 'if', value: '<variable.userName> !== null' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    mockResolver.resolveVariableReferences.mockReturnValue('"john" !== null')
    mockResolver.resolveBlockReferences.mockReturnValue('"john" !== null')
    mockResolver.resolveEnvVariables.mockReturnValue('"john" !== null')

    await handler.execute(mockContext, mockBlock, inputs)

    expect(mockResolver.resolveVariableReferences).toHaveBeenCalledWith(
      '<variable.userName> !== null',
      mockBlock
    )
    expect(mockResolver.resolveBlockReferences).toHaveBeenCalledWith(
      '"john" !== null',
      mockContext,
      mockBlock
    )
    expect(mockResolver.resolveEnvVariables).toHaveBeenCalledWith('"john" !== null')
    expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('cond1')
  })

  it('should resolve environment variables in conditions', async () => {
    const conditions = [
      { id: 'cond1', title: 'if', value: '{{POOP}} === "hi"' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    mockResolver.resolveVariableReferences.mockReturnValue('{{POOP}} === "hi"')
    mockResolver.resolveBlockReferences.mockReturnValue('{{POOP}} === "hi"')
    mockResolver.resolveEnvVariables.mockReturnValue('"hi" === "hi"')

    await handler.execute(mockContext, mockBlock, inputs)

    expect(mockResolver.resolveVariableReferences).toHaveBeenCalledWith(
      '{{POOP}} === "hi"',
      mockBlock
    )
    expect(mockResolver.resolveBlockReferences).toHaveBeenCalledWith(
      '{{POOP}} === "hi"',
      mockContext,
      mockBlock
    )
    expect(mockResolver.resolveEnvVariables).toHaveBeenCalledWith('{{POOP}} === "hi"')
    expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('cond1')
  })

  it('should throw error if reference resolution fails', async () => {
    const conditions = [
      { id: 'cond1', title: 'if', value: '{{invalid-ref}}' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    const resolutionError = new Error('Could not resolve reference: invalid-ref')
    mockResolver.resolveVariableReferences.mockImplementation(() => {
      throw resolutionError
    })

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Failed to resolve references in condition: Could not resolve reference: invalid-ref'
    )
  })

  it('should handle evaluation errors gracefully', async () => {
    const conditions = [
      { id: 'cond1', title: 'if', value: 'context.nonExistentProperty.doSomething()' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    mockResolver.resolveVariableReferences.mockReturnValue(
      'context.nonExistentProperty.doSomething()'
    )
    mockResolver.resolveBlockReferences.mockReturnValue('context.nonExistentProperty.doSomething()')
    mockResolver.resolveEnvVariables.mockReturnValue('context.nonExistentProperty.doSomething()')

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      /Evaluation error in condition "if".*doSomething/
    )
  })

  it('should handle missing source block output gracefully', async () => {
    const conditions = [{ id: 'cond1', title: 'if', value: 'true' }]
    const inputs = { conditions: JSON.stringify(conditions) }

    const contextWithoutSource = {
      ...mockContext,
      blockStates: new Map<string, BlockState>(),
    }

    mockResolver.resolveVariableReferences.mockReturnValue('true')
    mockResolver.resolveBlockReferences.mockReturnValue('true')
    mockResolver.resolveEnvVariables.mockReturnValue('true')

    const result = await handler.execute(contextWithoutSource, mockBlock, inputs)

    expect(result).toHaveProperty('conditionResult', true)
    expect(result).toHaveProperty('selectedOption', 'cond1')
  })

  it('should throw error if target block is missing', async () => {
    const conditions = [{ id: 'cond1', title: 'if', value: 'true' }]
    const inputs = { conditions: JSON.stringify(conditions) }

    mockContext.workflow!.blocks = [mockSourceBlock, mockBlock, mockTargetBlock2]

    mockResolver.resolveVariableReferences.mockReturnValue('true')
    mockResolver.resolveBlockReferences.mockReturnValue('true')
    mockResolver.resolveEnvVariables.mockReturnValue('true')

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      `Target block ${mockTargetBlock1.id} not found`
    )
  })

  it('should return no-match result if no condition matches and no else exists', async () => {
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

    mockResolver.resolveVariableReferences
      .mockReturnValueOnce('false')
      .mockReturnValueOnce('context.value === 99')
    mockResolver.resolveBlockReferences
      .mockReturnValueOnce('false')
      .mockReturnValueOnce('context.value === 99')
    mockResolver.resolveEnvVariables
      .mockReturnValueOnce('false')
      .mockReturnValueOnce('context.value === 99')

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect((result as any).conditionResult).toBe(false)
    expect((result as any).selectedPath).toBeNull()
    expect((result as any).selectedOption).toBeNull()
    expect(mockContext.decisions.condition.has(mockBlock.id)).toBe(false)
  })

  it('falls back to else path when loop context data is unavailable', async () => {
    const conditions = [
      { id: 'cond1', title: 'if', value: 'context.item === "apple"' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    mockResolver.resolveVariableReferences.mockReturnValue('context.item === "apple"')
    mockResolver.resolveBlockReferences.mockReturnValue('context.item === "apple"')
    mockResolver.resolveEnvVariables.mockReturnValue('context.item === "apple"')

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('else1')
    expect((result as any).selectedOption).toBe('else1')
  })
})
