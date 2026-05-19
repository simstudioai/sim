/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockMaterializeLargeValueRef } = vi.hoisted(() => ({
  mockMaterializeLargeValueRef: vi.fn(),
}))

vi.mock('@/lib/execution/payloads/store', () => ({
  materializeLargeValueRef: mockMaterializeLargeValueRef,
}))

import { warmLargeValueRefs } from '@/lib/execution/payloads/hydration'

describe('warmLargeValueRefs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not warm manifest chunks before explicit navigation', async () => {
    const chunkRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_ABCDEFGHIJKL',
      kind: 'array',
      size: 16,
      executionId: 'execution-1',
    }
    const manifest = {
      __simLargeArrayManifest: true,
      version: 2,
      kind: 'array',
      totalCount: 1,
      chunkCount: 1,
      byteSize: 16,
      chunks: [
        {
          ref: chunkRef,
          count: 1,
          byteSize: 16,
        },
      ],
      preview: [],
    }

    await warmLargeValueRefs({ issues: manifest }, { executionId: 'execution-1' })

    expect(mockMaterializeLargeValueRef).not.toHaveBeenCalled()
  })

  it('records exact keys discovered while warming manifest preview refs', async () => {
    const previewRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_ABCDEFGHIJKL',
      kind: 'object',
      size: 16,
      key: 'execution/workspace-1/workflow-1/source-execution/large-value-lv_ABCDEFGHIJKL.json',
      executionId: 'source-execution',
    }
    const nestedRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_MNOPQRSTUVWX',
      kind: 'object',
      size: 16,
      key: 'execution/workspace-1/workflow-1/source-execution/large-value-lv_MNOPQRSTUVWX.json',
      executionId: 'source-execution',
    }
    const file = {
      id: 'file-1',
      name: 'nested.txt',
      key: 'execution/workspace-1/workflow-1/source-execution/nested.txt',
      url: '/api/files/serve/execution/workspace-1/workflow-1/source-execution/nested.txt?context=execution',
      size: 5,
      type: 'text/plain',
      context: 'execution',
    }
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
            id: 'lv_CHUNKREF0001',
            kind: 'array',
            size: 16,
            executionId: 'source-execution',
          },
          count: 1,
          byteSize: 16,
        },
      ],
      preview: [previewRef],
    }
    const context = {
      executionId: 'execution-1',
      largeValueKeys: [] as string[],
      fileKeys: [] as string[],
    }
    mockMaterializeLargeValueRef.mockResolvedValueOnce([{ nestedRef, file }])

    await warmLargeValueRefs({ issues: manifest }, context)

    expect(mockMaterializeLargeValueRef).toHaveBeenCalledWith(previewRef, context)
    expect(context.largeValueKeys).toEqual([nestedRef.key])
    expect(context.fileKeys).toEqual([file.key])
  })

  it('warms manifest preview refs without exposing chunk internals as navigable metadata', async () => {
    const previewRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_PREVIEWREF01',
      kind: 'object',
      size: 16,
      executionId: 'execution-1',
    }
    const manifest = {
      __simLargeArrayManifest: true,
      version: 2,
      kind: 'array',
      totalCount: 0,
      chunkCount: 0,
      byteSize: 0,
      chunks: [],
      preview: [previewRef],
    }
    mockMaterializeLargeValueRef.mockResolvedValueOnce({ key: 'SIM-1' })

    await warmLargeValueRefs({ issues: manifest }, { executionId: 'execution-1' })

    expect(mockMaterializeLargeValueRef).toHaveBeenCalledWith(previewRef, {
      executionId: 'execution-1',
    })
  })
})
