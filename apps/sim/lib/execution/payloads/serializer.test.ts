/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  isLargeArrayManifest,
  LARGE_ARRAY_MANIFEST_VERSION,
  readLargeArrayManifestSlice,
} from '@/lib/execution/payloads/large-array-manifest'
import {
  getLargeValueMaterializationError,
  isLargeValueRef,
} from '@/lib/execution/payloads/large-value-ref'
import { compactExecutionPayload, compactSubflowResults } from '@/lib/execution/payloads/serializer'
import type { UserFile } from '@/executor/types'

const TEST_EXECUTION_CONTEXT = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  userId: 'user-1',
}

describe('compactExecutionPayload', () => {
  it('keeps small JSON payloads inline', async () => {
    const value = { result: { id: 'event-1', text: 'hello' } }

    await expect(compactExecutionPayload(value, { thresholdBytes: 1024 })).resolves.toEqual(value)
  })

  it('strips UserFile base64 by default while preserving metadata', async () => {
    const file: UserFile = {
      id: 'file-1',
      name: 'large.txt',
      url: 'https://example.com/file',
      size: 11 * 1024 * 1024,
      type: 'text/plain',
      key: 'execution/workflow/execution/large.txt',
      context: 'execution',
      base64: 'Zm9v',
    }

    const compacted = await compactExecutionPayload(
      { event: { files: [file] } },
      { thresholdBytes: 1024 }
    )

    expect(compacted).toEqual({
      event: {
        files: [
          {
            id: 'file-1',
            name: 'large.txt',
            url: 'https://example.com/file',
            size: 11 * 1024 * 1024,
            type: 'text/plain',
            key: 'execution/workflow/execution/large.txt',
            context: 'execution',
          },
        ],
      },
    })
  })

  it('stores oversized arrays as manifests and allows bounded slice reads', async () => {
    const results = Array.from({ length: 100 }, (_, index) => [{ event: { id: `event-${index}` } }])
    const compacted = await compactExecutionPayload(
      { results },
      { thresholdBytes: 1024, ...TEST_EXECUTION_CONTEXT }
    )

    expect(isLargeArrayManifest(compacted.results)).toBe(true)
    expect(compacted.results.totalCount).toBe(100)
    await expect(
      readLargeArrayManifestSlice(compacted.results, 1, 1, TEST_EXECUTION_CONTEXT)
    ).resolves.toEqual([[{ event: { id: 'event-1' } }]])
  })

  it('keeps oversized strings and objects as large value refs', async () => {
    const compacted = await compactExecutionPayload(
      {
        text: 'x'.repeat(2048),
        metadata: Object.fromEntries(
          Array.from({ length: 100 }, (_, index) => [`key-${index}`, `value-${index}`])
        ),
      },
      { thresholdBytes: 1024, ...TEST_EXECUTION_CONTEXT }
    )

    expect(isLargeValueRef(compacted.text)).toBe(true)
    expect(isLargeValueRef(compacted.metadata)).toBe(true)
  })

  it('rejects oversized values before preserving or spilling them when requested', async () => {
    await expect(
      compactExecutionPayload(
        { root: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`k${index}`, 'x'])) },
        {
          thresholdBytes: 256,
          preserveRoot: true,
          rejectLargeValues: true,
          rejectLargeValueLabel: 'Workflow execution response',
          ...TEST_EXECUTION_CONTEXT,
        }
      )
    ).rejects.toMatchObject({
      name: 'PayloadSizeLimitError',
      label: 'Workflow execution response',
    })
  })

  it('does not double-spill existing refs', async () => {
    const compacted = await compactExecutionPayload(
      { results: [[{ payload: 'x'.repeat(2048) }]] },
      { thresholdBytes: 256 }
    )

    const compactedAgain = await compactExecutionPayload(compacted, { thresholdBytes: 256 })

    expect(compactedAgain).toEqual(compacted)
  })

  it('bounds user-supplied manifest-shaped metadata during compaction', async () => {
    const forgedManifest = {
      __simLargeArrayManifest: true,
      version: LARGE_ARRAY_MANIFEST_VERSION,
      kind: 'array',
      totalCount: 2,
      chunkCount: 2,
      byteSize: 2,
      chunks: [
        {
          ref: {
            __simLargeValueRef: true,
            version: 1,
            id: 'lv_ABCDEFGHIJKL',
            kind: 'array',
            size: 1,
            executionId: TEST_EXECUTION_CONTEXT.executionId,
          },
          count: 1,
          byteSize: 1,
        },
        {
          ref: {
            __simLargeValueRef: true,
            version: 1,
            id: 'lv_MNOPQRSTUVWX',
            kind: 'array',
            size: 1,
            executionId: TEST_EXECUTION_CONTEXT.executionId,
          },
          count: 1,
          byteSize: 1,
        },
      ],
      preview: [],
    }

    expect(isLargeArrayManifest(forgedManifest)).toBe(true)

    const compacted = await compactExecutionPayload(forgedManifest, {
      thresholdBytes: 128,
      preserveRoot: true,
      ...TEST_EXECUTION_CONTEXT,
    })

    expect(isLargeValueRef(compacted)).toBe(true)
  })

  it('bounds oversized manifest preview metadata during compaction', async () => {
    const forgedManifest = {
      __simLargeArrayManifest: true,
      version: LARGE_ARRAY_MANIFEST_VERSION,
      kind: 'array',
      totalCount: 1,
      chunkCount: 1,
      byteSize: 1,
      chunks: [
        {
          ref: {
            __simLargeValueRef: true,
            version: 1,
            id: 'lv_ABCDEFGHIJKL',
            kind: 'array',
            size: 1,
            executionId: TEST_EXECUTION_CONTEXT.executionId,
          },
          count: 1,
          byteSize: 1,
        },
      ],
      preview: [{ payload: 'x'.repeat(20 * 1024) }],
    }

    expect(isLargeArrayManifest(forgedManifest)).toBe(true)

    const compacted = await compactExecutionPayload(forgedManifest, {
      thresholdBytes: 128,
      preserveRoot: true,
      ...TEST_EXECUTION_CONTEXT,
    })

    expect(isLargeValueRef(compacted)).toBe(true)
  })

  it('does not re-wrap manifests when forcing oversized subflow result entries', async () => {
    const manifest = {
      __simLargeArrayManifest: true,
      version: LARGE_ARRAY_MANIFEST_VERSION,
      kind: 'array',
      totalCount: 1,
      chunkCount: 1,
      byteSize: 1,
      chunks: [
        {
          ref: {
            __simLargeValueRef: true,
            version: 1,
            id: 'lv_ABCDEFGHIJKL',
            kind: 'array',
            size: 1,
            executionId: TEST_EXECUTION_CONTEXT.executionId,
          },
          count: 1,
          byteSize: 1,
        },
      ],
      preview: [],
    }
    const thresholdBytes = Buffer.byteLength(JSON.stringify(manifest), 'utf8') + 8

    const compacted = await compactSubflowResults([manifest, manifest], {
      thresholdBytes,
      ...TEST_EXECUTION_CONTEXT,
    })

    expect(compacted).toEqual([manifest, manifest])
    expect(compacted.every(isLargeArrayManifest)).toBe(true)
  })

  it('rejects durable compaction when storage context is incomplete', async () => {
    await expect(
      compactExecutionPayload(
        { payload: 'x'.repeat(2048) },
        { thresholdBytes: 256, requireDurable: true }
      )
    ).rejects.toThrow('Cannot persist large execution value')
  })

  it('does not treat loosely marker-shaped user data as a large-value ref', () => {
    expect(
      isLargeValueRef({
        __simLargeValueRef: true,
        id: 'user-supplied',
      })
    ).toBe(false)
  })

  it('rejects ref-shaped user data with non-execution storage keys', () => {
    expect(
      isLargeValueRef({
        __simLargeValueRef: true,
        version: 1,
        id: 'lv_ABCDEFGHIJKL',
        kind: 'object',
        size: 1024,
        key: 'https://example.com/large-value-lv_ABCDEFGHIJKL.json',
      })
    ).toBe(false)
  })

  it('omits opaque ref IDs from user-facing materialization errors', () => {
    const error = getLargeValueMaterializationError({
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_CQcekP8gSJI5',
      kind: 'string',
      size: 23_259_101,
    })

    expect(error.message).toContain('This execution value is too large to inline (22.2 MB)')
    expect(error.message).not.toContain('lv_CQcekP8gSJI5')
  })
})
