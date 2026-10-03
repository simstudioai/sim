import {
  largeValueMetadataMock,
  largeValueMetadataMockFns,
} from '@sim/testing/mocks/large-value-metadata.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock } from '@sim/testing/mocks/uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import {
  isLargeArrayManifest,
  LARGE_ARRAY_MANIFEST_VERSION,
  readLargeArrayManifestSlice,
} from '@/lib/execution/payloads/large-array-manifest'
import {
  getLargeValueMaterializationError,
  isLargeValueRef,
} from '@/lib/execution/payloads/large-value-ref'
import {
  compactBlockLogs,
  compactBlockOutput,
  compactExecutionPayload,
  compactSubflowResults,
} from '@/lib/execution/payloads/serializer'
import type { TraceSpan } from '@/lib/logs/types'
import type { BlockLog, UserFile } from '@/executor/types'

const { mockUploadFile } = storageServiceMockFns

vi.mock('@/lib/uploads', () => uploadsMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock('@/lib/execution/payloads/large-value-metadata', () => largeValueMetadataMock)

const mockRegisterLargeValueOwner = largeValueMetadataMockFns.mockRegisterLargeValueOwner

const TEST_EXECUTION_CONTEXT = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  userId: 'user-1',
}

describe('compactExecutionPayload', () => {
  beforeEach(() => {
    clearLargeValueCacheForTests()
    mockUploadFile.mockImplementation(async ({ customKey }) => ({ key: customKey }))
    mockRegisterLargeValueOwner.mockResolvedValue(true)
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

/**
 * A child workflow's spans as the workflow block reports them: a loop whose one
 * iteration holds two block spans, each with a `resultBytes` payload.
 */
function childWorkflowSpans(resultBytes: number): TraceSpan[] {
  const blockSpan = (id: string): TraceSpan => ({
    id,
    name: id,
    type: 'function',
    duration: 1,
    startTime: '2026-09-29T00:00:00.000Z',
    endTime: '2026-09-29T00:00:00.001Z',
    output: { result: 'x'.repeat(resultBytes) },
  })
  return [
    {
      id: 'loop',
      name: 'Loop',
      type: 'loop',
      duration: 2,
      startTime: '2026-09-29T00:00:00.000Z',
      endTime: '2026-09-29T00:00:00.002Z',
      children: [
        {
          id: 'iteration-0',
          name: 'Iteration 0',
          type: 'loop-iteration',
          duration: 2,
          startTime: '2026-09-29T00:00:00.000Z',
          endTime: '2026-09-29T00:00:00.002Z',
          children: [blockSpan('span-a'), blockSpan('span-b')],
        },
      ],
    },
  ]
}

/** Spans whose payloads each exceed the 4 KiB test threshold, so each spills on its own. */
const spansWithLargePayloads = () => childWorkflowSpans(8192)

/**
 * Spans whose payloads each stay under the 4 KiB test threshold but whose
 * iteration `children` together exceed it — the shape generic compaction
 * turned into a manifest nested inside the tree.
 */
const spansTooLargeAsAWhole = () => childWorkflowSpans(2500)

/** Asserts the loop → iteration → block span nesting survived with every `children` an array. */
function expectSpanTree(spans: unknown): void {
  expect(Array.isArray(spans)).toBe(true)
  const [loop] = spans as TraceSpan[]
  expect(Array.isArray(loop.children)).toBe(true)
  const [iteration] = loop.children ?? []
  expect(Array.isArray(iteration.children)).toBe(true)
  expect(iteration.children?.map((span) => span.id)).toEqual(['span-a', 'span-b'])
}

describe('compacting span trees', () => {
  const options = { thresholdBytes: 4096, requireDurable: true, ...TEST_EXECUTION_CONTEXT }

  beforeEach(() => {
    clearLargeValueCacheForTests()
    mockUploadFile.mockImplementation(async ({ customKey }) => ({ key: customKey }))
    mockRegisterLargeValueOwner.mockResolvedValue(true)
  })

  const childWorkflowLog = (overrides: Partial<BlockLog>): BlockLog => ({
    blockId: 'child-workflow',
    blockType: 'workflow',
    startedAt: '2026-09-29T00:00:00.000Z',
    endedAt: '2026-09-29T00:00:00.002Z',
    durationMs: 2,
    success: true,
    ...overrides,
  })

  it('splits a block output child span tree off, spilling each oversized payload', async () => {
    const compacted = await compactBlockOutput(
      { result: 'done', childTraceSpans: spansWithLargePayloads() },
      options
    )

    expect(compacted.output).toEqual({ result: 'done' })
    expectSpanTree(compacted.childTraceSpans)
    const [loop] = compacted.childTraceSpans as TraceSpan[]
    const spilled = loop.children?.[0].children?.[0]
    expect(isLargeValueRef(spilled?.output?.result)).toBe(true)
  })

  it('keeps the skeleton of a block output child span tree too large as a whole', async () => {
    const compacted = await compactBlockOutput(
      { result: 'done', childTraceSpans: spansTooLargeAsAWhole() },
      options
    )

    expect(compacted.output).toEqual({ result: 'done' })
    expectSpanTree(compacted.childTraceSpans)
    const [loop] = compacted.childTraceSpans as TraceSpan[]
    expect(loop.children?.[0].children?.[0].output).toBeUndefined()
  })

  it('drops malformed span entries so an oversized tree still keeps its skeleton', async () => {
    const spans = spansTooLargeAsAWhole()
    const iteration = spans[0].children?.[0]
    iteration?.children?.push(null as unknown as TraceSpan)

    const compacted = await compactBlockOutput(
      { childTraceSpans: [...spans, undefined as unknown as TraceSpan] },
      options
    )

    expectSpanTree(compacted.childTraceSpans)
    expect(compacted.childTraceSpans).toHaveLength(1)
  })

  it('keeps the skeleton when span metadata itself was spilled', async () => {
    const spans = spansTooLargeAsAWhole()
    const blockSpan = spans[0].children?.[0].children?.[0]
    Object.assign(blockSpan ?? {}, {
      modelToolCalls: Array.from({ length: 8 }, (_, index) => ({
        name: `tool-${index}`,
        arguments: { query: 'q'.repeat(1024) },
      })),
      toolCalls: Array.from({ length: 8 }, (_, index) => ({
        name: `tool-${index}`,
        input: 'i'.repeat(1024),
      })),
      providerTiming: { segments: [{ assistantContent: 'a'.repeat(8192) }] },
    })

    const compacted = await compactBlockOutput({ childTraceSpans: spans }, options)

    expectSpanTree(compacted.childTraceSpans)
  })

  it('keeps nested child workflow trees in the skeleton', async () => {
    const nestedWorkflowSpan: TraceSpan = {
      id: 'nested-workflow',
      name: 'Nested Workflow',
      type: 'workflow',
      duration: 2,
      startTime: '2026-09-29T00:00:00.000Z',
      endTime: '2026-09-29T00:00:00.002Z',
      output: { result: 'done', childTraceSpans: spansTooLargeAsAWhole() },
    }

    const compacted = await compactBlockOutput({ childTraceSpans: [nestedWorkflowSpan] }, options)

    const [nested] = compacted.childTraceSpans as TraceSpan[]
    expect(nested.output?.result).toBeUndefined()
    expectSpanTree(nested.output?.childTraceSpans)
  })

  it('drops a child span tree whose skeleton alone exceeds the threshold', async () => {
    const spans = Array.from({ length: 64 }, (_, index) => ({
      ...spansTooLargeAsAWhole()[0],
      id: `loop-${index}`,
    }))

    const compacted = await compactBlockOutput({ childTraceSpans: spans }, options)

    expect(compacted.childTraceSpans).toBeUndefined()
  })

  it('rejects a child span tree too large as a whole when large values are rejected', async () => {
    await expect(
      compactBlockOutput(
        { childTraceSpans: spansTooLargeAsAWhole() },
        { ...options, rejectLargeValues: true }
      )
    ).rejects.toThrow()
  })

  it('still spills a block output whose fields together exceed the threshold', async () => {
    const compacted = await compactBlockOutput(
      {
        first: 'a'.repeat(2500),
        second: 'b'.repeat(2500),
        childTraceSpans: spansWithLargePayloads(),
      },
      options
    )

    expect(isLargeValueRef(compacted.output)).toBe(true)
    expectSpanTree(compacted.childTraceSpans)
  })

  it('keeps block log child span trees whole or as a skeleton', async () => {
    const compacted =
      (await compactBlockLogs(
        [
          childWorkflowLog({ childTraceSpans: spansWithLargePayloads() }),
          childWorkflowLog({ childTraceSpans: spansTooLargeAsAWhole() }),
        ],
        options
      )) ?? []

    expectSpanTree(compacted[0]?.childTraceSpans)
    expectSpanTree(compacted[1]?.childTraceSpans)
    const [loop] = compacted[1]?.childTraceSpans ?? []
    expect(loop.children?.[0].children?.[0].output).toBeUndefined()
  })

  it('keeps a nested child workflow span tree shaped as a tree', async () => {
    const nestedWorkflowSpan: TraceSpan = {
      id: 'nested-workflow',
      name: 'Nested Workflow',
      type: 'workflow',
      duration: 2,
      startTime: '2026-09-29T00:00:00.000Z',
      endTime: '2026-09-29T00:00:00.002Z',
      output: { result: 'done', childTraceSpans: spansWithLargePayloads() },
    }

    const compacted = await compactBlockOutput({ childTraceSpans: [nestedWorkflowSpan] }, options)

    const [nested] = compacted.childTraceSpans as TraceSpan[]
    expect(nested.output?.result).toBe('done')
    expectSpanTree(nested.output?.childTraceSpans)
  })

  it('terminates on a cyclic span tree', async () => {
    const span: TraceSpan = {
      id: 'cyclic',
      name: 'Cyclic',
      type: 'function',
      duration: 1,
      startTime: '2026-09-29T00:00:00.000Z',
      endTime: '2026-09-29T00:00:00.001Z',
    }
    span.children = [span]

    await expect(compactBlockOutput({ childTraceSpans: [span] }, options)).resolves.toBeDefined()
  })
})
