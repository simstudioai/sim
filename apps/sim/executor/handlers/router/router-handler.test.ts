import '../../__test-utils__/mock-dependencies'

import {
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  type Mocked,
  type MockedClass,
  vi,
} from 'vitest'
import { generateRouterPrompt } from '@/blocks/blocks/router'
import { BlockType } from '@/executor/consts'
import { RouterBlockHandler } from '@/executor/handlers/router/router-handler'
import { PathTracker } from '@/executor/path/path'
import type { ExecutionContext } from '@/executor/types'
import { getProviderFromModel } from '@/providers/utils'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const mockGenerateRouterPrompt = generateRouterPrompt as Mock
const mockGetProviderFromModel = getProviderFromModel as Mock
const MockPathTracker = PathTracker as MockedClass<typeof PathTracker>
const mockFetch = global.fetch as unknown as Mock

describe('RouterBlockHandler', () => {
  let handler: RouterBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let mockPathTracker: Mocked<PathTracker>
  let mockWorkflow: Partial<SerializedWorkflow>
  let mockTargetBlock1: SerializedBlock
  let mockTargetBlock2: SerializedBlock

  beforeEach(() => {
    mockTargetBlock1 = {
      id: 'target-block-1',
      metadata: { id: 'target', name: 'Option A', description: 'Choose A' },
      position: { x: 100, y: 100 },
      config: { tool: 'tool_a', params: { p: 'a' } },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockTargetBlock2 = {
      id: 'target-block-2',
      metadata: { id: 'target', name: 'Option B', description: 'Choose B' },
      position: { x: 100, y: 150 },
      config: { tool: 'tool_b', params: { p: 'b' } },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockBlock = {
      id: 'router-block-1',
      metadata: { id: BlockType.ROUTER, name: 'Test Router' },
      position: { x: 50, y: 50 },
      config: { tool: BlockType.ROUTER, params: {} },
      inputs: { prompt: 'string', model: 'string' }, // Using ParamType strings
      outputs: {},
      enabled: true,
    }
    mockWorkflow = {
      blocks: [mockBlock, mockTargetBlock1, mockTargetBlock2],
      connections: [
        { source: mockBlock.id, target: mockTargetBlock1.id },
        { source: mockBlock.id, target: mockTargetBlock2.id },
      ],
    }

    mockPathTracker = new MockPathTracker(mockWorkflow as SerializedWorkflow) as Mocked<PathTracker>
    handler = new RouterBlockHandler(mockPathTracker)

    mockContext = {
      workflowId: 'test-workflow-id',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopIterations: new Map(),
      loopItems: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      workflow: mockWorkflow as SerializedWorkflow,
    }

    // Reset mocks using vi
    vi.clearAllMocks()

    // Default mock implementations
    mockGetProviderFromModel.mockReturnValue('openai')
    mockGenerateRouterPrompt.mockReturnValue('Generated System Prompt')

    // Set up fetch mock to return a successful response
    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: 'target-block-1',
            model: 'mock-model',
            tokens: { prompt: 100, completion: 5, total: 105 },
            cost: 0.003,
            timing: { total: 300 },
          }),
      })
    })
  })

  it('should handle router blocks', () => {
    expect(handler.canHandle(mockBlock)).toBe(true)
    const nonRouterBlock: SerializedBlock = { ...mockBlock, metadata: { id: 'other' } }
    expect(handler.canHandle(nonRouterBlock)).toBe(false)
  })

  it('should execute router block correctly and select a path', async () => {
    const inputs = {
      prompt: 'Choose the best option.',
      model: 'gpt-4o',
      temperature: 0.5,
    }

    const expectedTargetBlocks = [
      {
        id: 'target-block-1',
        type: 'target',
        title: 'Option A',
        description: 'Choose A',
        subBlocks: {
          p: 'a',
          systemPrompt: '',
        },
        currentState: undefined,
      },
      {
        id: 'target-block-2',
        type: 'target',
        title: 'Option B',
        description: 'Choose B',
        subBlocks: {
          p: 'b',
          systemPrompt: '',
        },
        currentState: undefined,
      },
    ]

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect(mockGenerateRouterPrompt).toHaveBeenCalledWith(inputs.prompt, expectedTargetBlocks)
    expect(mockGetProviderFromModel).toHaveBeenCalledWith('gpt-4o')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        headers: expect.any(Object),
        body: expect.any(String),
      })
    )

    // Verify the request body contains the expected data
    const fetchCallArgs = mockFetch.mock.calls[0]
    const requestBody = JSON.parse(fetchCallArgs[1].body)
    expect(requestBody).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      systemPrompt: 'Generated System Prompt',
      context: JSON.stringify([{ role: 'user', content: 'Choose the best option.' }]),
      temperature: 0.5,
    })

    expect(result).toEqual({
      content: 'Choose the best option.',
      model: 'mock-model',
      tokens: { prompt: 100, completion: 5, total: 105 },
      cost: {
        input: 0,
        output: 0,
        total: 0,
      },
      selectedPath: {
        blockId: 'target-block-1',
        blockType: 'target',
        blockTitle: 'Option A',
      },
    })
  })

  it('should throw error if target block is missing', async () => {
    const inputs = { prompt: 'Test' }
    mockContext.workflow!.blocks = [mockBlock, mockTargetBlock2]

    // Expect execute to throw because getTargetBlocks (called internally) will throw
    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      'Target block target-block-1 not found'
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('should throw error if LLM response is not a valid target block ID', async () => {
    const inputs = { prompt: 'Test' }

    // Override fetch mock to return an invalid block ID
    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: 'invalid-block-id',
            model: 'mock-model',
            tokens: {},
            cost: 0,
            timing: {},
          }),
      })
    })

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      'Invalid routing decision: invalid-block-id'
    )
  })

  it('should use default model and temperature if not provided', async () => {
    const inputs = { prompt: 'Choose.' }

    await handler.execute(mockBlock, inputs, mockContext)

    expect(mockGetProviderFromModel).toHaveBeenCalledWith('gpt-4o')

    const fetchCallArgs = mockFetch.mock.calls[0]
    const requestBody = JSON.parse(fetchCallArgs[1].body)
    expect(requestBody).toMatchObject({
      model: 'gpt-4o',
      temperature: 0,
    })
  })

  it('should handle server error responses', async () => {
    const inputs = { prompt: 'Test error handling.' }

    // Override fetch mock to return an error
    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      })
    })

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow('Server error')
  })
})
