/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { mockMaterializeLargeValueRef } = vi.hoisted(() => ({
  mockMaterializeLargeValueRef: vi.fn(),
}))

vi.mock('@/lib/execution/payloads/store', () => ({
  materializeLargeValueRef: mockMaterializeLargeValueRef,
}))

import { warmLargeValueRefs } from '@/lib/execution/payloads/hydration'

describe('warmLargeValueRefs', () => {
  it('does not eagerly materialize manifest chunks', async () => {
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
      preview: [
        {
          __simLargeValueRef: true,
          version: 1,
          id: 'lv_PREVIEWREF01',
          kind: 'object',
          size: 16,
          executionId: 'execution-1',
        },
      ],
    }

    await warmLargeValueRefs({ issues: manifest }, { executionId: 'execution-1' })

    expect(mockMaterializeLargeValueRef).not.toHaveBeenCalled()
  })
})
