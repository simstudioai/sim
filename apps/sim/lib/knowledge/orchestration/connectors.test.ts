/**
 * @vitest-environment node
 */
import { document } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCaptureServerEvent,
  mockDispatchSync,
  mockHasWorkspaceLiveSyncAccess,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockCaptureServerEvent: vi.fn(),
  mockDispatchSync: vi.fn(),
  mockHasWorkspaceLiveSyncAccess: vi.fn(),
  mockRecordAudit: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    CONNECTOR_CREATED: 'connector.created',
    CONNECTOR_UPDATED: 'connector.updated',
    CONNECTOR_DELETED: 'connector.deleted',
    CONNECTOR_SYNCED: 'connector.synced',
  },
  AuditResourceType: { CONNECTOR: 'connector' },
  recordAudit: mockRecordAudit,
}))
vi.mock('@/lib/api-key/crypto', () => ({ encryptApiKey: vi.fn() }))
vi.mock('@/lib/billing/core/subscription', () => ({
  hasWorkspaceLiveSyncAccess: mockHasWorkspaceLiveSyncAccess,
}))
vi.mock('@/lib/knowledge/connectors/queue', () => ({ dispatchSync: mockDispatchSync }))
vi.mock('@/lib/knowledge/documents/service', () => ({
  deleteDocumentStorageFiles: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/knowledge/tags/service', () => ({
  cleanupUnusedTagDefinitions: vi.fn().mockResolvedValue(undefined),
  createTagDefinition: vi.fn(),
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCaptureServerEvent }))

import {
  performDeleteKnowledgeConnector,
  performSyncKnowledgeConnector,
  performUpdateKnowledgeConnector,
} from '@/lib/knowledge/orchestration/connectors'

const KB = { id: 'kb-1', name: 'Docs', workspaceId: 'ws-1' }
const ACTOR = { userId: 'user-1', source: 'agent' as const, requestId: 'req-1' }
const BILLING = { actorUserId: 'user-1', workspaceId: 'ws-1' } as never
const resolveBillingAttribution = vi.fn().mockResolvedValue(BILLING)

describe('performDeleteKnowledgeConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterAll(resetDbChainMock)

  it('reports the documents it kept, so the caller cannot claim otherwise', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'conn-1', connectorType: 'notion' }])
    queueTableRows(document, [
      { id: 'doc-1', fileUrl: '/a.txt' },
      { id: 'doc-2', fileUrl: '/b.txt' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'conn-1' }])

    const outcome = await performDeleteKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
    })

    // The default keeps the documents. The copilot tool used to assert they had
    // been removed while taking exactly this path.
    expect(outcome).toMatchObject({ success: true, documentsKept: 2, documentsDeleted: 0 })
    expect(dbChainMockFns.delete).not.toHaveBeenCalledWith(document)
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ deleteDocuments: false, documentsKept: 2 }),
      })
    )
  })

  it('reports the documents it deleted when asked to delete them', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'conn-1', connectorType: 'notion' }])
    queueTableRows(document, [{ id: 'doc-1', fileUrl: '/a.txt' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'conn-1' }])

    const outcome = await performDeleteKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      deleteDocuments: true,
    })

    expect(outcome).toMatchObject({ success: true, documentsDeleted: 1, documentsKept: 0 })
  })

  it('reports a missing connector as not found', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const outcome = await performDeleteKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'not_found' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('returns authoritative delete counts without legacy audit or analytics when disabled', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'conn-1', connectorType: 'notion' }])
    queueTableRows(document, [{ id: 'doc-1', fileUrl: '/a.txt' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'conn-1' }])

    const outcome = await performDeleteKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      recordSemanticAudit: false,
      recordProductAnalytics: false,
    })

    expect(outcome).toMatchObject({ success: true, documentsKept: 1 })
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})

