import '@/executor/__test-utils__/mock-dependencies'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockType } from '@/executor/consts'
import { ConditionBlockHandler } from '@/executor/handlers/condition/condition-handler'
import type { BlockState, ExecutionContext } from '@/executor/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

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
    // Define blocks first
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
      inputs: { conditions: 'json' }, // Corrected based on previous step
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

    // Then define workflow using the block objects
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

    // Define mock context *after* workflow and blocks are set up
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
      environmentVariables: {}, // Now set the context's env vars
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      executedBlocks: new Set([mockSourceBlock.id]),
      activeExecutionPath: new Set(),
      workflow: mockWorkflow as SerializedWorkflow,
      completedLoops: new Set(),
    }

    // Reset mocks using vi
    vi.clearAllMocks()

    // Default mock implementations - Removed as it's in the shared mock now
    // mockResolver.resolveBlockReferences.mockImplementation((value) => value)
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
      selectedConditionId: 'cond1',
      selectedOption: 'cond1',
    }

    // Mock the full resolution pipeline
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
      selectedConditionId: 'else1',
      selectedOption: 'else1',
    }

    // Mock the full resolution pipeline
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
      /^Invalid conditions format: Unterminated string.*/
    )
  })

  it('should resolve references in conditions before evaluation', async () => {
    const conditions = [
      { id: 'cond1', title: 'if', value: '{{source-block-1.value}} > 5' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    // Mock the full resolution pipeline
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

    // Mock the full resolution pipeline for variable resolution
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

    // Mock the full resolution pipeline for env variable resolution
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
    // Mock the pipeline to throw at the variable resolution stage
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

    // Mock the full resolution pipeline
    mockResolver.resolveVariableReferences.mockReturnValue(
      'context.nonExistentProperty.doSomething()'
    )
    mockResolver.resolveBlockReferences.mockReturnValue('context.nonExistentProperty.doSomething()')
    mockResolver.resolveEnvVariables.mockReturnValue('context.nonExistentProperty.doSomething()')

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      /^Evaluation error in condition "if": Evaluation error in condition: Cannot read properties of undefined \(reading 'doSomething'\)\. \(Resolved: context\.nonExistentProperty\.doSomething\(\)\)$/
    )
  })

  it('should handle missing source block output gracefully', async () => {
    const conditions = [{ id: 'cond1', title: 'if', value: 'true' }]
    const inputs = { conditions: JSON.stringify(conditions) }

    // Create a new context with empty blockStates instead of trying to delete from readonly map
    const contextWithoutSource = {
      ...mockContext,
      blockStates: new Map<string, BlockState>(),
    }

    mockResolver.resolveVariableReferences.mockReturnValue('true')
    mockResolver.resolveBlockReferences.mockReturnValue('true')
    mockResolver.resolveEnvVariables.mockReturnValue('true')

    const result = await handler.execute(contextWithoutSource, mockBlock, inputs)

    expect(result).toHaveProperty('conditionResult', true)
    expect(result).toHaveProperty('selectedConditionId', 'cond1')
  })

  it('should throw error if target block is missing', async () => {
    const conditions = [{ id: 'cond1', title: 'if', value: 'true' }]
    const inputs = { conditions: JSON.stringify(conditions) }

    mockContext.workflow!.blocks = [mockSourceBlock, mockBlock, mockTargetBlock2]

    // Mock the full resolution pipeline
    mockResolver.resolveVariableReferences.mockReturnValue('true')
    mockResolver.resolveBlockReferences.mockReturnValue('true')
    mockResolver.resolveEnvVariables.mockReturnValue('true')

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      `Target block ${mockTargetBlock1.id} not found`
    )
  })

  it('should throw error if no condition matches and no else exists', async () => {
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

    // Mock the full resolution pipeline
    mockResolver.resolveVariableReferences
      .mockReturnValueOnce('false')
      .mockReturnValueOnce('context.value === 99')
    mockResolver.resolveBlockReferences
      .mockReturnValueOnce('false')
      .mockReturnValueOnce('context.value === 99')
    mockResolver.resolveEnvVariables
      .mockReturnValueOnce('false')
      .mockReturnValueOnce('context.value === 99')

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      `No matching path found for condition block "${mockBlock.metadata?.name}", and no 'else' block exists.`
    )
  })

  it('falls back to else path when loop context data is unavailable', async () => {
    const conditions = [
      { id: 'cond1', title: 'if', value: 'context.item === "apple"' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    // Mock the full resolution pipeline
    mockResolver.resolveVariableReferences.mockReturnValue('context.item === "apple"')
    mockResolver.resolveBlockReferences.mockReturnValue('context.item === "apple"')
    mockResolver.resolveEnvVariables.mockReturnValue('context.item === "apple"')

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('else1')
    expect((result as any).selectedConditionId).toBe('else1')
  })
})
