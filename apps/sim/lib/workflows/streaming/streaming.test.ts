/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readSSEStream } from '@/lib/core/utils/sse'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import {
  agentStreamProtocolResponseHeaders,
  createStreamingResponse,
} from '@/lib/workflows/streaming/streaming'

const { mockDownloadFile } = vi.hoisted(() => ({
  mockDownloadFile: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: {
    downloadFile: mockDownloadFile,
  },
}))

const manifestChunk = [{ id: 1 }]
const manifestChunkBytes = Buffer.byteLength(JSON.stringify(manifestChunk), 'utf8')
const manifest = {
  __simLargeArrayManifest: true,
  version: 2,
  kind: 'array',
  totalCount: 1,
  chunkCount: 1,
  byteSize: manifestChunkBytes,
  chunks: [
    {
      ref: {
        __simLargeValueRef: true,
        version: 1,
        id: 'lv_ABCDEFGHIJKL',
        kind: 'array',
        size: manifestChunkBytes,
        key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_ABCDEFGHIJKL.json',
        executionId: 'execution-1',
      },
      count: 1,
      byteSize: manifestChunkBytes,
    },
  ],
  preview: [{ id: 1 }],
}

async function collectSSEEvents(
  stream: ReadableStream<Uint8Array>
): Promise<Record<string, unknown>[]> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const events: Record<string, unknown>[] = []
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        break
      }
      buffer += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }

  for (const chunk of buffer.split('\n\n')) {
    if (!chunk.startsWith('data: ')) {
      continue
    }
    const payload = chunk.substring(6)
    if (payload === '[DONE]') {
      continue
    }
    const event = JSON.parse(payload) as unknown
    if (event === '[DONE]') {
      continue
    }
    events.push(event as Record<string, unknown>)
  }

  return events
}

