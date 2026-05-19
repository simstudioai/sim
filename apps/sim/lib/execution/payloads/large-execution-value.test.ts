import { describe, expect, it } from 'vitest'
import {
  LARGE_ARRAY_MANIFEST_MARKER,
  LARGE_ARRAY_MANIFEST_VERSION,
  type LargeArrayManifest,
} from '@/lib/execution/payloads/large-array-manifest-metadata'
import {
  collectLargeValueExecutionIds,
  collectLargeValueKeys,
} from '@/lib/execution/payloads/large-execution-value'
import {
  LARGE_VALUE_REF_MARKER,
  LARGE_VALUE_REF_VERSION,
  type LargeValueRef,
} from '@/lib/execution/payloads/large-value-ref'

function largeValueRef(id: string, executionId: string): LargeValueRef {
  return {
    [LARGE_VALUE_REF_MARKER]: true,
    version: LARGE_VALUE_REF_VERSION,
    id,
    kind: 'object',
    size: 10,
    key: `execution/workspace-1/workflow-1/${executionId}/large-value-${id}.json`,
    executionId,
  }
}

function largeArrayManifest(executionId: string): LargeArrayManifest {
  const ref = largeValueRef('lv_MNOPQRSTUVWX', executionId)

  return {
    [LARGE_ARRAY_MANIFEST_MARKER]: true,
    version: LARGE_ARRAY_MANIFEST_VERSION,
    kind: 'array',
    totalCount: 1,
    chunkCount: 1,
    byteSize: ref.size,
    chunks: [{ ref, count: 1, byteSize: ref.size }],
    preview: [],
  }
}

describe('collectLargeValueExecutionIds', () => {
  it('collects deduplicated execution IDs from nested refs and manifests', () => {
    const executionIds = collectLargeValueExecutionIds({
      blockStates: {
        upstream: {
          output: {
            directRef: largeValueRef('lv_ABCDEFGHIJKL', 'execution-a'),
            inheritedManifest: largeArrayManifest('execution-b'),
            duplicateRef: largeValueRef('lv_NOPQRSTUVWXY', 'execution-a'),
          },
        },
      },
    })

    expect(executionIds).toEqual(['execution-a', 'execution-b'])
  })

  it('collects deduplicated storage keys from nested refs and manifests', () => {
    const keys = collectLargeValueKeys({
      directRef: largeValueRef('lv_ABCDEFGHIJKL', 'execution-a'),
      manifest: largeArrayManifest('execution-b'),
    })

    expect(keys).toEqual([
      'execution/workspace-1/workflow-1/execution-a/large-value-lv_ABCDEFGHIJKL.json',
      'execution/workspace-1/workflow-1/execution-b/large-value-lv_MNOPQRSTUVWX.json',
    ])
  })
})
