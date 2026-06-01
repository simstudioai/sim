import '@sim/testing/mocks/executor'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockType } from '@/executor/constants'
import { MothershipBlockHandler } from '@/executor/handlers/mothership/mothership-handler'
import type { ExecutionContext, StreamingExecution } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const {
  mockBuildAuthHeaders,
  mockBuildAPIUrl,
  mockExtractAPIErrorMessage,
  mockGenerateId,
  mockIsExecutionCancelled,
  mockIsRedisCancellationEnabled,
  mockReadUserFileContent,
} = vi.hoisted(() => ({
  mockBuildAuthHeaders: vi.fn(),
  mockBuildAPIUrl: vi.fn(),
  mockExtractAPIErrorMessage: vi.fn(),
  mockGenerateId: vi.fn(),
  mockIsExecutionCancelled: vi.fn(),
  mockIsRedisCancellationEnabled: vi.fn(),
  mockReadUserFileContent: vi.fn(),
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

vi.mock('@/lib/execution/payloads/materialization.server', () => ({
  readUserFileContent: mockReadUserFileContent,
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

async function readStreamText(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }

  text += decoder.decode()
  reader.releaseLock()
  return text
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
    mockReadUserFileContent.mockReset()

    block = {
      id: 'mothership-block-1',
      metadata: { id: BlockType.MOTHERSHIP, name: 'Mothership' },
      position: { x: 0, y: 0 },
      config: { tool: BlockType.MOTHERSHIP, params: {} },
      inputs: { prompt: 'string', conversationId: 'string', files: 'file[]' },
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

  function createNdjsonResponse(events: unknown[]): Response {
    const encoder = new TextEncoder()
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const event of events) {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
          }
          controller.close()
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
      }
    )
  }

  it('forwards workflow and execution metadata with generated UUID ids', async () => {
    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: 'done',
          model: 'mothership',
          conversationId: 'chat-uuid',
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
      conversationId: 'chat-uuid',
      tokens: { total: 5 },
      toolCalls: { list: [], count: 0 },
      cost: undefined,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/mothership/execute')
    expect(options.method).toBe('POST')
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(options.headers).toMatchObject({
      Accept: 'application/x-ndjson',
      'X-Mothership-Execute-Stream': 'ndjson',
    })

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

  it('uses a provided conversation ID as the mothership chat ID', async () => {
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: 'continued',
          model: 'mothership',
          conversationId: 'existing-chat-id',
          tokens: {},
          toolCalls: [],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )

    const result = await handler.execute(context, block, {
      prompt: 'Continue this thread',
      conversationId: ' existing-chat-id ',
    })

    expect(result).toEqual({
      content: 'continued',
      model: 'mothership',
      conversationId: 'existing-chat-id',
      tokens: {},
      toolCalls: { list: [], count: 0 },
      cost: undefined,
    })

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body))
    expect(body).toEqual({
      messages: [{ role: 'user', content: 'Continue this thread' }],
      workspaceId: 'workspace-1',
      userId: 'user-1',
      chatId: 'existing-chat-id',
      messageId: 'message-uuid',
      requestId: 'request-uuid',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
    expect(mockGenerateId).toHaveBeenCalledTimes(2)
  })

  it('consumes mothership execute heartbeat streams until the final result', async () => {
    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    fetchMock.mockResolvedValue(
      createNdjsonResponse([
        { type: 'heartbeat', timestamp: '2026-05-15T18:13:48.000Z' },
        {
          type: 'final',
          data: {
            content: 'streamed done',
            model: 'mothership',
            conversationId: 'chat-uuid',
            tokens: { total: 7 },
            toolCalls: [{ name: 'tool_a', params: { a: 1 }, result: 'ok', durationMs: 42 }],
            cost: { total: 0.1 },
          },
        },
      ])
    )

    const result = await handler.execute(context, block, { prompt: 'Hello from workflow' })

    expect(result).toEqual({
      content: 'streamed done',
      model: 'mothership',
      conversationId: 'chat-uuid',
      tokens: { total: 7 },
      toolCalls: {
        list: [
          {
            name: 'tool_a',
            arguments: { a: 1 },
            result: 'ok',
            error: undefined,
            duration: 42,
          },
        ],
        count: 1,
      },
      cost: { total: 0.1 },
    })
  })

  it('surfaces mothership execute stream errors', async () => {
    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    fetchMock.mockResolvedValue(
      createNdjsonResponse([
        { type: 'heartbeat', timestamp: '2026-05-15T18:13:48.000Z' },
        { type: 'error', error: 'Mothership execution aborted' },
      ])
    )

    await expect(
      handler.execute(context, block, { prompt: 'Hello from workflow' })
    ).rejects.toThrow('Mothership execution failed: Mothership execution aborted')
  })

  it('streams mothership assistant chunks and preserves final metadata', async () => {
    context.stream = true
    context.selectedOutputs = [`${block.id}_content`]
    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    fetchMock.mockResolvedValue(
      createNdjsonResponse([
        { type: 'heartbeat', timestamp: '2026-05-15T18:13:48.000Z' },
        { type: 'chunk', content: 'Hello' },
        { type: 'heartbeat', timestamp: '2026-05-15T18:14:03.000Z' },
        { type: 'chunk', content: ' world' },
        {
          type: 'final',
          data: {
            content: 'Hello world',
            model: 'mothership',
            conversationId: 'chat-uuid',
            tokens: { total: 7 },
            toolCalls: [{ name: 'tool_a', params: { a: 1 }, result: 'ok', durationMs: 42 }],
            cost: { total: 0.1 },
          },
        },
      ])
    )

    const result = await handler.execute(context, block, { prompt: 'Hello from workflow' })
    expect(result).toHaveProperty('stream')

    const streamingExecution = result as StreamingExecution
    await expect(readStreamText(streamingExecution.stream)).resolves.toBe('Hello world')
    expect(streamingExecution.execution.output).toEqual({
      content: 'Hello world',
      model: 'mothership',
      conversationId: 'chat-uuid',
      tokens: { total: 7 },
      toolCalls: {
        list: [
          {
            name: 'tool_a',
            arguments: { a: 1 },
            result: 'ok',
            error: undefined,
            duration: 42,
          },
        ],
        count: 1,
      },
      cost: { total: 0.1 },
    })
  })

  it('surfaces mothership streaming errors while streaming selected content', async () => {
    context.stream = true
    context.selectedOutputs = [`${block.id}_content`]
    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    fetchMock.mockResolvedValue(
      createNdjsonResponse([
        { type: 'chunk', content: 'partial' },
        { type: 'error', error: 'Mothership execution aborted' },
      ])
    )

    const result = (await handler.execute(context, block, {
      prompt: 'Hello from workflow',
    })) as StreamingExecution

    await expect(readStreamText(result.stream)).rejects.toThrow(
      'Mothership execution failed: Mothership execution aborted'
    )
  })

  it('embeds attached files for the mothership execute request', async () => {
    const fileContent = Buffer.from('hello mothership', 'utf8').toString('base64')
    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')
    mockReadUserFileContent.mockResolvedValueOnce(fileContent)

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: 'analyzed',
          model: 'mothership',
          conversationId: 'chat-uuid',
          tokens: {},
          toolCalls: [],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )

    const result = await handler.execute(context, block, {
      prompt: 'Analyze this file',
      files: [
        {
          name: 'notes.txt',
          key: 'workspace/workspace-1/notes.txt',
          size: 16,
          type: 'text/plain',
        },
      ],
    })

    expect(result).toMatchObject({
      content: 'analyzed',
      model: 'mothership',
      conversationId: 'chat-uuid',
    })
    expect(mockReadUserFileContent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^file-/),
        key: 'workspace/workspace-1/notes.txt',
        name: 'notes.txt',
        url: '',
        size: 16,
        type: 'text/plain',
      }),
      expect.objectContaining({
        encoding: 'base64',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        requestId: 'request-uuid',
      })
    )

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body))
    expect(body.fileAttachments).toEqual([
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'text/plain',
          data: fileContent,
        },
        filename: 'notes.txt',
      },
    ])
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

  it('aborts the mothership request when selected-output streaming is cancelled', async () => {
    context.stream = true
    context.selectedOutputs = [`${block.id}_content`]

    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    let fetchSignal: AbortSignal | undefined
    fetchMock.mockImplementation((_url: string, options?: RequestInit) => {
      fetchSignal = options?.signal as AbortSignal | undefined
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start() {},
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
          }
        )
      )
    })

    const result = (await handler.execute(context, block, { prompt: 'Cancel stream' })) as
      | StreamingExecution
      | undefined

    await result?.stream.cancel('client_cancelled')

    expect(fetchSignal?.aborted).toBe(true)
  })
})
