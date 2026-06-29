import '@sim/testing/mocks/executor'

import { urlsMock, urlsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { BlockType } from '@/executor/constants'
import { HumanInTheLoopBlockHandler } from '@/executor/handlers/human-in-the-loop/human-in-the-loop-handler'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'

vi.mock('@/lib/core/utils/urls', () => urlsMock)

const { mockGeneratePauseContextId, mockMapNodeMetadataToPauseScopes } = vi.hoisted(() => ({
  mockGeneratePauseContextId: vi.fn(() => 'test-pause-context-id'),
  mockMapNodeMetadataToPauseScopes: vi.fn(() => ({
    parallelScope: undefined,
    loopScope: undefined,
  })),
}))

vi.mock('@/executor/human-in-the-loop/utils', () => ({
  generatePauseContextId: mockGeneratePauseContextId,
  mapNodeMetadataToPauseScopes: mockMapNodeMetadataToPauseScopes,
}))

vi.mock('@/executor/utils/builder-data', () => ({
  convertBuilderDataToJson: vi.fn(() => ({ key: 'value' })),
  convertPropertyValue: vi.fn((prop: any) => prop.value),
}))

vi.mock('@/executor/utils/block-data', () => ({
  collectBlockData: vi.fn(() => ({
    blockData: {},
    blockNameMapping: {},
  })),
}))

const mockExecuteTool = executeTool as Mock

describe('HumanInTheLoopBlockHandler', () => {
  let handler: HumanInTheLoopBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext

  beforeEach(() => {
    vi.clearAllMocks()

    handler = new HumanInTheLoopBlockHandler()

    mockBlock = {
      id: 'hitl-block-1',
      metadata: { id: BlockType.HUMAN_IN_THE_LOOP, name: 'Test HITL Block' },
      position: { x: 0, y: 0 },
      config: { tool: BlockType.HUMAN_IN_THE_LOOP, params: {} },
      inputs: {},
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

    urlsMockFns.mockGetBaseUrl.mockReturnValue('http://localhost:3000')
    mockExecuteTool.mockResolvedValue({ success: true, output: {} })
    mockGeneratePauseContextId.mockReturnValue('test-pause-context-id')
    mockMapNodeMetadataToPauseScopes.mockReturnValue({
      parallelScope: undefined,
      loopScope: undefined,
    })
  })

  it('should return true for human-in-the-loop blocks', () => {
    expect(handler.canHandle(mockBlock)).toBe(true)
  })

  it('should return false for non-hitl blocks', () => {
    const nonHitlBlock: SerializedBlock = {
      ...mockBlock,
      metadata: { id: 'other-block' },
    }
    expect(handler.canHandle(nonHitlBlock)).toBe(false)
  })

  it('should execute with human operation and return correct response shape', async () => {
    const inputs = {
      operation: 'human',
      inputFormat: [{ id: 'field-1', name: 'username', label: 'Username', type: 'string' }],
      builderData: [{ id: '1', name: 'result', type: 'string', value: 'test' }],
    }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(result.response).toBeDefined()
    expect(result.response.status).toBe(200)
    expect(result.response.headers).toHaveProperty('Content-Type')
    expect(result.response.data).toHaveProperty('operation', 'human')
    expect(result.response.data).toHaveProperty('responseStructure')
    expect(result.response.data).toHaveProperty('inputFormat')
    expect(result.response.data).toHaveProperty('submission', null)
    expect(result._pauseMetadata).toBeDefined()
    expect(result._pauseMetadata.pauseKind).toBe('human')
  })

  it('should handle malformed JSON data in api operation mode', async () => {
    const inputs = {
      operation: 'api',
      dataMode: 'json',
      data: '{invalid json}',
    }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(result).toBeDefined()
    expect(result.response).toBeDefined()
    expect(result.response.data).toBe('{invalid json}')
  })

  it('should handle valid JSON data in api operation mode', async () => {
    const inputs = {
      operation: 'api',
      dataMode: 'json',
      data: '{"message":"hello"}',
    }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(result.response.data).toMatchObject({ message: 'hello' })
  })

  it('should return error response on execution failure', async () => {
    const inputs = {
      operation: 'human',
      inputFormat: 'not-an-array',
      builderData: 'not-an-array',
    }

    mockMapNodeMetadataToPauseScopes.mockImplementation(() => {
      throw new Error('Metadata mapping failed')
    })

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(result.response).toBeDefined()
    expect(result.response.status).toBe(500)
    expect(result.response.data).toHaveProperty('error')
    expect(result.response.data.message).toBe('Metadata mapping failed')
  })

  it('should include resume links when executionId and workflowId exist', async () => {
    const contextWithExecution: ExecutionContext = {
      ...mockContext,
      executionId: 'exec-123',
    }

    const inputs = {
      operation: 'human',
      inputFormat: [],
    }

    const result = await handler.execute(contextWithExecution, mockBlock, inputs)

    expect(result.response.data._resume).toBeDefined()
    expect(result.url).toBeDefined()
    expect(result.resumeEndpoint).toBeDefined()
  })
})
