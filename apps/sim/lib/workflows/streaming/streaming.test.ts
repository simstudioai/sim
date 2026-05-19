/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readSSEStream } from '@/lib/core/utils/sse'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { createStreamingResponse } from '@/lib/workflows/streaming/streaming'

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