describe('createStreamingResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLargeValueCacheForTests()
  })

  it('extracts block-level selected outputs from JSON content payloads', async () => {
    const output = { content: JSON.stringify({ answer: 'ok' }) }
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      executionId: 'execution-1',
      streamConfig: {
        selectedOutputs: ['block'],
        includeFileBase64: false,
      },
      executeFn: async ({ onBlockComplete }) => {
        await onBlockComplete('block', output)
        return {
          success: true,
          output: {},
          logs: [
            {
              blockId: 'block',
              output,
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 1,
              success: true,
            },
          ],
        } as any
      },
    })

    await expect(readSSEStream(stream)).resolves.toBe(JSON.stringify({ answer: 'ok' }, null, 2))
  })

  it('extracts selected outputs from JSON content payloads', async () => {
    const output = { content: JSON.stringify({ answer: 'ok' }) }
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      executionId: 'execution-1',
      streamConfig: {
        selectedOutputs: ['block_answer'],
        includeFileBase64: false,
      },
      executeFn: async ({ onBlockComplete }) => {
        await onBlockComplete('block', output)
        return {
          success: true,
          output: {},
          logs: [
            {
              blockId: 'block',
              output,
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 1,
              success: true,
            },
          ],
        } as any
      },
    })

    await expect(readSSEStream(stream)).resolves.toBe('ok')
  })

  it('auto-materializes whole manifest selected outputs under the inline cap', async () => {
    mockDownloadFile.mockResolvedValue(Buffer.from(JSON.stringify(manifestChunk), 'utf8'))
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      executionId: 'execution-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      streamConfig: {
        selectedOutputs: ['block_issues'],
        includeFileBase64: false,
      },
      executeFn: async ({ onBlockComplete }) => {
        const output = { issues: manifest }
        await onBlockComplete('block', output)
        return {
          success: true,
          output: {},
          logs: [
            {
              blockId: 'block',
              output,
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 1,
              success: true,
            },
          ],
        } as any
      },
    })

    await expect(readSSEStream(stream)).resolves.toBe(JSON.stringify(manifestChunk, null, 2))
  })

  it('auto-materializes whole-block selected outputs containing manifests', async () => {
    mockDownloadFile.mockResolvedValue(Buffer.from(JSON.stringify(manifestChunk), 'utf8'))
    const output = { issues: manifest }
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      executionId: 'execution-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      streamConfig: {
        selectedOutputs: ['block'],
        includeFileBase64: true,
      },
      executeFn: async ({ onBlockComplete }) => {
        await onBlockComplete('block', output)
        return {
          success: true,
          output: {},
          logs: [
            {
              blockId: 'block',
              output,
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 1,
              success: true,
            },
          ],
        } as any
      },
    })

    await expect(readSSEStream(stream)).resolves.toBe(
      JSON.stringify({ issues: manifestChunk }, null, 2)
    )
    expect(mockDownloadFile).toHaveBeenCalled()
  })

  it('inlines materialized selected outputs without recompacting them into refs', async () => {
    const largeString = 'x'.repeat(8 * 1024 * 1024 + 1)
    const largeStringJson = JSON.stringify(largeString)
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_LARGESTRING1',
      kind: 'string',
      size: Buffer.byteLength(largeStringJson, 'utf8'),
      key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_LARGESTRING1.json',
      executionId: 'execution-1',
    }
    mockDownloadFile.mockResolvedValue(Buffer.from(largeStringJson, 'utf8'))

    const stream = await createStreamingResponse({
      requestId: 'request-1',
      executionId: 'execution-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      streamConfig: {
        selectedOutputs: ['block_text'],
        includeFileBase64: false,
      },
      executeFn: async ({ onBlockComplete }) => {
        const output = { text: ref }
        await onBlockComplete('block', output)
        return {
          success: true,
          output: {},
          logs: [
            {
              blockId: 'block',
              output,
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 1,
              success: true,
            },
          ],
        } as any
      },
    })

    const streamed = await readSSEStream(stream)
    expect(streamed).toHaveLength(largeString.length)
    expect(streamed).not.toContain('__simLargeValueRef')
  })

  it('deduplicates repeated equivalent selected outputs before streaming', async () => {
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      executionId: 'execution-1',
      streamConfig: {
        selectedOutputs: ['block_text', 'block.text', 'block_text'],
        includeFileBase64: false,
      },
      executeFn: async ({ onBlockComplete }) => {
        const output = { text: 'ok' }
        await onBlockComplete('block', output)
        return {
          success: true,
          output: {},
          logs: [
            {
              blockId: 'block',
              output,
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 1,
              success: true,
            },
          ],
        } as any
      },
    })

    const events = await collectSSEEvents(stream)
    const chunkEvents = events.filter((event) => 'chunk' in event)
    expect(chunkEvents).toHaveLength(1)
    expect(chunkEvents[0]).toMatchObject({ blockId: 'block', chunk: 'ok' })
  })

  it('fails when distinct selected outputs aggregate over the inline cap', async () => {
    const largeString = 'x'.repeat(9 * 1024 * 1024)
    const largeStringJson = JSON.stringify(largeString)
    const largeStringBytes = Buffer.byteLength(largeStringJson, 'utf8')
    const firstRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_MULTIREF0001',
      kind: 'string',
      size: largeStringBytes,
      key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_MULTIREF0001.json',
      executionId: 'execution-1',
    }
    const secondRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_MULTIREF0002',
      kind: 'string',
      size: largeStringBytes,
      key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_MULTIREF0002.json',
      executionId: 'execution-1',
    }
    mockDownloadFile.mockImplementation(async ({ key }) => {
      if (key === firstRef.key || key === secondRef.key) {
        return Buffer.from(largeStringJson, 'utf8')
      }
      throw new Error(`Unexpected key: ${key}`)
    })

    const stream = await createStreamingResponse({
      requestId: 'request-1',
      executionId: 'execution-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      streamConfig: {
        selectedOutputs: ['block_first', 'block_second'],
        includeFileBase64: false,
      },
      executeFn: async ({ onBlockComplete }) => {
        const output = { first: firstRef, second: secondRef }
        await onBlockComplete('block', output)
        return {
          success: true,
          output: {},
          logs: [
            {
              blockId: 'block',
              output,
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 1,
              success: true,
            },
          ],
        } as any
      },
    })

    const events = await collectSSEEvents(stream)
    expect(events).toContainEqual({
      event: 'error',
      blockId: 'block',
      error:
        'Selected output is too large to inline; select a nested field or use pagination/preview.',
    })
    expect(events.some((event) => event.event === 'final')).toBe(false)
  })

  it('accounts escaped string JSON bytes against the aggregate selected-output cap', async () => {
    const first = '\\'.repeat(Math.floor((16 * 1024 * 1024 - 2) / 2))
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      executionId: 'execution-1',
      streamConfig: {
        selectedOutputs: ['block_first', 'block_second'],
        includeFileBase64: false,
      },
      executeFn: async ({ onBlockComplete }) => {
        const output = { first, second: 'ok' }
        await onBlockComplete('block', output)
        return {
          success: true,
          output: {},
          logs: [
            {
              blockId: 'block',
              output,
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 1,
              success: true,
            },
          ],
        } as any
      },
    })

    const events = await collectSSEEvents(stream)
    expect(events).toContainEqual({
      event: 'error',
      blockId: 'block',
      error:
        'Selected output is too large to inline; select a nested field or use pagination/preview.',
    })
    expect(events.some((event) => event.event === 'final')).toBe(false)
  })

  it('fails when nested refs aggregate over the inline selected-output cap', async () => {
    const largeString = 'x'.repeat(9 * 1024 * 1024)
    const largeStringJson = JSON.stringify(largeString)
    const largeStringBytes = Buffer.byteLength(largeStringJson, 'utf8')
    const nestedRefA = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_NESTEDREF001',
      kind: 'string',
      size: largeStringBytes,
      key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_NESTEDREF001.json',
      executionId: 'execution-1',
    }
    const nestedRefB = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_NESTEDREF002',
      kind: 'string',
      size: largeStringBytes,
      key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_NESTEDREF002.json',
      executionId: 'execution-1',
    }
    const nestedChunk = [nestedRefA, nestedRefB]
    const nestedChunkBytes = Buffer.byteLength(JSON.stringify(nestedChunk), 'utf8')
    const nestedManifest = {
      ...manifest,
      totalCount: 2,
      byteSize: nestedChunkBytes,
      chunks: [
        {
          ref: {
            ...manifest.chunks[0].ref,
            size: nestedChunkBytes,
          },
          count: 2,
          byteSize: nestedChunkBytes,
        },
      ],
      preview: [],
    }
    mockDownloadFile.mockImplementation(async ({ key }) => {
      if (key === nestedManifest.chunks[0].ref.key) {
        return Buffer.from(JSON.stringify(nestedChunk), 'utf8')
      }
      if (key === nestedRefA.key) {
        return Buffer.from(largeStringJson, 'utf8')
      }
      if (key === nestedRefB.key) {
        return Buffer.from(largeStringJson, 'utf8')
      }
      throw new Error(`Unexpected key: ${key}`)
    })

    const stream = await createStreamingResponse({
      requestId: 'request-1',
      executionId: 'execution-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      streamConfig: {
        selectedOutputs: ['block_issues'],
        includeFileBase64: false,
      },
      executeFn: async ({ onBlockComplete }) => {
        const output = { issues: nestedManifest }
        await onBlockComplete('block', output)
        return {
          success: true,
          output: {},
          logs: [
            {
              blockId: 'block',
              output,
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 1,
              success: true,
            },
          ],
        } as any
      },
    })

    const events = await collectSSEEvents(stream)
    expect(events).toContainEqual({
      event: 'error',
      blockId: 'block',
      error:
        'Selected output is too large to inline; select a nested field or use pagination/preview.',
    })
    expect(events.some((event) => event.event === 'final')).toBe(false)
    expect(JSON.stringify(events)).not.toContain('__simLargeValueRef')
  })

  it('fails clearly instead of streaming raw manifest internals when selected output is over cap', async () => {
    const oversizedManifest = {
      ...manifest,
      byteSize: 16 * 1024 * 1024 + 1,
      chunks: [
        {
          ...manifest.chunks[0],
          ref: {
            ...manifest.chunks[0].ref,
            size: 16 * 1024 * 1024 + 1,
          },
          byteSize: 16 * 1024 * 1024 + 1,
        },
      ],
    }
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      executionId: 'execution-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      streamConfig: {
        selectedOutputs: ['block_issues'],
        includeFileBase64: false,
      },
      executeFn: async ({ onBlockComplete }) => {
        const output = { issues: oversizedManifest }
        await onBlockComplete('block', output)
        return {
          success: true,
          output: {},
          logs: [
            {
              blockId: 'block',
              output,
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 1,
              success: true,
            },
          ],
        } as any
      },
    })

    const events = await collectSSEEvents(stream)
    expect(events).toContainEqual({
      event: 'error',
      blockId: 'block',
      error:
        'Selected output is too large to inline; select a nested field or use pagination/preview.',
    })
    expect(events.some((event) => event.event === 'final')).toBe(false)
    expect(JSON.stringify(events)).not.toContain('__simLargeArrayManifest')
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  it('uses live large-value keys for selected-output materialization', async () => {
    const largeValueKeys: string[] = []
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_MNOPQRSTUVWX',
      kind: 'object',
      size: 15,
      key: 'execution/workspace-1/workflow-1/source-execution/large-value-lv_MNOPQRSTUVWX.json',
      executionId: 'source-execution',
    }
    mockDownloadFile.mockResolvedValue(Buffer.from(JSON.stringify({ nested: 'ok' }), 'utf8'))

    const stream = await createStreamingResponse({
      requestId: 'request-1',
      executionId: 'execution-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      largeValueKeys,
      streamConfig: {
        selectedOutputs: ['block.value.nested'],
      },
      executeFn: async ({ onBlockComplete }) => {
        largeValueKeys.push(ref.key)
        await onBlockComplete('block', { value: ref })
        return {
          success: true,
          output: {},
          logs: [
            {
              blockId: 'block',
              output: { value: ref },
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 1,
              success: true,
            },
          ],
        } as any
      },
    })

    await expect(readSSEStream(stream)).resolves.toBe('ok')
  })
})