describe('performUpdateKnowledgeConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterAll(resetDbChainMock)

  it('rejects an update that names nothing before reading the connector', async () => {
    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: {},
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'validation' })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('classifies a sub-hourly interval on an unentitled workspace as forbidden', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'conn-1', connectorType: 'notion' }])
    mockHasWorkspaceLiveSyncAccess.mockResolvedValue(false)

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { syncIntervalMinutes: 5 },
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'forbidden' })
    expect(mockHasWorkspaceLiveSyncAccess).toHaveBeenCalledWith('ws-1')
  })

  it('leaves a caller-supplied validator to reject a bad source config', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'conn-1', connectorType: 'notion' }])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { sourceConfig: { database: 'gone' } },
      validateSourceConfig: async () => ({
        message: 'Database not found',
        errorCode: 'validation' as const,
      }),
    })

    expect(outcome).toMatchObject({
      success: false,
      errorCode: 'validation',
      error: 'Database not found',
    })
  })

  it('preserves the failure class the validator chose', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'conn-1', connectorType: 'notion' }])

    // A stale stored credential kept the route's 401; collapsing every
    // rejection to `validation` had flattened it (and the 409) into a 400.
    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { sourceConfig: { database: 'x' } },
      validateSourceConfig: async () => ({
        message: 'Failed to refresh access token. Please reconnect your account.',
        errorCode: 'unauthorized' as const,
      }),
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'unauthorized' })
  })

  it('clears the failure counters when a paused connector is resumed', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'conn-1', connectorType: 'notion' }])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'active' },
    ])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { status: 'active' },
    })

    expect(outcome).toMatchObject({ success: true })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ consecutiveFailures: 0, lastSyncError: null })
    )
  })

  it('refuses to flip the status of a connector that is mid-sync', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'syncing' },
    ])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { status: 'active' },
    })

    /**
     * `status: 'active'` also writes `nextSyncAt = now`, which summons a second
     * run alongside the one already holding the lock. `performSyncKnowledgeConnector`
     * already refuses on the same condition; this is the other half.
     */
    expect(outcome).toMatchObject({
      success: false,
      errorCode: 'conflict',
      error: 'Sync already in progress',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('refuses a non-status edit mid-sync too', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'syncing' },
    ])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { sourceConfig: { database: 'other' } },
    })

    /**
     * `sourceConfig` is read once at the start of a run and threaded through it,
     * so an edit mid-flight yields a pass that lists against one config and
     * reconciles against another — and reconciliation hard-deletes.
     */
    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('leaves semantic audit to an authorized application caller when requested', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'conn-1', connectorType: 'notion' }])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'paused' },
    ])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { status: 'paused' },
      recordSemanticAudit: false,
    })

    expect(outcome).toMatchObject({ success: true })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })
})

describe('performSyncKnowledgeConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockDispatchSync.mockResolvedValue(undefined)
  })

  afterAll(resetDbChainMock)

  it('resolves the payer before writing the audit, not after', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'active' },
    ])
    const rejects = vi.fn().mockRejectedValue(new Error('billing attribution header is malformed'))

    const outcome = await performSyncKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      resolveBillingAttribution: rejects,
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'internal' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockDispatchSync).not.toHaveBeenCalled()
  })

  it('refuses to stack a sync on one already running', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'syncing' },
    ])

    const outcome = await performSyncKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      resolveBillingAttribution,
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
    // A rejected request never pays for the payer lookup.
    expect(resolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockDispatchSync).not.toHaveBeenCalled()
  })

  it('dispatches and records who asked for it', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'active' },
    ])

    const outcome = await performSyncKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      resolveBillingAttribution,
      rehydrate: true,
    })

    expect(outcome).toMatchObject({ success: true })
    expect(mockDispatchSync).toHaveBeenCalledWith('conn-1', {
      billingAttribution: BILLING,
      requestId: 'req-1',
      rehydrate: true,
    })
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        metadata: expect.objectContaining({ syncType: 'manual-rehydrate' }),
      })
    )
  })

  it('rejects a knowledge base with no workspace to bill', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'active' },
    ])

    const outcome = await performSyncKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: { ...KB, workspaceId: null },
      connectorId: 'conn-1',
      resolveBillingAttribution,
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
  })

  it('dispatches while leaving semantic audit and product analytics to the application surface', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'active' },
    ])

    const outcome = await performSyncKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      resolveBillingAttribution,
      recordSemanticAudit: false,
      recordProductAnalytics: false,
    })

    expect(outcome).toMatchObject({ success: true })
    expect(mockDispatchSync).toHaveBeenCalledOnce()
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})
