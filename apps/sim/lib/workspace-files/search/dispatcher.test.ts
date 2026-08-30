/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceFileSearchTriggerItems,
  resolveWorkspaceFileSearchDispatchLimit,
} from '@/lib/workspace-files/search/dispatcher'

describe('workspace file search dispatch policy', () => {
  it('admits no more than two outstanding revisions from one workspace', () => {
    expect(resolveWorkspaceFileSearchDispatchLimit(0, 100)).toBe(2)
    expect(resolveWorkspaceFileSearchDispatchLimit(1, 100)).toBe(1)
    expect(resolveWorkspaceFileSearchDispatchLimit(2, 100)).toBe(0)
  })

  it('also respects remaining bounded global queue capacity', () => {
    expect(resolveWorkspaceFileSearchDispatchLimit(0, 1)).toBe(1)
    expect(resolveWorkspaceFileSearchDispatchLimit(0, 0)).toBe(0)
    expect(resolveWorkspaceFileSearchDispatchLimit(0, -1)).toBe(0)
  })

  it('deduplicates each immutable revision without including file contents', () => {
    const payload = {
      workspaceId: 'workspace-1',
      fileId: 'file-1',
      sourceContentUpdatedAt: '2026-08-29T12:00:00.000Z',
    }

    expect(buildWorkspaceFileSearchTriggerItems([payload], 'us-east-1')).toEqual([
      {
        payload,
        options: {
          idempotencyKey: 'workspace-file-search:file-1:2026-08-29T12:00:00.000Z',
          idempotencyKeyTTL: '1h',
          tags: ['workspaceId:workspace-1', 'fileId:file-1'],
          region: 'us-east-1',
        },
      },
    ])
  })
})
