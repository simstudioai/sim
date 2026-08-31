/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceFileSearchTriggerItems,
  shouldUseWorkspaceFileSearchTrigger,
} from '@/lib/workspace-files/search/dispatcher'

describe('workspace file search dispatch policy', () => {
  it('uses Trigger.dev from inside a task even when the deployment flag is absent', () => {
    expect(shouldUseWorkspaceFileSearchTrigger(false, true)).toBe(true)
    expect(shouldUseWorkspaceFileSearchTrigger(true, false)).toBe(true)
    expect(shouldUseWorkspaceFileSearchTrigger(false, false)).toBe(false)
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
