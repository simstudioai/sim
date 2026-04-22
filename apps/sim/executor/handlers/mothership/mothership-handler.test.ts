import '@sim/testing/mocks/executor'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockType } from '@/executor/constants'
import { MothershipBlockHandler } from '@/executor/handlers/mothership/mothership-handler'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const {
  mockBuildAuthHeaders,
  mockBuildAPIUrl,
  mockExtractAPIErrorMessage,
  mockGenerateId,
  mockIsExecutionCancelled,
  mockIsRedisCancellationEnabled,
} = vi.hoisted(() => ({
  mockBuildAuthHeaders: vi.fn(),
  mockBuildAPIUrl: vi.fn(),
  mockExtractAPIErrorMessage: vi.fn(),
  mockGenerateId: vi.fn(),
  mockIsExecutionCancelled: vi.fn(),
  mockIsRedisCancellationEnabled: vi.fn(),
}))

vi.mock('@/executor/utils/http', () => ({
  buildAuthHeaders: mockBuildAuthHeaders,
  buildAPIUrl: mockBuildAPIUrl,
  extractAPIErrorMessage: mockExtractAPIErrorMessage,
}))

vi.mock('@sim/utils/id', () => ({
  generateId: mockGenerateId,
}))

vi.mock('@/lib/execution/cancellation', () => ({
  isExecutionCancelled: mockIsExecutionCancelled,
  isRedisCancellationEnabled: mockIsRedisCancellationEnabled,
}))

function createAbortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

function createAbortableFetchPromise(signal?: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }

    signal?.addEventListener(
      'abort',
      () => {
        reject(createAbortError())
      },
      { once: true }
    )
  })
}

describe('MothershipBlockHandler', () => {
  let handler: MothershipBlockHandler
  let block: SerializedBlock
  let context: ExecutionContext
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    handler = new MothershipBlockHandler()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    mockBuildAuthHeaders.mockResolvedValue({ Authorization: 'Bearer internal' })
    mockBuildAPIUrl.mockReturnValue(new URL('/api/mothership/execute', 'http://localhost:3000'))
    mockExtractAPIErrorMessage.mockResolvedValue('boom')
    mockGenerateId.mockReset()
    mockIsExecutionCancelled.mockReset()
    mockIsRedisCancellationEnabled.mockReset()
    mockIsRedisCancellationEnabled.mockReturnValue(false)

    block = {
      id: 'mothership-block-1',
      metadata: { id: BlockType.MOTHERSHIP, name: 'Mothership' },
      position: { x: 0, y: 0 },
      config: { tool: BlockType.MOTHERSHIP, params: {} },
      inputs: { prompt: 'string' },
      outputs: {},
      enabled: true,
    } as SerializedBlock

    context = {
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
    } as ExecutionContext
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('forwards workflow and execution metadata with generated UUID ids', async () => {
    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: 'done',
          model: 'mothership',
          tokens: { total: 5 },
          toolCalls: [],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )

    const result = await handler.execute(context, block, { prompt: 'Hello from workflow' })

    expect(result).toEqual({
      content: 'done',
      model: 'mothership',
      tokens: { total: 5 },
      toolCalls: { list: [], count: 0 },
      cost: undefined,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/mothership/execute')
    expect(options.method).toBe('POST')
    expect(options.signal).toBeInstanceOf(AbortSignal)

    const body = JSON.parse(String(options.body))
    expect(body).toEqual({
      messages: [{ role: 'user', content: 'Hello from workflow' }],
      workspaceId: 'workspace-1',
      userId: 'user-1',
      chatId: 'chat-uuid',
      messageId: 'message-uuid',
      requestId: 'request-uuid',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
  })

  it('propagates local aborts to the mothership request', async () => {
    const abortController = new AbortController()
    context.abortSignal = abortController.signal

    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    fetchMock.mockImplementation((_url: string, options?: RequestInit) =>
      createAbortableFetchPromise(options?.signal as AbortSignal | undefined)
    )

    const executionPromise = handler.execute(context, block, { prompt: 'Abort me' })
    const abortedExecution = executionPromise.catch((error) => error)

    abortController.abort()

    await expect(abortedExecution).resolves.toMatchObject({ name: 'AbortError' })
  })

  it('propagates durable workflow cancellation to the mothership request', async () => {
    vi.useFakeTimers()

    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')
    mockIsRedisCancellationEnabled.mockReturnValue(true)
    mockIsExecutionCancelled.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    fetchMock.mockImplementation((_url: string, options?: RequestInit) =>
      createAbortableFetchPromise(options?.signal as AbortSignal | undefined)
    )

    const executionPromise = handler.execute(context, block, { prompt: 'Cancel me durably' })
    const abortedExecution = executionPromise.catch((error) => error)

    await vi.advanceTimersByTimeAsync(1000)

    await expect(abortedExecution).resolves.toMatchObject({ name: 'AbortError' })
    expect(mockIsExecutionCancelled).toHaveBeenCalledWith('execution-1')
  })
})
