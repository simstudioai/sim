import '@sim/testing/mocks/executor'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockType, HTTP } from '@/executor/constants'
import { ResponseBlockHandler } from '@/executor/handlers/response/response-handler'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

vi.mock('@/executor/utils/builder-data', () => ({
  convertBuilderDataToJson: vi.fn(() => ({ key: 'value' })),
  convertBuilderDataToJsonString: vi.fn(() => '{"key":"value"}'),
}))

describe('ResponseBlockHandler', () => {
  let handler: ResponseBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext

  beforeEach(() => {
    vi.clearAllMocks()

    handler = new ResponseBlockHandler()

    mockBlock = {
      id: 'response-block-1',
      metadata: { id: BlockType.RESPONSE, name: 'Test Response Block' },
      position: { x: 0, y: 0 },
      config: { tool: BlockType.RESPONSE, params: {} },
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
  })

  it('should return true for response blocks', () => {
    expect(handler.canHandle(mockBlock)).toBe(true)
  })

  it('should return false for non-response blocks', () => {
    const nonResponseBlock: SerializedBlock = {
      ...mockBlock,
      metadata: { id: 'other-block' },
    }
    expect(handler.canHandle(nonResponseBlock)).toBe(false)
  })

  it('should execute with structured data and return correct shape', async () => {
    const inputs = {
      dataMode: 'structured',
      builderData: [{ id: '1', name: 'key', type: 'string', value: 'value' }],
      status: '200',
    }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(result.status).toBe(200)
    expect(result.data).toBeDefined()
    expect(result.headers).toHaveProperty('Content-Type')
  })

  it('should execute with json data mode and valid JSON string', async () => {
    const inputs = {
      dataMode: 'json',
      data: '{"message":"hello"}',
    }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(result.status).toBe(200)
    expect(result.data).toEqual({ message: 'hello' })
  })

  it('should execute with json data mode and object input', async () => {
    const inputs = {
      dataMode: 'json',
      data: { message: 'hello' },
    }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(result.data).toEqual({ message: 'hello' })
  })

  it('should handle malformed JSON data by returning original string', async () => {
    const inputs = {
      dataMode: 'json',
      data: '{invalid json}',
    }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(result.status).toBe(200)
    expect(result.data).toBe('{invalid json}')
  })

  it('should return default status 200 when no status provided', async () => {
    const inputs = { dataMode: 'json', data: '{}' }
    const result = await handler.execute(mockContext, mockBlock, inputs)
    expect(result.status).toBe(HTTP.STATUS.OK)
  })

  it('should return default empty object when no data provided', async () => {
    const inputs = {}
    const result = await handler.execute(mockContext, mockBlock, inputs)
    expect(result.data).toEqual({})
  })

  it('should return error response object on execution failure', async () => {
    const inputs = {
      dataMode: 'structured',
      builderData: [{ id: '1', name: 'key', type: 'string', value: 'value' }],
      status: '200',
    }

    const { convertBuilderDataToJson } = await import('@/executor/utils/builder-data')
    vi.mocked(convertBuilderDataToJson).mockImplementation(() => {
      throw new Error('Builder data conversion failed')
    })

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(result.status).toBe(500)
    expect(result.data).toHaveProperty('error')
    expect(result.data.message).toBe('Builder data conversion failed')
  })
})
