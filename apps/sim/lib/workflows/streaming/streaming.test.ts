/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readSSEStream } from '@/lib/core/utils/sse'
import { createStreamingResponse } from '@/lib/workflows/streaming/streaming'

const { mockDownloadFile } = vi.hoisted(() => ({
  mockDownloadFile: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: {
    downloadFile: mockDownloadFile,
  },
}))

const manifest = {
  __simLargeArrayManifest: true,
  version: 2,
  kind: 'array',
  totalCount: 1,
  chunkCount: 1,
  byteSize: 16,
  chunks: [
    {
      ref: {
        __simLargeValueRef: true,
        version: 1,
        id: 'lv_ABCDEFGHIJKL',
        kind: 'array',
        size: 16,
        executionId: 'execution-1',
      },
      count: 1,
      byteSize: 16,
    },
  ],
  preview: [{ id: 1 }],
}

describe('createStreamingResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('streams whole manifest selected outputs as compact metadata', async () => {
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      executionId: 'execution-1',
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

    await expect(readSSEStream(stream)).resolves.toBe(JSON.stringify(manifest, null, 2))
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
