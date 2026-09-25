import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnqueueOutboxEvents, mockProcessOutboxEventById } = vi.hoisted(() => ({
  mockEnqueueOutboxEvents: vi.fn(),
  mockProcessOutboxEventById: vi.fn(),
}))

vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvents: mockEnqueueOutboxEvents,
  MAX_BULK_ENQUEUE_EVENTS: 2,
  processOutboxEventById: mockProcessOutboxEventById,
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

import type { OutboxEventContext } from '@/lib/core/outbox/service'
import {
  enqueueWorkspaceFileStorageCleanups,
  processWorkspaceFileStorageCleanupsNow,
  WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT,
  workspaceFileStorageCleanupOutboxHandlers,
} from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'

const mockDeleteFile = storageServiceMockFns.mockDeleteFile

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
})

describe('batched workspace file storage cleanup', () => {
  it('splits keys beyond the outbox bulk limit into several inserts', async () => {
    const executor = { insert: vi.fn() }
    mockEnqueueOutboxEvents.mockResolvedValueOnce(['event-a', 'event-b'])
    mockEnqueueOutboxEvents.mockResolvedValueOnce(['event-c'])

    await expect(
      enqueueWorkspaceFileStorageCleanups(executor as never, ['a', 'b', 'c'])
    ).resolves.toEqual(['event-a', 'event-b', 'event-c'])
    expect(mockEnqueueOutboxEvents).toHaveBeenNthCalledWith(
      2,
      executor,
      WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT,
      [{ key: 'c' }]
    )
  })

  it('processes every event and leaves failures to the outbox worker without throwing', async () => {
    mockProcessOutboxEventById
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce('completed')

    await expect(
      processWorkspaceFileStorageCleanupsNow(['event-a', 'event-b'], { fileId: 'file-1' })
    ).resolves.toBeUndefined()
    expect(mockProcessOutboxEventById).toHaveBeenCalledTimes(2)
  })
})
