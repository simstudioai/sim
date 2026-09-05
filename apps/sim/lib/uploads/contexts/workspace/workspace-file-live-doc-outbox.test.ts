/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockApplyEditToLiveFileDoc, mockDownloadFile, mockInvalidateLiveFileDoc } = vi.hoisted(
  () => ({
    mockApplyEditToLiveFileDoc: vi.fn(),
    mockDownloadFile: vi.fn(),
    mockInvalidateLiveFileDoc: vi.fn(),
  })
)

vi.mock('@/lib/realtime/notify', () => ({
  applyEditToLiveFileDoc: mockApplyEditToLiveFileDoc,
  invalidateLiveFileDoc: mockInvalidateLiveFileDoc,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: mockDownloadFile,
}))

import type { OutboxEventContext } from '@/lib/core/outbox/service'
import {
  WORKSPACE_FILE_LIVE_DOC_OUTBOX_EVENT,
  workspaceFileLiveDocOutboxHandlers,
} from '@/lib/uploads/contexts/workspace/workspace-file-live-doc-outbox'

const VERSION = new Date('2026-09-04T12:00:00.000Z')
const PAYLOAD = {
  workspaceId: 'workspace-1',
  fileId: 'file-1',
  version: VERSION.getTime(),
}

function context(): OutboxEventContext {
  return {
    eventId: 'event-1',
    eventType: WORKSPACE_FILE_LIVE_DOC_OUTBOX_EVENT,
    attempts: 0,
    maxAttempts: 10,
    signal: new AbortController().signal,
    checkpointPayload: vi.fn(),
  }
}

function handler() {
  const registered = workspaceFileLiveDocOutboxHandlers[WORKSPACE_FILE_LIVE_DOC_OUTBOX_EVENT]
  if (!registered) throw new Error('Workspace file live-document handler is not registered')
  return registered
}

describe('workspace file live-document outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockDownloadFile.mockResolvedValue(Buffer.from('# Durable content'))
    mockApplyEditToLiveFileDoc.mockResolvedValue({ applied: true, status: 'applied' })
  })

  it('loads the committed version and reconciles it into the live document', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        key: 'workspace/workspace-1/file.md',
        name: 'file.md',
        type: 'text/markdown',
        sizeBytes: 100,
        contentUpdatedAt: VERSION,
      },
    ])

    await handler()(PAYLOAD, context())

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'workspace/workspace-1/file.md', context: 'workspace' })
    )
    expect(mockApplyEditToLiveFileDoc).toHaveBeenCalledWith(
      'file-1',
      '# Durable content',
      { version: VERSION.getTime() },
      expect.any(AbortSignal)
    )
  })

  it('completes a stale event without reading or regressing newer content', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        key: 'workspace/workspace-1/file.md',
        name: 'file.md',
        type: 'text/markdown',
        sizeBytes: 100,
        contentUpdatedAt: new Date(VERSION.getTime() + 1),
      },
    ])

    await handler()(PAYLOAD, context())

    expect(mockDownloadFile).not.toHaveBeenCalled()
    expect(mockApplyEditToLiveFileDoc).not.toHaveBeenCalled()
    expect(mockInvalidateLiveFileDoc).not.toHaveBeenCalled()
  })

  it('defers transient merge-lock contention for an outbox retry', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        key: 'workspace/workspace-1/file.md',
        name: 'file.md',
        type: 'text/markdown',
        sizeBytes: 100,
        contentUpdatedAt: VERSION,
      },
    ])
    mockApplyEditToLiveFileDoc.mockResolvedValueOnce({
      applied: false,
      status: 'merge-unavailable',
    })

    await expect(handler()(PAYLOAD, context())).resolves.toEqual(
      expect.objectContaining({ outcome: 'deferred' })
    )
  })

  it('rejects malformed payloads before touching durable state', async () => {
    await expect(handler()({ ...PAYLOAD, version: 0 }, context())).rejects.toThrow(
      'invalid version'
    )
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('does not materialize files beyond the collaborative editor boundary', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        key: 'workspace/workspace-1/file.md',
        name: 'file.md',
        type: 'text/markdown',
        sizeBytes: 6 * 1024 * 1024,
        contentUpdatedAt: VERSION,
      },
    ])

    await handler()(PAYLOAD, context())

    expect(mockDownloadFile).not.toHaveBeenCalled()
    expect(mockApplyEditToLiveFileDoc).not.toHaveBeenCalled()
    expect(mockInvalidateLiveFileDoc).toHaveBeenCalledWith(
      'file-1',
      VERSION.getTime(),
      expect.any(AbortSignal)
    )
  })

  it('invalidates a live markdown generation when the durable file changes type', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        key: 'workspace/workspace-1/file.bin',
        name: 'file.bin',
        type: 'application/octet-stream',
        sizeBytes: 100,
        contentUpdatedAt: VERSION,
      },
    ])

    await handler()(PAYLOAD, context())

    expect(mockDownloadFile).not.toHaveBeenCalled()
    expect(mockApplyEditToLiveFileDoc).not.toHaveBeenCalled()
    expect(mockInvalidateLiveFileDoc).toHaveBeenCalledWith(
      'file-1',
      VERSION.getTime(),
      expect.any(AbortSignal)
    )
  })

  it('still invalidates after a later binary write supersedes the type-changing event', async () => {
    const latestVersion = VERSION.getTime() + 1
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        key: 'workspace/workspace-1/file.bin',
        name: 'file.bin',
        type: 'application/octet-stream',
        sizeBytes: 100,
        contentUpdatedAt: new Date(latestVersion),
      },
    ])

    await handler()(PAYLOAD, context())

    expect(mockDownloadFile).not.toHaveBeenCalled()
    expect(mockApplyEditToLiveFileDoc).not.toHaveBeenCalled()
    expect(mockInvalidateLiveFileDoc).toHaveBeenCalledWith(
      'file-1',
      latestVersion,
      expect.any(AbortSignal)
    )
  })
})
