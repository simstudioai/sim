import '@/executor/__test-utils__/mock-dependencies'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockType, EDGE } from '@/executor/constants'
import { evaluateConditionExpression } from '@/executor/handlers/condition/condition-handler'
import { RouterBlockHandler } from '@/executor/handlers/router/router-handler'
import type { BlockState, ExecutionContext } from '@/executor/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

interface RouterResult {
  conditionResult: boolean
  selectedPath: {
    blockId: string
    blockType: string
    blockTitle: string
  } | null
  selectedOption: string | null
}

vi.mock('@/executor/handlers/condition/condition-handler', () => ({
  evaluateConditionExpression: vi.fn(),
}))

const mockEvaluateConditionExpression = evaluateConditionExpression as ReturnType<typeof vi.fn>

describe('RouterBlockHandler', () => {
  let handler: RouterBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let mockWorkflow: Partial<SerializedWorkflow>
  let mockTargetBlock1: SerializedBlock
  let mockTargetBlock2: SerializedBlock
  let mockTargetBlock3: SerializedBlock

  beforeEach(() => {
    mockTargetBlock1 = {
      id: 'target-block-1',
      metadata: { id: 'agent', name: 'Option A', description: 'Choose A' },
      position: { x: 100, y: 100 },
      config: { tool: 'tool_a', params: { p: 'a' } },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockTargetBlock2 = {
      id: 'target-block-2',
      metadata: { id: 'agent', name: 'Option B', description: 'Choose B' },
      position: { x: 100, y: 150 },
      config: { tool: 'tool_b', params: { p: 'b' } },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockTargetBlock3 = {
      id: 'target-block-3',
      metadata: { id: 'agent', name: 'Option C', description: 'Choose C' },
      position: { x: 100, y: 200 },
      config: { tool: 'tool_c', params: { p: 'c' } },
      inputs: {},
      outputs: {},
      enabled: true,
    }

    const routes = [
      { id: 'route-if', title: 'if', value: 'value > 10' },
      { id: 'route-else-if', title: 'else if', value: 'value > 5' },
      { id: 'route-else', title: 'else', value: '' },
    ]

    mockBlock = {
      id: 'router-block-1',
      metadata: { id: BlockType.ROUTER, name: 'Test Router' },
      position: { x: 50, y: 50 },
      config: { tool: BlockType.ROUTER, params: { routes: JSON.stringify(routes) } },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockWorkflow = {
      blocks: [mockBlock, mockTargetBlock1, mockTargetBlock2, mockTargetBlock3],
      connections: [
        {
          source: mockBlock.id,
          target: mockTargetBlock1.id,
          sourceHandle: `${EDGE.ROUTER_PREFIX}route-if`,
        },
        {
          source: mockBlock.id,
          target: mockTargetBlock2.id,
          sourceHandle: `${EDGE.ROUTER_PREFIX}route-else-if`,
        },
        {
          source: mockBlock.id,
          target: mockTargetBlock3.id,
          sourceHandle: `${EDGE.ROUTER_PREFIX}route-else`,
        },
      ],
    }

    handler = new RouterBlockHandler()

    mockContext = {
      workflowId: 'test-workflow-id',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      workflow: mockWorkflow as SerializedWorkflow,
    }

    vi.clearAllMocks()
  })

  it('should handle router blocks', () => {
    expect(handler.canHandle(mockBlock)).toBe(true)
    const nonRouterBlock: SerializedBlock = { ...mockBlock, metadata: { id: 'other' } }
    expect(handler.canHandle(nonRouterBlock)).toBe(false)
  })

  it('should select first route when its condition is true', async () => {
    mockEvaluateConditionExpression.mockResolvedValueOnce(true)

    const inputs = {
      routes: JSON.stringify([
        { id: 'route-if', title: 'if', value: 'value > 10' },
        { id: 'route-else-if', title: 'else if', value: 'value > 5' },
        { id: 'route-else', title: 'else', value: '' },
      ]),
    }

    const result = (await handler.execute(
      mockContext,
      mockBlock,
      inputs
    )) as unknown as RouterResult

    expect(mockEvaluateConditionExpression).toHaveBeenCalledWith(mockContext, 'value > 10', {})
    expect(result.conditionResult).toBe(true)
    expect(result.selectedPath).toEqual({
      blockId: 'target-block-1',
      blockType: 'agent',
      blockTitle: 'Option A',
    })
    expect(result.selectedOption).toBe('route-if')
    expect(mockContext.decisions.router.get(mockBlock.id)).toBe('route-if')
  })

  it('should select second route when first condition is false', async () => {
    mockEvaluateConditionExpression.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    const inputs = {
      routes: JSON.stringify([
        { id: 'route-if', title: 'if', value: 'value > 10' },
        { id: 'route-else-if', title: 'else if', value: 'value > 5' },
        { id: 'route-else', title: 'else', value: '' },
      ]),
    }

    const result = (await handler.execute(
      mockContext,
      mockBlock,
      inputs
    )) as unknown as RouterResult

    expect(mockEvaluateConditionExpression).toHaveBeenCalledTimes(2)
    expect(result.conditionResult).toBe(true)
    expect(result.selectedPath).toEqual({
      blockId: 'target-block-2',
      blockType: 'agent',
      blockTitle: 'Option B',
    })
    expect(result.selectedOption).toBe('route-else-if')
    expect(mockContext.decisions.router.get(mockBlock.id)).toBe('route-else-if')
  })

  it('should select else route when all conditions are false', async () => {
    mockEvaluateConditionExpression.mockResolvedValueOnce(false).mockResolvedValueOnce(false)

    const inputs = {
      routes: JSON.stringify([
        { id: 'route-if', title: 'if', value: 'value > 10' },
        { id: 'route-else-if', title: 'else if', value: 'value > 5' },
        { id: 'route-else', title: 'else', value: '' },
      ]),
    }

    const result = (await handler.execute(
      mockContext,
      mockBlock,
      inputs
    )) as unknown as RouterResult

    expect(mockEvaluateConditionExpression).toHaveBeenCalledTimes(2)
    expect(result.conditionResult).toBe(true)
    expect(result.selectedPath).toEqual({
      blockId: 'target-block-3',
      blockType: 'agent',
      blockTitle: 'Option C',
    })
    expect(result.selectedOption).toBe('route-else')
    expect(mockContext.decisions.router.get(mockBlock.id)).toBe('route-else')
  })

  it('should return no selection when no routes match and no else', async () => {
    mockEvaluateConditionExpression.mockResolvedValue(false)

    const routes = [{ id: 'route-if', title: 'if', value: 'value > 10' }]

    mockWorkflow.connections = [
      {
        source: mockBlock.id,
        target: mockTargetBlock1.id,
        sourceHandle: `${EDGE.ROUTER_PREFIX}route-if`,
      },
    ]

    const inputs = {
      routes: JSON.stringify(routes),
    }

    const result = (await handler.execute(
      mockContext,
      mockBlock,
      inputs
    )) as unknown as RouterResult

    expect(result.conditionResult).toBe(false)
    expect(result.selectedPath).toBe(null)
    expect(result.selectedOption).toBe(null)
  })

  it('should throw error on invalid routes format', async () => {
    const inputs = {
      routes: 'invalid-json',
    }

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Invalid routes format'
    )
  })

  it('should throw error when condition evaluation fails', async () => {
    mockEvaluateConditionExpression.mockRejectedValue(new Error('Evaluation failed'))

    const inputs = {
      routes: JSON.stringify([{ id: 'route-if', title: 'if', value: 'invalid.expression' }]),
    }

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Evaluation error in route "if": Evaluation failed'
    )
  })

  it('should use source block output for evaluation context', async () => {
    const sourceBlockId = 'source-block'
    const sourceOutput = { value: 15, message: 'test' }

    const blockStates = new Map<string, BlockState>()
    blockStates.set(sourceBlockId, {
      output: sourceOutput,
      executed: true,
      executionTime: 100,
    })
    mockContext.blockStates = blockStates

    mockWorkflow.connections = [
      { source: sourceBlockId, target: mockBlock.id },
      {
        source: mockBlock.id,
        target: mockTargetBlock1.id,
        sourceHandle: `${EDGE.ROUTER_PREFIX}route-if`,
      },
    ]

    mockEvaluateConditionExpression.mockResolvedValueOnce(true)

    const inputs = {
      routes: JSON.stringify([{ id: 'route-if', title: 'if', value: 'value > 10' }]),
    }

    await handler.execute(mockContext, mockBlock, inputs)

    expect(mockEvaluateConditionExpression).toHaveBeenCalledWith(
      mockContext,
      'value > 10',
      sourceOutput
    )
  })
})