describe('agent stream protocol response headers', () => {
  const requestHeaders = new Headers({
    'x-sim-stream-protocol': 'agent-events-v1',
  })

  it('activates for either independent deployment policy', () => {
    expect(
      agentStreamProtocolResponseHeaders({
        includeThinking: true,
        includeToolCalls: false,
        requestHeaders,
      })
    ).toEqual({ 'x-sim-stream-protocol': 'agent-events-v1' })
    expect(
      agentStreamProtocolResponseHeaders({
        includeThinking: false,
        includeToolCalls: true,
        requestHeaders,
      })
    ).toEqual({ 'x-sim-stream-protocol': 'agent-events-v1' })
  })

  it('stays inactive when both policies are off', () => {
    expect(
      agentStreamProtocolResponseHeaders({
        includeThinking: false,
        includeToolCalls: false,
        requestHeaders,
      })
    ).toEqual({})
  })
})

describe('createStreamingResponse agent-events-v1', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLargeValueCacheForTests()
  })

  function createAgentStreamExecuteFn(options: {
    thinking?: string[]
    answer: string
    fail?: boolean
    tools?: Array<
      | { type: 'tool_call_start'; id: string; name: string; args?: unknown }
      | {
          type: 'tool_call_end'
          id: string
          name: string
          status: string
          result?: unknown
        }
    >
  }) {
    return async ({
      onStream,
      abortSignal,
    }: {
      onStream: (streamingExec: any) => Promise<void>
      onBlockComplete: (blockId: string, output: unknown) => Promise<void>
      abortSignal: AbortSignal
    }) => {
      let textController!: ReadableStreamDefaultController<Uint8Array>
      let sink: { onEvent: (event: unknown) => void | Promise<void> } | undefined
      const textStream = new ReadableStream<Uint8Array>({
        start(controller) {
          textController = controller
        },
      })

      const onStreamPromise = onStream({
        stream: textStream,
        streamFormat: 'text',
        subscribe: (nextSink: { onEvent: (event: unknown) => void | Promise<void> }) => {
          sink = nextSink
          return () => {
            sink = undefined
          }
        },
        execution: {
          blockId: 'agent-1',
          success: true,
          output: { content: options.answer },
          logs: [],
          metadata: {},
        },
      })

      if (options.fail) {
        textController.error(new Error('provider reset'))
        await onStreamPromise.catch(() => {})
        throw new Error('provider reset')
      }

      for (const text of options.thinking ?? []) {
        await sink?.onEvent({ type: 'thinking_delta', text })
      }
      for (const toolEvent of options.tools ?? []) {
        await sink?.onEvent(toolEvent)
      }
      // Mirror the pump: text dispatches to the sink first, then projects to bytes.
      await sink?.onEvent({ type: 'text_delta', text: options.answer, turn: 'final' })
      textController.enqueue(new TextEncoder().encode(options.answer))
      textController.close()
      await onStreamPromise

      expect(abortSignal).toBeDefined()

      return {
        success: true,
        output: { content: options.answer },
        logs: [
          {
            blockId: 'agent-1',
            output: { content: '' },
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: 1,
            success: true,
          },
        ],
      } as any
    }
  }

  async function collectSSEPayloads(stream: ReadableStream<Uint8Array>): Promise<string[]> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        break
      }
      buffer += decoder.decode(value, { stream: true })
    }
    return buffer
      .split('\n\n')
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.startsWith('data: '))
      .map((chunk) => chunk.slice(6))
  }

  it('legacy path without protocol header stays text-only', async () => {
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      streamConfig: {
        includeThinking: true,
        includeToolCalls: true,
        selectedOutputs: ['agent-1_content'],
      },
      // No requestHeaders → gate closed
      executeFn: createAgentStreamExecuteFn({
        thinking: ['secret thought'],
        answer: 'Hello',
        tools: [{ type: 'tool_call_start', id: 'toolu_1', name: 'get_weather' }],
      }),
    })

    const events = await collectSSEEvents(stream)
    expect(events.some((event) => event.event === 'thinking')).toBe(false)
    expect(events.some((event) => event.event === 'tool')).toBe(false)
    expect(events).toContainEqual({ blockId: 'agent-1', chunk: 'Hello' })
    expect(events.some((event) => event.event === 'final')).toBe(true)
  })

  it('header + includeThinking emits thinking on data and answer on chunk', async () => {
    const headers = new Headers({
      'x-sim-stream-protocol': 'agent-events-v1',
    })
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      requestHeaders: headers,
      streamConfig: {
        includeThinking: true,
        includeToolCalls: false,
        selectedOutputs: ['agent-1_content'],
      },
      executeFn: createAgentStreamExecuteFn({
        thinking: ['hmm ', 'yes'],
        answer: 'Answer',
      }),
    })

    const events = await collectSSEEvents(stream)
    expect(events.filter((event) => event.event === 'thinking')).toEqual([
      { blockId: 'agent-1', event: 'thinking', data: 'hmm ' },
      { blockId: 'agent-1', event: 'thinking', data: 'yes' },
    ])
    expect(events).toContainEqual({ blockId: 'agent-1', chunk: 'Answer' })
    expect(events.some((event) => event.event === 'final')).toBe(true)
  })

  it('includeToolCalls emits tool start/end frames without exposing args or results', async () => {
    const headers = new Headers({
      'x-sim-stream-protocol': 'agent-events-v1',
    })
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      requestHeaders: headers,
      streamConfig: {
        includeThinking: false,
        includeToolCalls: true,
        selectedOutputs: ['agent-1_content'],
      },
      executeFn: createAgentStreamExecuteFn({
        answer: 'Done',
        tools: [
          {
            type: 'tool_call_start',
            id: 'toolu_1',
            name: 'get_weather',
            args: { city: 'private' },
          },
          {
            type: 'tool_call_end',
            id: 'toolu_1',
            name: 'get_weather',
            status: 'success',
            result: { temperature: 72 },
          },
        ],
      }),
    })

    const events = await collectSSEEvents(stream)
    expect(events.filter((event) => event.event === 'tool')).toEqual([
      {
        blockId: 'agent-1',
        event: 'tool',
        phase: 'start',
        id: 'toolu_1',
        name: 'get_weather',
      },
      {
        blockId: 'agent-1',
        event: 'tool',
        phase: 'end',
        id: 'toolu_1',
        name: 'get_weather',
        status: 'success',
      },
    ])
    expect(events).toContainEqual({ blockId: 'agent-1', chunk: 'Done' })
    expect(
      events.some(
        (event) =>
          typeof event.chunk === 'string' &&
          (String(event.chunk).includes('toolu_1') || String(event.chunk).includes('get_weather'))
      )
    ).toBe(false)
  })

  it('tool-only policy streams pending text live and resets intermediate turns', async () => {
    const headers = new Headers({
      'x-sim-stream-protocol': 'agent-events-v1',
    })
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      requestHeaders: headers,
      streamConfig: {
        includeThinking: false,
        includeToolCalls: true,
        selectedOutputs: ['agent-1_content'],
      },
      executeFn: async ({ onStream }) => {
        let textController!: ReadableStreamDefaultController<Uint8Array>
        let sink: { onEvent: (event: unknown) => void | Promise<void> } | undefined
        const textStream = new ReadableStream<Uint8Array>({
          start(controller) {
            textController = controller
          },
        })

        const onStreamPromise = onStream({
          stream: textStream,
          streamFormat: 'text',
          subscribe: (nextSink: { onEvent: (event: unknown) => void | Promise<void> }) => {
            sink = nextSink
            return () => {}
          },
          execution: {
            blockId: 'agent-1',
            success: true,
            output: { content: 'Final answer' },
            logs: [],
            metadata: {},
          },
        } as any)

        // Turn 1: live preamble, then tools follow → intermediate turn_end.
        await sink?.onEvent({ type: 'text_delta', text: 'Checking…', turn: 'pending' })
        await sink?.onEvent({ type: 'tool_call_start', id: 'toolu_1', name: 'get_weather' })
        await sink?.onEvent({ type: 'turn_end', turn: 'intermediate' })
        await sink?.onEvent({
          type: 'tool_call_end',
          id: 'toolu_1',
          name: 'get_weather',
          status: 'success',
        })
        // Turn 2: live final answer; pump projects it to bytes at turn_end.
        await sink?.onEvent({ type: 'text_delta', text: 'Final ', turn: 'pending' })
        await sink?.onEvent({ type: 'text_delta', text: 'answer', turn: 'pending' })
        await sink?.onEvent({ type: 'turn_end', turn: 'final' })
        textController.enqueue(new TextEncoder().encode('Final answer'))
        textController.close()
        await onStreamPromise

        return {
          success: true,
          output: { content: 'Final answer' },
          logs: [
            {
              blockId: 'agent-1',
              output: { content: '' },
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 1,
              success: true,
            },
          ],
        } as any
      },
    })

    const events = await collectSSEEvents(stream)

    // Live text arrives as chunk frames in stream order, with a reset between turns.
    const answerFlow = events
      .filter((event) => event.chunk !== undefined || event.event === 'chunk_reset')
      .map((event) => (event.event === 'chunk_reset' ? 'RESET' : event.chunk))
    expect(answerFlow).toEqual(['Checking…', 'RESET', 'Final ', 'answer'])

    // The byte-path flush of the same final text must not duplicate chunk frames.
    expect(events.filter((event) => event.chunk !== undefined).map((event) => event.chunk)).toEqual(
      ['Checking…', 'Final ', 'answer']
    )
  })

  it('dual gate keeps byte-path chunks for response-format transformed streams', async () => {
    const headers = new Headers({
      'x-sim-stream-protocol': 'agent-events-v1',
    })
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      requestHeaders: headers,
      streamConfig: {
        includeThinking: true,
        includeToolCalls: false,
        selectedOutputs: ['agent-1_content'],
      },
      executeFn: async ({ onStream }) => {
        let textController!: ReadableStreamDefaultController<Uint8Array>
        let sink: { onEvent: (event: unknown) => void | Promise<void> } | undefined
        const textStream = new ReadableStream<Uint8Array>({
          start(controller) {
            textController = controller
          },
        })

        const onStreamPromise = onStream({
          stream: textStream,
          streamFormat: 'text',
          subscribe: (nextSink: { onEvent: (event: unknown) => void | Promise<void> }) => {
            sink = nextSink
            return () => {}
          },
          clientStreamTransformed: true,
          execution: {
            blockId: 'agent-1',
            success: true,
            output: { content: '{"answer":"extracted"}' },
            logs: [],
            metadata: {},
          },
        } as any)

        // Sink text must NOT become chunk frames — bytes are a different projection.
        await sink?.onEvent({ type: 'text_delta', text: '{"answer":"', turn: 'pending' })
        await sink?.onEvent({ type: 'text_delta', text: 'extracted"}', turn: 'pending' })
        await sink?.onEvent({ type: 'turn_end', turn: 'final' })
        textController.enqueue(new TextEncoder().encode('extracted'))
        textController.close()
        await onStreamPromise

        return {
          success: true,
          output: { content: '{"answer":"extracted"}' },
          logs: [
            {
              blockId: 'agent-1',
              output: { content: '' },
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 1,
              success: true,
            },
          ],
        } as any
      },
    })

    const events = await collectSSEEvents(stream)
    expect(events.filter((event) => event.chunk !== undefined).map((event) => event.chunk)).toEqual(
      ['extracted']
    )
    expect(events.some((event) => event.event === 'chunk_reset')).toBe(false)
  })

  it('includeThinking without includeToolCalls does not emit tool frames', async () => {
    const headers = new Headers({
      'x-sim-stream-protocol': 'agent-events-v1',
    })
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      requestHeaders: headers,
      streamConfig: {
        includeThinking: true,
        includeToolCalls: false,
        selectedOutputs: ['agent-1_content'],
      },
      executeFn: createAgentStreamExecuteFn({
        answer: 'Answer',
        tools: [{ type: 'tool_call_start', id: 'toolu_1', name: 'get_weather' }],
      }),
    })

    const events = await collectSSEEvents(stream)
    expect(events.some((event) => event.event === 'tool')).toBe(false)
    expect(events).toContainEqual({ blockId: 'agent-1', chunk: 'Answer' })
  })

  it('includeToolCalls without includeThinking does not emit thinking', async () => {
    const headers = new Headers({
      'x-sim-stream-protocol': 'agent-events-v1',
    })
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      requestHeaders: headers,
      streamConfig: {
        includeThinking: false,
        includeToolCalls: true,
        selectedOutputs: ['agent-1_content'],
      },
      executeFn: createAgentStreamExecuteFn({
        thinking: ['should not appear'],
        answer: 'Answer',
      }),
    })

    const events = await collectSSEEvents(stream)
    expect(events.some((event) => event.event === 'thinking')).toBe(false)
    expect(events).toContainEqual({ blockId: 'agent-1', chunk: 'Answer' })
  })

  it('provider failure emits one terminal error, no final, then [DONE]', async () => {
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      streamConfig: {},
      executeFn: createAgentStreamExecuteFn({
        answer: 'partial',
        fail: true,
      }),
    })

    const payloads = await collectSSEPayloads(stream)
    const events = payloads
      .filter((payload) => payload !== '[DONE]' && payload !== '"[DONE]"')
      .map((payload) => JSON.parse(payload) as Record<string, unknown>)

    expect(events.filter((event) => event.event === 'error')).toHaveLength(1)
    expect(events.some((event) => event.event === 'final')).toBe(false)
    expect(payloads.some((payload) => payload === '[DONE]' || payload === '"[DONE]"')).toBe(true)
  })

  it('requestSignal abort propagates to executeFn abortSignal', async () => {
    const requestAbort = new AbortController()
    let sawAbort = false

    const stream = await createStreamingResponse({
      requestId: 'request-1',
      requestSignal: requestAbort.signal,
      streamConfig: {},
      executeFn: async ({ abortSignal }) => {
        requestAbort.abort()
        sawAbort = abortSignal.aborted
        return {
          success: false,
          status: 'cancelled',
          output: {},
          logs: [],
        } as any
      },
    })

    const events = await collectSSEEvents(stream)
    expect(sawAbort).toBe(true)
    expect(events.some((event) => event.event === 'final')).toBe(false)
    expect(events).toContainEqual({ event: 'error', error: 'Client cancelled request' })
  })

  it('thinking never enters streamedChunks / log content rewrite', async () => {
    const headers = new Headers({
      'x-sim-stream-protocol': 'agent-events-v1',
    })
    let rewrittenContent: string | undefined

    const stream = await createStreamingResponse({
      requestId: 'request-1',
      requestHeaders: headers,
      streamConfig: {
        includeThinking: true,
        includeToolCalls: false,
        selectedOutputs: ['agent-1_content'],
      },
      executeFn: async ({ onStream }) => {
        let textController!: ReadableStreamDefaultController<Uint8Array>
        let sink: { onEvent: (event: unknown) => void | Promise<void> } | undefined
        const textStream = new ReadableStream<Uint8Array>({
          start(controller) {
            textController = controller
          },
        })

        const onStreamPromise = onStream({
          stream: textStream,
          streamFormat: 'text',
          subscribe: (nextSink: any) => {
            sink = nextSink
            return () => {
              sink = undefined
            }
          },
          execution: {
            blockId: 'agent-1',
            success: true,
            output: { content: 'visible' },
            logs: [],
            metadata: {},
          },
        } as any)

        await sink?.onEvent({ type: 'thinking_delta', text: 'PRIVATE_THINKING' })
        textController.enqueue(new TextEncoder().encode('visible'))
        textController.close()
        await onStreamPromise

        return {
          success: true,
          output: {},
          logs: [
            {
              blockId: 'agent-1',
              output: { content: '' },
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 1,
              success: true,
            },
          ],
        } as any
      },
    })

    const events = await collectSSEEvents(stream)
    const answerChunks = events.filter((event) => typeof event.chunk === 'string')
    expect(answerChunks.every((event) => !String(event.chunk).includes('PRIVATE_THINKING'))).toBe(
      true
    )
    expect(events).toContainEqual({
      blockId: 'agent-1',
      event: 'thinking',
      data: 'PRIVATE_THINKING',
    })
    // Force consumption of stream so log rewrite runs
    expect(events.some((event) => event.event === 'final')).toBe(true)
    void rewrittenContent
  })
})
