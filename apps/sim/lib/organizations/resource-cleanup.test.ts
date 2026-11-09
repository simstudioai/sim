/**
 * The worker's own guards. What the cleanup snapshots, and that a surviving reference keeps its
 * object, are proven against real PostgreSQL in `organization-resource-cleanup.integration.ts`.
 */
import { copilotChats, organization } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { chatCleanupMock, chatCleanupMockFns } from '@sim/testing/mocks/chat-cleanup.mock'
import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { outboxServiceMock } from '@sim/testing/mocks/outbox-service.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/cleanup/chat-cleanup', () => chatCleanupMock)
vi.mock('@/lib/core/outbox/service', () => outboxServiceMock)

import type { OutboxEventContext } from '@/lib/core/outbox/service'
import { organizationResourceCleanupOutboxHandlers } from '@/lib/organizations/resource-cleanup'
import { ORGANIZATION_RESOURCE_CLEANUP_EVENT } from '@/lib/organizations/resource-cleanup-event'

const { mockDeleteFile } = storageServiceMockFns
const { mockCleanupCopilotBackend } = chatCleanupMockFns

const ORG_ID = 'org-1'
const CHAT_ID = '10000000-0000-4000-8000-000000000001'
const SURVIVING_CHAT_ID = '10000000-0000-4000-8000-000000000002'
const handleCleanup = organizationResourceCleanupOutboxHandlers[ORGANIZATION_RESOURCE_CLEANUP_EVENT]

function context(): OutboxEventContext {
  return {
    eventId: 'cleanup-event',
    eventType: ORGANIZATION_RESOURCE_CLEANUP_EVENT,
    attempts: 0,
    maxAttempts: 10,
    signal: new AbortController().signal,
    checkpointPayload: vi.fn(),
  }
}

function filesPayload() {
  return {
    kind: 'files',
    organizationId: ORG_ID,
    storageKeys: ['kb/deleted.txt'],
  }
}

beforeEach(() => {
  resetDbChainMock()
  setEnv({ COPILOT_API_KEY: 'test-key' })
  mockDeleteFile.mockResolvedValue(undefined)
  mockCleanupCopilotBackend.mockResolvedValue({ deleted: 1, failed: 0 })
})

afterAll(() => {
  resetDbChainMock()
  resetEnvMock()
})

describe('organization resource cleanup worker', () => {
  it('does not act while the organization survives or has been restored', async () => {
    queueTableRows(organization, [{ id: ORG_ID }])

    await handleCleanup(filesPayload(), context())

    expect(dbChainMockFns.from).toHaveBeenCalledTimes(1)
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('retries provider failure and treats an already-deleted local object as completed', async () => {
    mockDeleteFile.mockRejectedValueOnce(new Error('provider unavailable'))

    await expect(handleCleanup(filesPayload(), context())).rejects.toThrow('provider unavailable')

    mockDeleteFile.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    await expect(handleCleanup(filesPayload(), context())).resolves.toBeUndefined()
    expect(mockDeleteFile).toHaveBeenCalledTimes(2)
  })

  it('purges only chats still missing at execution and safely retries the same IDs', async () => {
    const payload = { kind: 'chats', organizationId: ORG_ID, chatIds: [CHAT_ID, SURVIVING_CHAT_ID] }
    queueTableRows(copilotChats, [{ id: SURVIVING_CHAT_ID }])
    mockCleanupCopilotBackend.mockResolvedValueOnce({ deleted: 0, failed: 1 })

    await expect(handleCleanup(payload, context())).rejects.toThrow(
      'Organization chat backend cleanup failed'
    )

    queueTableRows(copilotChats, [{ id: SURVIVING_CHAT_ID }])
    await expect(handleCleanup(payload, context())).resolves.toBeUndefined()
    expect(mockCleanupCopilotBackend).toHaveBeenNthCalledWith(
      1,
      [CHAT_ID],
      'OrganizationCleanup:cleanup-event'
    )
    expect(mockCleanupCopilotBackend).toHaveBeenNthCalledWith(
      2,
      [CHAT_ID],
      'OrganizationCleanup:cleanup-event'
    )
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('does not complete unconfigured backend cleanup silently', async () => {
    setEnv({ COPILOT_API_KEY: undefined })

    await expect(
      handleCleanup({ kind: 'chats', organizationId: ORG_ID, chatIds: [CHAT_ID] }, context())
    ).rejects.toThrow('Copilot cleanup is not configured')

    expect(mockCleanupCopilotBackend).not.toHaveBeenCalled()
  })

  it('rejects malformed or oversized jobs before reading or deleting any resource', async () => {
    await expect(
      handleCleanup({ ...filesPayload(), organizationId: '' }, context())
    ).rejects.toThrow()
    await expect(
      handleCleanup(
        {
          ...filesPayload(),
          storageKeys: Array.from({ length: 101 }, () => filesPayload().storageKeys[0]),
        },
        context()
      )
    ).rejects.toThrow()
    await expect(
      handleCleanup(
        { ...filesPayload(), files: [{ key: 'workspace/file.txt', context: 'workspace' }] },
        context()
      )
    ).rejects.toThrow()

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('stops an expired worker before external side effects', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      handleCleanup(filesPayload(), { ...context(), signal: controller.signal })
    ).rejects.toThrow()

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mockDeleteFile).not.toHaveBeenCalled()
    expect(mockCleanupCopilotBackend).not.toHaveBeenCalled()
  })
})
