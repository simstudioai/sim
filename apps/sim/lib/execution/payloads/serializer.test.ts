/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getLargeValueMaterializationError,
  isLargeValueRef,
} from '@/lib/execution/payloads/large-value-ref'
import { compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import type { UserFile } from '@/executor/types'
import { navigatePath } from '@/executor/variables/resolvers/reference'

const TEST_EXECUTION_CONTEXT = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
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

  it('stores oversized arrays as refs and allows nested path navigation in-process', async () => {
    const results = Array.from({ length: 100 }, (_, index) => [{ event: { id: `event-${index}` } }])
    const compacted = await compactExecutionPayload(
      { results },
      { thresholdBytes: 256, ...TEST_EXECUTION_CONTEXT }
    )

    expect(isLargeValueRef(compacted.results)).toBe(true)
    expect(
      navigatePath(compacted, ['results', '1', '0', 'event', 'id'], {
        executionContext: TEST_EXECUTION_CONTEXT,
      })
    ).toBe('event-1')
  })

  it('does not double-spill existing refs', async () => {
    const compacted = await compactExecutionPayload(
      { results: [[{ payload: 'x'.repeat(2048) }]] },
      { thresholdBytes: 256 }
    )

    const compactedAgain = await compactExecutionPayload(compacted, { thresholdBytes: 256 })

    expect(compactedAgain).toEqual(compacted)
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
