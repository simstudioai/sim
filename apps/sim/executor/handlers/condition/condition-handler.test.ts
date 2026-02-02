import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockType } from '@/executor/constants'
import { ConditionBlockHandler } from '@/executor/handlers/condition/condition-handler'
import type { BlockState, ExecutionContext } from '@/executor/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn(() => 'test-request-id'),
}))

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

/**
 * Simulates what the function_execute tool does when evaluating condition code
 */
function simulateConditionExecution(code: string): {
  success: boolean
  output?: { result: unknown }
  error?: string
} {
  try {
    const fn = new Function(code)
    const result = fn()
    return { success: true, output: { result } }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
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

    mockExecuteTool.mockImplementation(async (_toolId: string, params: { code: string }) => {
      return simulateConditionExecution(params.code)
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

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(result).toEqual(expectedOutput)
    expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('cond1')
  })

  it('should pass correct parameters to function_execute tool', async () => {
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
        blockData: { 'source-block-1': { value: 10, text: 'hello' } },
        blockNameMapping: { sourceblock: 'source-block-1' },
        _context: {
          workflowId: 'test-workflow-id',
          workspaceId: 'test-workspace-id',
        },
      }),
      false,
      mockContext
    )
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

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(result).toEqual(expectedOutput)
    expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('else1')
  })

  it('should handle invalid conditions JSON format', async () => {
    const inputs = { conditions: '{ "invalid json ' }

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      /^Invalid conditions format:/
    )
  })

  it('should handle evaluation errors gracefully', async () => {
    const conditions = [
      { id: 'cond1', title: 'if', value: 'context.nonExistentProperty.doSomething()' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

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

    const result = await handler.execute(contextWithoutSource, mockBlock, inputs)

    expect(result).toHaveProperty('conditionResult', true)
    expect(result).toHaveProperty('selectedOption', 'cond1')
  })

  it('should throw error if target block is missing', async () => {
    const conditions = [{ id: 'cond1', title: 'if', value: 'true' }]
    const inputs = { conditions: JSON.stringify(conditions) }

    mockContext.workflow!.blocks = [mockSourceBlock, mockBlock, mockTargetBlock2]

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

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(mockContext.decisions.condition.get(mockBlock.id)).toBe('else1')
    expect((result as any).selectedOption).toBe('else1')
  })

  it('should use collectBlockData to gather block state', async () => {
    const conditions = [
      { id: 'cond1', title: 'if', value: 'true' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    await handler.execute(mockContext, mockBlock, inputs)

    // collectBlockData is now called with the current node ID for parallel branch context
    expect(mockCollectBlockData).toHaveBeenCalledWith(mockContext, mockBlock.id)
  })

  it('should handle function_execute tool failure', async () => {
    const conditions = [
      { id: 'cond1', title: 'if', value: 'context.value > 5' },
      { id: 'else1', title: 'else', value: '' },
    ]
    const inputs = { conditions: JSON.stringify(conditions) }

    mockExecuteTool.mockResolvedValueOnce({
      success: false,
      error: 'Execution timeout',
    })

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      /Evaluation error in condition "if".*Execution timeout/
    )
  })

  describe('Multiple branches to same target', () => {
    it('should handle if and else pointing to same target', async () => {
      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.value > 5' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      // Both branches point to the same target
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
      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.value < 0' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      // Both branches point to the same target
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

      // value is 10, so else should be selected (pointing to target 1)
      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).conditionResult).toBe(true)
      expect((result as any).selectedOption).toBe('else1')
      expect((result as any).selectedPath?.blockId).toBe(mockTargetBlock1.id)
    })
  })

  describe('Condition evaluation with different data types', () => {
    it('should evaluate string comparison conditions', async () => {
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

      // Score is 75, so second condition (>=70) should match
      expect((result as any).selectedOption).toBe('cond2')
      expect((result as any).selectedPath?.blockId).toBe(mockTargetBlock2.id)
    })

    it('should skip to else when all else-if fail', async () => {
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
    it('should return null path when condition matches but has no edge', async () => {
      const conditions = [
        { id: 'cond1', title: 'if', value: 'true' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      // No connection for cond1
      mockContext.workflow!.connections = [
        { source: mockSourceBlock.id, target: mockBlock.id },
        { source: mockBlock.id, target: mockTargetBlock2.id, sourceHandle: 'condition-else1' },
      ]

      const result = await handler.execute(mockContext, mockBlock, inputs)

      // Condition matches but no edge for it
      expect((result as any).conditionResult).toBe(false)
      expect((result as any).selectedPath).toBeNull()
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
      const conditions = [
        { id: 'cond1', title: 'if', value: 'true' },
        { id: 'else1', title: 'else', value: '' },
      ]
      // Pass as array instead of JSON string
      const inputs = { conditions }

      const result = await handler.execute(mockContext, mockBlock, inputs)

      expect((result as any).selectedOption).toBe('cond1')
    })
  })

  describe('Virtual block ID handling', () => {
    it('should use currentVirtualBlockId for decision key when available', async () => {
      mockContext.currentVirtualBlockId = 'virtual-block-123'

      const conditions = [
        { id: 'cond1', title: 'if', value: 'true' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      await handler.execute(mockContext, mockBlock, inputs)

      // Decision should be stored under virtual block ID, not actual block ID
      expect(mockContext.decisions.condition.get('virtual-block-123')).toBe('cond1')
      expect(mockContext.decisions.condition.has(mockBlock.id)).toBe(false)
    })
  })

  describe('Parallel branch handling', () => {
    it('should resolve connections and block data correctly when inside a parallel branch', async () => {
      // Simulate a condition block inside a parallel branch
      // Virtual block ID uses subscript notation: blockId₍branchIndex₎
      const parallelConditionBlock: SerializedBlock = {
        id: 'cond-block-1₍0₎', // Virtual ID for branch 0
        metadata: { id: 'condition', name: 'Condition' },
        position: { x: 0, y: 0 },
        config: {},
      }

      // Source block also has a virtual ID in the same branch
      const sourceBlockVirtualId = 'agent-block-1₍0₎'

      // Set up workflow with connections using BASE block IDs (as they are in the workflow definition)
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
          // Connections use base IDs, not virtual IDs
          { source: 'agent-block-1', target: 'cond-block-1' },
          { source: 'cond-block-1', target: 'target-block-1', sourceHandle: 'condition-cond1' },
        ],
        loops: [],
        parallels: [],
      }

      // Block states use virtual IDs (as outputs are stored per-branch)
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

      // The condition should evaluate to true because:
      // 1. Connection lookup uses base ID 'cond-block-1' (extracted from 'cond-block-1₍0₎')
      // 2. Source block output is found at virtual ID 'agent-block-1₍0₎' (same branch)
      // 3. The evaluation context contains { response: 'hello from branch 0' }
      expect((result as any).conditionResult).toBe(true)
      expect((result as any).selectedOption).toBe('cond1')
      expect((result as any).selectedPath).toEqual({
        blockId: 'target-block-1',
        blockType: 'api',
        blockTitle: 'Target',
      })
    })

    it('should find correct source block output in parallel branch context', async () => {
      // Test that when multiple branches exist, the correct branch output is used
      const parallelConditionBlock: SerializedBlock = {
        id: 'cond-block-1₍1₎', // Virtual ID for branch 1
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

      // Multiple branches have executed - each has different output
      const parallelBlockStates = new Map<string, BlockState>([
        ['agent-block-1₍0₎', { output: { value: 10 }, executed: true }],
        ['agent-block-1₍1₎', { output: { value: 25 }, executed: true }], // Branch 1 has value 25
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

      // Condition checks if value > 20 - should be true for branch 1 (value=25)
      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.value > 20' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      const result = await handler.execute(parallelContext, parallelConditionBlock, inputs)

      // Should evaluate using branch 1's data (value=25), not branch 0 (value=10) or branch 2 (value=5)
      expect((result as any).conditionResult).toBe(true)
      expect((result as any).selectedOption).toBe('cond1')
    })

    it('should fall back to else when condition is false in parallel branch', async () => {
      const parallelConditionBlock: SerializedBlock = {
        id: 'cond-block-1₍2₎', // Virtual ID for branch 2
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
        ['agent-block-1₍2₎', { output: { value: 5 }, executed: true }], // Branch 2 has value 5
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

      // Condition checks if value > 20 - should be false for branch 2 (value=5)
      const conditions = [
        { id: 'cond1', title: 'if', value: 'context.value > 20' },
        { id: 'else1', title: 'else', value: '' },
      ]
      const inputs = { conditions: JSON.stringify(conditions) }

      const result = await handler.execute(parallelContext, parallelConditionBlock, inputs)

      // Should fall back to else path because branch 2's value (5) is not > 20
      expect((result as any).conditionResult).toBe(true)
      expect((result as any).selectedOption).toBe('else1')
      expect((result as any).selectedPath.blockId).toBe('target-false')
    })
  })
})
