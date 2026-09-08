/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { copilotChats, document, organization, workspaceFiles } from '@sim/db/schema'
import { dbChainMockFns, hasMockCondition, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDeleteFile, mockCleanupCopilotBackend, mockEnqueueOutboxEvent, mockEnv } = vi.hoisted(
  () => ({
    mockDeleteFile: vi.fn(),
    mockCleanupCopilotBackend: vi.fn(),
    mockEnqueueOutboxEvent: vi.fn(),
    mockEnv: { COPILOT_API_KEY: 'test-key' as string | undefined },
  })
)

vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: mockDeleteFile }))
vi.mock('@/lib/cleanup/chat-cleanup', () => ({ cleanupCopilotBackend: mockCleanupCopilotBackend }))
vi.mock('@/lib/core/outbox/service', () => ({ enqueueOutboxEvent: mockEnqueueOutboxEvent }))
vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))

import type { OutboxEventContext } from '@/lib/core/outbox/service'
import {
  enqueueOrganizationResourceCleanup,
  ORGANIZATION_RESOURCE_CLEANUP_EVENT,
  organizationResourceCleanupOutboxHandlers,
} from '@/lib/organizations/resource-cleanup'

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
  vi.clearAllMocks()
  resetDbChainMock()
  mockEnv.COPILOT_API_KEY = 'test-key'
  mockDeleteFile.mockResolvedValue(undefined)
  mockEnqueueOutboxEvent.mockResolvedValue('event')
  mockCleanupCopilotBackend.mockResolvedValue({ deleted: 1, failed: 0 })
})

afterAll(resetDbChainMock)

describe('enqueueOrganizationResourceCleanup', () => {
  it('locks the organization and snapshots only canonical direct org resources inside the caller transaction', async () => {
    queueTableRows(organization, [{ id: ORG_ID }])
    queueTableRows(workspaceFiles, [
      { id: 'file-1', key: 'kb/deleted.txt', context: 'knowledge-base' },
      { id: 'file-2', key: 'kb/second.txt', context: 'knowledge-base' },
    ])
    queueTableRows(copilotChats, [{ id: CHAT_ID }])

    await db.transaction(async (tx) => {
      await enqueueOrganizationResourceCleanup(tx, ORG_ID)
      expect(mockEnqueueOutboxEvent).toHaveBeenNthCalledWith(
        1,
        tx,
        ORGANIZATION_RESOURCE_CLEANUP_EVENT,
        {
          kind: 'files',
          organizationId: ORG_ID,
          storageKeys: ['kb/deleted.txt', 'kb/second.txt'],
        }
      )
      expect(mockEnqueueOutboxEvent).toHaveBeenNthCalledWith(
        2,
        tx,
        ORGANIZATION_RESOURCE_CLEANUP_EVENT,
        { kind: 'chats', organizationId: ORG_ID, chatIds: [CHAT_ID] }
      )
    })

    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    const fileWhere = dbChainMockFns.where.mock.calls[1][0]
    expect(
      hasMockCondition(
        fileWhere,
        (node) =>
          node.type === 'eq' && node.left === workspaceFiles.organizationId && node.right === ORG_ID
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        fileWhere,
        (node) => node.type === 'isNull' && node.column === workspaceFiles.workspaceId
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        fileWhere,
        (node) =>
          node.type === 'eq' &&
          node.left === workspaceFiles.context &&
          node.right === 'knowledge-base'
      )
    ).toBe(true)
    const chatWhere = dbChainMockFns.where.mock.calls[2][0]
    expect(
      hasMockCondition(
        chatWhere,
        (node) =>
          node.type === 'eq' && node.left === copilotChats.organizationId && node.right === ORG_ID
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        chatWhere,
        (node) => node.type === 'isNull' && node.column === copilotChats.workspaceId
      )
    ).toBe(true)
    expect(mockDeleteFile).not.toHaveBeenCalled()
    expect(mockCleanupCopilotBackend).not.toHaveBeenCalled()
  })

  it('pages by canonical IDs and bounds every persisted cleanup payload', async () => {
    queueTableRows(organization, [{ id: ORG_ID }])
    const files = Array.from({ length: 100 }, (_, index) => ({
      id: `file-${index.toString().padStart(3, '0')}`,
      key: `kb/${index}.txt`,
      context: 'knowledge-base',
    }))
    queueTableRows(workspaceFiles, files)
    queueTableRows(workspaceFiles, [
      { id: 'file-100', key: 'kb/100.txt', context: 'knowledge-base' },
    ])
    const chats = Array.from({ length: 100 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
    }))
    queueTableRows(copilotChats, chats)
    queueTableRows(copilotChats, [])

    await db.transaction((tx) => enqueueOrganizationResourceCleanup(tx, ORG_ID))

    expect(mockEnqueueOutboxEvent).toHaveBeenCalledTimes(3)
    expect(mockEnqueueOutboxEvent.mock.calls[0][2].storageKeys).toHaveLength(100)
    expect(mockEnqueueOutboxEvent.mock.calls[1][2].storageKeys).toHaveLength(1)
    expect(mockEnqueueOutboxEvent.mock.calls[2][2].chatIds).toHaveLength(100)
    expect(dbChainMockFns.limit.mock.calls).toEqual([[1], [100], [100], [100], [100]])
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[2][0],
        (node) => node.type === 'gt' && node.left === workspaceFiles.id && node.right === 'file-099'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[4][0],
        (node) => node.type === 'gt' && node.left === copilotChats.id && node.right === chats[99].id
      )
    ).toBe(true)
  })

  it('stops when the exact organization no longer exists', async () => {
    await expect(
      db.transaction((tx) => enqueueOrganizationResourceCleanup(tx, ORG_ID))
    ).rejects.toThrow('Organization no longer exists')

    expect(dbChainMockFns.from).toHaveBeenCalledTimes(1)
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('propagates an outbox write failure to the delete transaction without external effects', async () => {
    queueTableRows(organization, [{ id: ORG_ID }])
    queueTableRows(workspaceFiles, [
      { id: 'file-1', key: 'kb/file.txt', context: 'knowledge-base' },
    ])
    mockEnqueueOutboxEvent.mockRejectedValueOnce(new Error('outbox unavailable'))

    await expect(
      db.transaction((tx) => enqueueOrganizationResourceCleanup(tx, ORG_ID))
    ).rejects.toThrow('outbox unavailable')

    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(copilotChats)
    expect(mockDeleteFile).not.toHaveBeenCalled()
    expect(mockCleanupCopilotBackend).not.toHaveBeenCalled()
  })
})

