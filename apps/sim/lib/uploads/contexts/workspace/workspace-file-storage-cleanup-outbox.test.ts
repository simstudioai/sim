/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDeleteFile } = vi.hoisted(() => ({
  mockDeleteFile: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  deleteFile: mockDeleteFile,
}))

import type { OutboxEventContext } from '@/lib/core/outbox/service'
import {
  WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT,
  workspaceFileStorageCleanupOutboxHandlers,
} from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'

function context(): OutboxEventContext {
  return {
    eventId: 'cleanup-event-1',
    eventType: WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT,
    attempts: 0,
    maxAttempts: 10,
    signal: new AbortController().signal,
    checkpointPayload: vi.fn(),
  }
}

function handler() {
  const registered =
    workspaceFileStorageCleanupOutboxHandlers[WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT]
  if (!registered) throw new Error('Workspace file storage cleanup handler is not registered')
  return registered
}

describe('workspace file storage cleanup outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteFile.mockResolvedValue(undefined)
  })

  it('deletes the deferred workspace object', async () => {
    await handler()({ key: 'workspace/ws/file.txt' }, context())

    expect(mockDeleteFile).toHaveBeenCalledWith({
      key: 'workspace/ws/file.txt',
      context: 'workspace',
    })
  })

  it('treats an already-missing local object as completed', async () => {
    mockDeleteFile.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))

    await expect(handler()({ key: 'workspace/ws/file.txt' }, context())).resolves.toBeUndefined()
  })

  it('rejects malformed payloads without touching storage', async () => {
    await expect(handler()({ key: '' }, context())).rejects.toThrow(
      'Workspace file storage cleanup outbox payload is missing key'
    )

    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('propagates storage failures for retry', async () => {
    mockDeleteFile.mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(handler()({ key: 'workspace/ws/file.txt' }, context())).rejects.toThrow(
      'storage unavailable'
    )
  })
})
