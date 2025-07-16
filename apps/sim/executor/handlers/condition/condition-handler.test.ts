import '../../__test-utils__/mock-dependencies'

import { beforeEach, describe, expect, it, type Mocked, type MockedClass, vi } from 'vitest'
import { BlockType } from '@/executor/consts'
import { ConditionBlockHandler } from '@/executor/handlers/condition/condition-handler'
import { PathTracker } from '@/executor/path/path'
import { InputResolver } from '@/executor/resolver/resolver'
import type { BlockState, ExecutionContext } from '@/executor/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const MockPathTracker = PathTracker as MockedClass<typeof PathTracker>
const MockInputResolver = InputResolver as MockedClass<typeof InputResolver>

describe('ConditionBlockHandler', () => {
  let handler: ConditionBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let mockPathTracker: Mocked<PathTracker>
  let mockResolver: Mocked<InputResolver>
  let mockWorkflow: Partial<SerializedWorkflow>
  let mockSourceBlock: SerializedBlock
  let mockTargetBlock1: SerializedBlock
  let mockTargetBlock2: SerializedBlock

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

    mockPathTracker = new MockPathTracker(mockWorkflow as SerializedWorkflow) as Mocked<PathTracker>
    mockResolver = new MockInputResolver(
      mockWorkflow as SerializedWorkflow,
      {}
    ) as Mocked<InputResolver>

    // Ensure the method exists as a mock function on the instance
    mockResolver.resolveBlockReferences = vi.fn()

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
      loopIterations: new Map(),
      loopItems: new Map(),
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
    }

    // Mock directly in the test
    mockResolver.resolveBlockReferences.mockReturnValue('context.value > 5')

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect(mockResolver.resolveBlockReferences).toHaveBeenCalledWith(
      'context.value > 5',
      mockContext,
      mockBlock
    )
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
    }

    // Mock directly in the test
    mockResolver.resolveBlockReferences.mockReturnValue('context.value < 0')

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect(mockResolver.resolveBlockReferences).toHaveBeenCalledWith(
      'context.value < 0',
      mockContext,
      mockBlock
    )
    expect(result).toEqual(expectedOutput)
    expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('else1')
  })

  it('should handle invalid conditions JSON format', async () => {
    const inputs = { conditions: '{ "invalid json ' }

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      /^Invalid conditions format: Unterminated string.*/
    )
  })

  it('should resolve references in conditions before evaluation', async () => {
    const conditions = [
      { id: 'cond1', title: 'if', value: '{{source-block-1.value}} > 5' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    // Mock directly in the test
    mockResolver.resolveBlockReferences.mockReturnValue('10 > 5')

    const _result = await handler.execute(mockBlock, inputs, mockContext)

    expect(mockResolver.resolveBlockReferences).toHaveBeenCalledWith(
      '{{source-block-1.value}} > 5',
      mockContext,
      mockBlock
    )
    expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('cond1')
  })

  it('should throw error if reference resolution fails', async () => {
    const conditions = [
      { id: 'cond1', title: 'if', value: '{{invalid-ref}}' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    const resolutionError = new Error('Could not resolve reference: invalid-ref')
    // Mock directly in the test
    mockResolver.resolveBlockReferences.mockImplementation(() => {
      throw resolutionError
    })

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      'Failed to resolve references in condition: Could not resolve reference: invalid-ref'
    )
  })

  it('should handle evaluation errors gracefully', async () => {
    const conditions = [
      { id: 'cond1', title: 'if', value: 'context.nonExistentProperty.doSomething()' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    // Mock directly in the test
    mockResolver.resolveBlockReferences.mockReturnValue('context.nonExistentProperty.doSomething()')

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      /^Evaluation error in condition "if": Cannot read properties of undefined \(reading 'doSomething'\)\. \(Resolved: context\.nonExistentProperty\.doSomething\(\)\)$/
    )
  })

  it('should throw error if source block output is missing', async () => {
    const conditions = [{ id: 'cond1', title: 'if', value: 'true' }]
    const inputs = { conditions: JSON.stringify(conditions) }
    mockContext.blockStates.delete(mockSourceBlock.id)

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      `No output found for source block ${mockSourceBlock.id}`
    )
  })

  it('should throw error if target block is missing', async () => {
    const conditions = [{ id: 'cond1', title: 'if', value: 'true' }]
    const inputs = { conditions: JSON.stringify(conditions) }

    mockContext.workflow!.blocks = [mockSourceBlock, mockBlock, mockTargetBlock2]

    // Mock directly in the test
    mockResolver.resolveBlockReferences.mockReturnValue('true')

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
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

    // Mock directly in the test
    mockResolver.resolveBlockReferences
      .mockReturnValueOnce('false')
      .mockReturnValueOnce('context.value === 99')

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      `No matching path found for condition block "${mockBlock.metadata?.name}", and no 'else' block exists.`
    )
  })

  it('should use loop context during evaluation if available', async () => {
    const conditions = [
      { id: 'cond1', title: 'if', value: 'context.item === "apple"' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    mockContext.loopItems.set(mockBlock.id, { item: 'apple' })

    // Mock directly in the test
    mockResolver.resolveBlockReferences.mockReturnValue('context.item === "apple"')

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('cond1')
    expect((result as any).selectedConditionId).toBe('cond1')
  })
})
