/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createInbox: vi.fn(),
  createWebhook: vi.fn(),
  getInbox: vi.fn(),
  enqueue: vi.fn(),
  process: vi.fn(),
  cancel: vi.fn(),
  deleteInbox: vi.fn(),
  deleteWebhook: vi.fn(),
}))
vi.mock('@/lib/mothership/inbox/agentmail-client', () => mocks)
vi.mock('@/lib/mothership/inbox/cleanup-outbox', () => ({
  cancelInboxCleanup: mocks.cancel,
  enqueueInboxCleanup: mocks.enqueue,
  processInboxCleanupNow: mocks.process,
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://example.com' }))

import { disableInbox, enableInbox, updateInboxAddress } from '@/lib/mothership/inbox/lifecycle'

const oldState = {
  enabled: true,
  address: 'old@example.com',
  providerId: 'old@example.com',
  webhookId: 'old-hook',
}
const emptyState = { enabled: false, address: null, providerId: null, webhookId: null }
const createdAt = '2025-01-01T00:00:00Z'
const newInbox = { inbox_id: 'new@example.com', created_at: createdAt }

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.createInbox.mockResolvedValue(newInbox)
  mocks.createWebhook.mockResolvedValue({ webhook_id: 'new-hook', secret: 'test-secret' })
  mocks.getInbox.mockResolvedValue({ inbox_id: oldState.providerId, created_at: createdAt })
  mocks.enqueue.mockResolvedValue('cleanup-event')
  mocks.process.mockResolvedValue(undefined)
  mocks.cancel.mockResolvedValue(undefined)
  mocks.deleteInbox.mockResolvedValue(true)
  mocks.deleteWebhook.mockResolvedValue(true)
})

function queueState(state = oldState) {
  queueTableRows(schemaMock.workspace, [state])
}
function queueLockedState(state = oldState) {
  queueTableRows(schemaMock.workspace, [{ id: 'workspace-1' }])
  queueState(state)
}

describe('inbox lifecycle failure safety', () => {
  it('keeps the existing inbox when a replacement address is unavailable', async () => {
    queueState()
    mocks.createInbox.mockRejectedValueOnce(new Error('Address unavailable'))
    await expect(updateInboxAddress('workspace-1', 'new')).rejects.toThrow('Address unavailable')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('retains the old configuration and cleans up only the new inbox when webhook creation fails', async () => {
    queueState()
    mocks.createWebhook.mockRejectedValueOnce(new Error('Webhook limit'))
    await expect(updateInboxAddress('workspace-1', 'new')).rejects.toThrow('Webhook limit')
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), {
      inboxId: newInbox.inbox_id,
      inboxCreatedAt: createdAt,
      webhookId: null,
    })
  })

  it('commits the replacement and cleanup identities together before deleting old resources', async () => {
    queueState()
    queueLockedState()
    await expect(updateInboxAddress('workspace-1', 'new')).resolves.toMatchObject({
      address: newInbox.inbox_id,
    })
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), {
      inboxId: oldState.providerId,
      inboxCreatedAt: createdAt,
      webhookId: 'old-hook',
    })
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ inboxEnabled: true, inboxProviderId: newInbox.inbox_id })
    )
    expect(mocks.process.mock.invocationCallOrder[0]).toBeGreaterThan(
      dbChainMockFns.set.mock.invocationCallOrder[0]
    )
  })

  it('does not overwrite a concurrent change and rolls back only its own resources', async () => {
    queueState()
    queueLockedState({ ...oldState, webhookId: 'concurrent-hook' })
    await expect(updateInboxAddress('workspace-1', 'new')).rejects.toThrow('Inbox settings changed')
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      {
        inboxId: newInbox.inbox_id,
        inboxCreatedAt: createdAt,
        webhookId: 'new-hook',
      },
      expect.any(Date)
    )
  })

  it('does not clear configuration when it cannot durably enqueue cleanup', async () => {
    queueState()
    queueLockedState()
    mocks.enqueue.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(disableInbox('workspace-1')).rejects.toThrow('Database unavailable')
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.process).not.toHaveBeenCalled()
  })

  it('retains configuration when provider identity cannot be read', async () => {
    queueState()
    mocks.getInbox.mockRejectedValueOnce(new Error('Service unavailable'))
    await expect(disableInbox('workspace-1')).rejects.toThrow('Service unavailable')
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('disables processing while retaining the exact resource identities for retry', async () => {
    queueState()
    queueLockedState()
    await disableInbox('workspace-1')
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), {
      inboxId: oldState.providerId,
      inboxCreatedAt: createdAt,
      webhookId: 'old-hook',
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ inboxEnabled: false, inboxProviderId: null })
    )
    expect(mocks.process).toHaveBeenCalledWith('cleanup-event')
  })

  it('cleans up an already-absent inbox webhook', async () => {
    queueState()
    queueLockedState()
    mocks.getInbox.mockResolvedValueOnce(null)
    await disableInbox('workspace-1')
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), {
      inboxId: null,
      inboxCreatedAt: null,
      webhookId: 'old-hook',
    })
  })

  it('refuses duplicate enable before provisioning', async () => {
    queueState()
    await expect(enableInbox('workspace-1')).rejects.toThrow('already configured')
    expect(mocks.createInbox).not.toHaveBeenCalled()
  })

  it('does not let a losing concurrent enable delete the winning configuration', async () => {
    queueTableRows(schemaMock.workspace, [emptyState])
    queueLockedState()
    await expect(enableInbox('workspace-1')).rejects.toThrow('Inbox settings changed')
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      {
        inboxId: newInbox.inbox_id,
        inboxCreatedAt: createdAt,
        webhookId: 'new-hook',
      },
      expect.any(Date)
    )
  })

  it('rolls back new resources after a database commit failure', async () => {
    queueTableRows(schemaMock.workspace, [emptyState])
    dbChainMockFns.transaction.mockRejectedValueOnce(new Error('Commit failed'))
    await expect(enableInbox('workspace-1')).rejects.toThrow('Commit failed')
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      {
        inboxId: newInbox.inbox_id,
        inboxCreatedAt: createdAt,
        webhookId: 'new-hook',
      },
      expect.any(Date)
    )
    expect(mocks.process).toHaveBeenCalledWith('cleanup-event', { expedite: true })
  })

  it('directly rolls back uninstalled resources if rollback cannot be recorded', async () => {
    queueTableRows(schemaMock.workspace, [emptyState])
    mocks.enqueue.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(enableInbox('workspace-1')).rejects.toThrow('Database unavailable')
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mocks.deleteWebhook).toHaveBeenCalledWith('new-hook')
    expect(mocks.deleteInbox).toHaveBeenCalledWith(newInbox.inbox_id)
  })

  it('refuses activation once a cleanup worker owns its resources', async () => {
    queueTableRows(schemaMock.workspace, [emptyState])
    queueTableRows(schemaMock.workspace, [{ id: 'workspace-1' }])
    queueTableRows(schemaMock.workspace, [emptyState])
    mocks.cancel.mockRejectedValueOnce(new Error('Inbox setup expired'))
    await expect(enableInbox('workspace-1')).rejects.toThrow('Inbox setup expired')
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
    expect(mocks.deleteInbox).not.toHaveBeenCalled()
  })

  it('rolls back a created inbox when its response is missing the creation timestamp', async () => {
    queueTableRows(schemaMock.workspace, [emptyState])
    mocks.createInbox.mockResolvedValueOnce({ inbox_id: newInbox.inbox_id })
    await expect(enableInbox('workspace-1')).rejects.toThrow(
      'Email service returned an invalid inbox'
    )
    expect(mocks.deleteInbox).toHaveBeenCalledWith(newInbox.inbox_id)
    expect(mocks.createWebhook).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })
})
