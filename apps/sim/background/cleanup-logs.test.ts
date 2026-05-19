/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { collectExecutionLargeValueKeys } from '@/background/cleanup-logs'

vi.mock('@trigger.dev/sdk', () => ({
  task: vi.fn((definition) => definition),
}))

describe('collectExecutionLargeValueKeys', () => {
  it('collects large-value keys owned by the purged execution', () => {
    const ownedRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_OWNEDREF0001',
      kind: 'object',
      size: 128,
      key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_OWNEDREF0001.json',
      executionId: 'execution-1',
    }
    const ownedManifest = {
      __simLargeArrayManifest: true,
      version: 2,
      kind: 'array',
      totalCount: 1,
      chunkCount: 1,
      byteSize: 128,
      chunks: [
        {
          ref: {
            __simLargeValueRef: true,
            version: 1,
            id: 'lv_CHUNKREF0001',
            kind: 'array',
            size: 128,
            key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_CHUNKREF0001.json',
            executionId: 'execution-1',
          },
          count: 1,
          byteSize: 128,
        },
      ],
      preview: [],
    }
    const inheritedRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_INHERITED001',
      kind: 'object',
      size: 128,
      key: 'execution/workspace-1/workflow-1/source-execution/large-value-lv_INHERITED001.json',
      executionId: 'source-execution',
    }

    const keys = collectExecutionLargeValueKeys(
      {
        output: {
          ownedRef,
          ownedManifest,
          inheritedRef,
        },
      },
      'execution-1'
    )

    expect(keys.sort()).toEqual([
      'execution/workspace-1/workflow-1/execution-1/large-value-lv_CHUNKREF0001.json',
      'execution/workspace-1/workflow-1/execution-1/large-value-lv_OWNEDREF0001.json',
    ])
  })

  it('deduplicates repeated refs and ignores keyless cache-only refs', () => {
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_REPEATREF001',
      kind: 'string',
      size: 128,
      key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_REPEATREF001.json',
      executionId: 'execution-1',
    }

    const keys = collectExecutionLargeValueKeys(
      {
        first: ref,
        second: ref,
        keyless: {
          __simLargeValueRef: true,
          version: 1,
          id: 'lv_KEYLESSREF01',
          kind: 'string',
          size: 128,
          executionId: 'execution-1',
        },
      },
      'execution-1'
    )

    expect(keys).toEqual([
      'execution/workspace-1/workflow-1/execution-1/large-value-lv_REPEATREF001.json',
    ])
  })
})
