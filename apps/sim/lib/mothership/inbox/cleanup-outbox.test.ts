/**
 * @vitest-environment node
 */

import { db } from '@sim/db'
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboxEventContext } from '@/lib/core/outbox/service'

const mocks = vi.hoisted(() => ({
  getInbox: vi.fn(),
  deleteInbox: vi.fn(),
  deleteWebhook: vi.fn(),
}))
vi.mock('@/lib/mothership/inbox/agentmail-client', () => mocks)

import {
  cancelInboxCleanup,
  inboxCleanupOutboxHandlers,
} from '@/lib/mothership/inbox/cleanup-outbox'

const cleanup = inboxCleanupOutboxHandlers['inbox.resources.cleanup']
const payload = {
  inboxId: 'old@example.com',
  inboxCreatedAt: '2025-01-01T00:00:00Z',
  webhookId: 'old-hook',
}
let context: OutboxEventContext

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.getInbox.mockResolvedValue({
    inbox_id: payload.inboxId,
    created_at: payload.inboxCreatedAt,
  })
  mocks.deleteInbox.mockResolvedValue(true)
  mocks.deleteWebhook.mockResolvedValue(true)
  context = {
    eventId: 'event-1',
    eventType: 'inbox.resources.cleanup',
    attempts: 0,
    maxAttempts: 10,
    signal: new AbortController().signal,
    checkpointPayload: vi.fn().mockResolvedValue(undefined),
  }
})

describe('durable inbox cleanup', () => {
  it('refuses resources still referenced by an active configuration', async () => {
    queueTableRows(schemaMock.mothershipInboxWebhook, [{ id: 'active-hook' }])
    await expect(cleanup(payload, context)).rejects.toThrow('still in use')
    expect(mocks.deleteWebhook).not.toHaveBeenCalled()
    expect(mocks.deleteInbox).not.toHaveBeenCalled()
  })

  it('refuses an inbox still referenced by a workspace', async () => {
    queueTableRows(schemaMock.workspace, [{ id: 'workspace-1' }])
    await expect(cleanup({ ...payload, webhookId: null }, context)).rejects.toThrow('still in use')
    expect(mocks.deleteInbox).not.toHaveBeenCalled()
  })

  it('surfaces provider failures for the outbox retry policy', async () => {
    mocks.deleteWebhook.mockRejectedValueOnce(new Error('Service unavailable'))
    await expect(cleanup(payload, context)).rejects.toThrow('Service unavailable')
    expect(mocks.deleteInbox).not.toHaveBeenCalled()
  })

  it('checkpoints accepted deletion and polls on retry instead of deleting again', async () => {
    mocks.deleteInbox.mockResolvedValueOnce(false)
    await expect(cleanup(payload, context)).resolves.toMatchObject({ outcome: 'deferred' })
    expect(context.checkpointPayload).toHaveBeenCalledWith({ inboxDeleteAccepted: true })
    await expect(
      cleanup({ ...payload, inboxDeleteAccepted: true }, context)
    ).resolves.toMatchObject({ outcome: 'deferred' })
    expect(mocks.deleteInbox).toHaveBeenCalledTimes(1)
    mocks.getInbox.mockResolvedValueOnce(null)
    await expect(
      cleanup({ ...payload, inboxDeleteAccepted: true }, context)
    ).resolves.toBeUndefined()
  })

  it('does not delete a new inbox that reused the retired address', async () => {
    mocks.getInbox.mockResolvedValueOnce({
      inbox_id: payload.inboxId,
      created_at: '2025-02-01T00:00:00Z',
    })
    await expect(cleanup(payload, context)).resolves.toBeUndefined()
    expect(mocks.deleteInbox).not.toHaveBeenCalled()
  })

  it('completes already-absent resources without issuing another inbox delete', async () => {
    mocks.getInbox.mockResolvedValueOnce(null)
    await expect(cleanup(payload, context)).resolves.toBeUndefined()
    expect(mocks.deleteInbox).not.toHaveBeenCalled()
  })

  it('does not lose asynchronous webhook deletion', async () => {
    mocks.deleteWebhook.mockResolvedValueOnce(false)
    await expect(cleanup(payload, context)).resolves.toMatchObject({ outcome: 'deferred' })
    expect(mocks.deleteInbox).not.toHaveBeenCalled()
  })

  it('honors cancellation before provider side effects', async () => {
    context.signal = AbortSignal.abort()
    await expect(cleanup(payload, context)).rejects.toThrow()
    expect(mocks.deleteWebhook).not.toHaveBeenCalled()
  })

  it('requires a creation timestamp before deleting an address', async () => {
    await expect(cleanup({ ...payload, inboxCreatedAt: null }, context)).rejects.toThrow()
    expect(mocks.deleteWebhook).not.toHaveBeenCalled()
    expect(mocks.deleteInbox).not.toHaveBeenCalled()
  })

  it('records that cleanup started before deleting resources so a retry cannot be activated', async () => {
    await cleanup(payload, context)
    expect(context.checkpointPayload).toHaveBeenCalledWith({ cleanupStarted: true })
    expect(vi.mocked(context.checkpointPayload).mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteWebhook.mock.invocationCallOrder[0]
    )
  })

  it('does not delete anything if the cleanup lease cannot checkpoint its start', async () => {
    vi.mocked(context.checkpointPayload).mockRejectedValueOnce(new Error('Lease lost'))
    await expect(cleanup(payload, context)).rejects.toThrow('Lease lost')
    expect(mocks.deleteWebhook).not.toHaveBeenCalled()
    expect(mocks.deleteInbox).not.toHaveBeenCalled()
  })

  it('refuses activation when rollback is no longer cancelable', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(cancelInboxCleanup(db, 'event-1')).rejects.toThrow('Inbox setup expired')
  })
})