describe('organization resource cleanup worker', () => {
  it('does not act while the organization survives or has been restored', async () => {
    queueTableRows(organization, [{ id: ORG_ID }])

    await handleCleanup(filesPayload(), context())

    expect(dbChainMockFns.from).toHaveBeenCalledTimes(1)
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('preserves any surviving or rebound file and document references, regardless of owner', async () => {
    queueTableRows(workspaceFiles, [{ key: 'kb/rebound.txt' }])
    queueTableRows(document, [{ key: 'kb/reused.txt' }])

    await handleCleanup(
      {
        ...filesPayload(),
        storageKeys: ['kb/rebound.txt', 'kb/reused.txt', 'kb/deleted.txt'],
      },
      context()
    )

    expect(mockDeleteFile).toHaveBeenCalledExactlyOnceWith({
      key: 'kb/deleted.txt',
      context: 'knowledge-base',
    })
    expect(dbChainMockFns.selectDistinct).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.where.mock.calls[1][0]).toMatchObject({
      type: 'inArray',
      column: workspaceFiles.key,
      values: ['kb/rebound.txt', 'kb/reused.txt', 'kb/deleted.txt'],
    })
    expect(dbChainMockFns.where.mock.calls[2][0]).toMatchObject({
      type: 'inArray',
      column: document.storageKey,
    })
  })

  it('retries provider failure and treats an already-deleted local object as completed', async () => {
    mockDeleteFile.mockRejectedValueOnce(new Error('provider unavailable'))

    await expect(handleCleanup(filesPayload(), context())).rejects.toThrow('provider unavailable')

    mockDeleteFile.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    await expect(handleCleanup(filesPayload(), context())).resolves.toBeUndefined()
    expect(mockDeleteFile).toHaveBeenCalledTimes(2)
  })

  it('bounds storage concurrency and settles all attempted deletes before scheduling a retry', async () => {
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let active = 0
    let peak = 0
    mockDeleteFile.mockImplementation(async () => {
      active += 1
      peak = Math.max(peak, active)
      if (active === 10) started.resolve()
      await release.promise
      active -= 1
      throw new Error('provider unavailable')
    })

    const cleanup = handleCleanup(
      {
        ...filesPayload(),
        storageKeys: Array.from({ length: 21 }, (_, index) => `kb/${index}.txt`),
      },
      context()
    )
    const rejected = expect(cleanup).rejects.toThrow('provider unavailable')
    await started.promise
    expect(mockDeleteFile).toHaveBeenCalledTimes(10)
    release.resolve()
    await rejected

    expect(peak).toBe(10)
    expect(active).toBe(0)
    expect(mockDeleteFile).toHaveBeenCalledTimes(21)
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
    mockEnv.COPILOT_API_KEY = undefined

    await expect(
      handleCleanup({ kind: 'chats', organizationId: ORG_ID, chatIds: [CHAT_ID] }, context())
    ).rejects.toThrow('Copilot cleanup is not configured')

    expect(mockCleanupCopilotBackend).not.toHaveBeenCalled()
  })

  it('does not require backend configuration when every chat survives', async () => {
    mockEnv.COPILOT_API_KEY = undefined
    queueTableRows(copilotChats, [{ id: CHAT_ID }])

    await expect(
      handleCleanup({ kind: 'chats', organizationId: ORG_ID, chatIds: [CHAT_ID] }, context())
    ).resolves.toBeUndefined()
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
