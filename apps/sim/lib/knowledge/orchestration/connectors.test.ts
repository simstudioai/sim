import { document } from '@sim/db/schema'
import {
  dbChainMockFns,
  hasMockCondition,
  type MockCondition,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCaptureServerEvent,
  mockDispatchSync,
  mockDispatchMemberSync,
  mockGrant,
  mockRevoke,
  mockHasWorkspaceLiveSyncAccess,
  mockRecordAudit,
  mockEncryptApiKey,
  mockValidateGitHub,
  mockResolveStorageBillingContext,
  mockIncrementStorage,
  mockNotifyStorage,
  mockEnqueueConnectorDeletion,
  mockEnqueueConnectorDetachment,
} = vi.hoisted(() => ({
  mockCaptureServerEvent: vi.fn(),
  mockDispatchSync: vi.fn(),
  mockDispatchMemberSync: vi.fn(),
  mockGrant: vi.fn(),
  mockRevoke: vi.fn(),
  mockHasWorkspaceLiveSyncAccess: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockEncryptApiKey: vi.fn(),
  mockValidateGitHub: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
  mockIncrementStorage: vi.fn(),
  mockNotifyStorage: vi.fn(),
  mockEnqueueConnectorDeletion: vi.fn(),
  mockEnqueueConnectorDetachment: vi.fn(),
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
vi.mock('@/lib/api-key/crypto', () => ({ encryptApiKey: mockEncryptApiKey }))
vi.mock('@/lib/billing/core/subscription', () => ({
  hasWorkspaceLiveSyncAccess: mockHasWorkspaceLiveSyncAccess,
}))
vi.mock('@/lib/billing/storage', () => ({
  resolveStorageBillingContext: mockResolveStorageBillingContext,
  incrementStorageUsageForBillingContextInTx: mockIncrementStorage,
  maybeNotifyStorageLimitForBillingContext: mockNotifyStorage,
  applyStorageUsageDeltasInTx: vi.fn(),
}))
vi.mock('@/lib/knowledge/documents/storage-cleanup', () => ({
  enqueueKnowledgeStorageCleanup: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/knowledge/connectors/deletion', () => ({
  enqueueConnectorDeletion: mockEnqueueConnectorDeletion,
}))
vi.mock('@/lib/knowledge/connectors/detachment', () => ({
  enqueueConnectorDetachment: mockEnqueueConnectorDetachment,
  keptDocumentBytes: vi.fn(),
}))
vi.mock('@/lib/knowledge/connectors/queue', () => ({ dispatchSync: mockDispatchSync }))
vi.mock('@/lib/knowledge/connectors/member-queue', () => ({
  dispatchMemberSync: mockDispatchMemberSync,
}))
vi.mock('@/lib/knowledge/connectors/member-access', () => ({
  grantKnowledgeConnectorCredentialAccess: mockGrant,
  revokeKnowledgeConnectorCredentialAccess: mockRevoke,
  findListingCapViolation: vi.fn(() => null),
  stripListingCapFields: (_meta: unknown, sourceConfig: Record<string, unknown>) => sourceConfig,
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  deleteDocumentStorageFiles: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/knowledge/tags/service', () => ({
  cleanupUnusedTagDefinitions: vi.fn().mockResolvedValue(undefined),
  createTagDefinition: vi.fn(),
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCaptureServerEvent }))
vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    github: {
      name: 'GitHub',
      auth: {
        mode: 'oauth',
        provider: 'github-repositories',
        apiKey: { label: 'Personal access token' },
      },
      permissionScopedListing: { capFieldIds: [] },
      configFields: [],
      validateConfig: mockValidateGitHub,
    },
    notion: {
      auth: { mode: 'apiKey', optional: true },
      configFields: [],
      validateConfig: vi.fn().mockResolvedValue({ valid: true }),
    },
    jira: {
      name: 'Jira',
      auth: { mode: 'oauth', provider: 'jira' },
      permissionScopedListing: { capFieldIds: [] },
      configFields: [
        { id: 'projectSelector', canonicalParamId: 'projectKey', selectAllValue: '*' },
      ],
    },
    confluence: {
      name: 'Confluence',
      auth: { mode: 'oauth', provider: 'confluence' },
      permissionScopedListing: { capFieldIds: [] },
      configFields: [{ id: 'spaceSelector', canonicalParamId: 'spaceKey', selectAllValue: '*' }],
    },
    google_drive: {
      name: 'Google Drive',
      auth: { mode: 'oauth', provider: 'google-drive' },
      permissionScopedListing: { capFieldIds: [] },
      configFields: [{ id: 'folderId', type: 'short-input', title: 'Folder' }],
      validateConfig: vi.fn().mockResolvedValue({ valid: true }),
    },
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  performCreateKnowledgeConnector,
  performDeleteKnowledgeConnector,
  performSyncKnowledgeConnector,
  performUpdateKnowledgeConnector,
  withoutSecret,
} from '@/lib/knowledge/orchestration/connectors'

beforeEach(resetEnvFlagsMock)

const KB = { id: 'kb-1', name: 'Docs', workspaceId: 'ws-1' }
const ACTOR = { userId: 'user-1', source: 'agent' as const, requestId: 'req-1' }
const BILLING = { actorUserId: 'user-1', workspaceId: 'ws-1' } as never
const resolveBillingAttribution = vi.fn().mockResolvedValue(BILLING)

describe('performCreateKnowledgeConnector', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockHasWorkspaceLiveSyncAccess.mockResolvedValue(true)
    mockDispatchSync.mockResolvedValue({ queued: true })
    mockEncryptApiKey.mockResolvedValue({ encrypted: 'encrypted-pat' })
    mockValidateGitHub.mockResolvedValue({ valid: true })
  })

  afterAll(resetDbChainMock)

  function queueSuccessfulInsert() {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'kb-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', encryptedApiKey: null },
    ])
  }

  const createParams = {
    ...ACTOR,
    knowledgeBase: KB,
    connectorType: 'notion',
    sourceConfig: {},
    syncIntervalMinutes: 60,
    resolveBillingAttribution,
    resolveAccessToken: vi.fn(),
  }

  it.each(['result', 'exception'])(
    'redacts credentials from provider validation %s errors',
    async (failure) => {
      const token = 'private/value'
      const message = `Invalid credential ${token} (${encodeURIComponent(token)})`
      if (failure === 'result')
        mockValidateGitHub.mockResolvedValueOnce({ valid: false, error: message })
      else mockValidateGitHub.mockRejectedValueOnce(new OrchestrationError('validation', message))
      const request = performCreateKnowledgeConnector({
        ...createParams,
        connectorType: 'github',
        apiKey: token,
      })
      const expected = {
        errorCode: 'validation',
        error: 'Invalid credential [REDACTED] ([REDACTED])',
      }
      if (failure === 'result') await expect(request).resolves.toMatchObject(expected)
      else
        await expect(request).rejects.toMatchObject({
          code: expected.errorCode,
          message: expected.error,
        })
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    }
  )

  it('validates and encrypts a GitHub PAT without resolving an OAuth account or returning the secret', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'kb-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        id: 'conn-1',
        connectorType: 'github',
        credentialId: null,
        encryptedApiKey: 'encrypted-pat',
      },
    ])
    const sourceConfig = { owner: 'acme', repo: 'handbook' }
    const result = await performCreateKnowledgeConnector({
      ...createParams,
      connectorType: 'github',
      apiKey: 'personal-token',
      sourceConfig,
    })

    expect(result).toMatchObject({
      success: true,
      connector: { connectorType: 'github', credentialId: null },
    })
    expect(mockValidateGitHub).toHaveBeenCalledWith('personal-token', sourceConfig, {
      mirrorsSourceAcls: false,
    })
    expect(mockEncryptApiKey).toHaveBeenCalledWith('personal-token')
    expect(createParams.resolveAccessToken).not.toHaveBeenCalled()
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorType: 'github',
        credentialId: null,
        encryptedApiKey: 'encrypted-pat',
        accessMode: 'workspace',
      })
    )
    expect(JSON.stringify(result)).not.toContain('encrypted-pat')
    expect(JSON.stringify(result)).not.toContain('personal-token')
  })

  it('reports a failed initial dispatch instead of claiming the sync was queued', async () => {
    queueSuccessfulInsert()
    mockDispatchSync.mockRejectedValueOnce(new Error('queue unavailable'))

    const outcome = await performCreateKnowledgeConnector(createParams)

    expect(outcome).toMatchObject({ success: true, initialSyncQueued: false })
  })
})

const STORAGE_CONTEXT = {
  workspaceId: 'ws-1',
  billedAccountUserId: 'user-1',
  billingEntity: { type: 'organization', id: 'org-1' },
  plan: null,
  customStorageLimitGB: null,
}

function queueConnectorDeletionOwnerAndLock(accessMode = 'workspace', credentialGroupId?: string) {
  const owner = { id: 'kb-1', workspaceId: 'ws-1', organizationId: null, userId: 'user-1' }
  queueTableRows(schemaMock.knowledgeBase, [owner])
  queueTableRows(schemaMock.knowledgeBase, [owner])
  queueTableRows(schemaMock.knowledgeConnector, [{ accessMode, credentialGroupId }])
}

describe('performDeleteKnowledgeConnector', () => {
  beforeEach(() => {
    resetDbChainMock()
    queueConnectorDeletionOwnerAndLock()
    mockResolveStorageBillingContext.mockResolvedValue(STORAGE_CONTEXT)
    mockIncrementStorage.mockResolvedValue(30)
  })

  afterAll(resetDbChainMock)

  it('hides the connector and queues cleanup without deleting documents in the request', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', accessMode: 'workspace' },
    ])
    queueTableRows(document, [{ count: 501 }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'conn-1' }])

    const outcome = await performDeleteKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      deleteDocuments: true,
    })

    expect(outcome).toMatchObject({ success: true, documentsDeleted: 501, documentsKept: 0 })
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalledWith(document)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        deletedAt: expect.any(Date),
        status: 'disabled',
        memberSyncStatus: 'disabled',
        syncLockToken: null,
        memberSyncLockToken: null,
      })
    )
    expect(mockEnqueueConnectorDeletion).toHaveBeenCalledWith(expect.anything(), {
      knowledgeBaseId: KB.id,
      connectorId: 'conn-1',
      deletedAt: expect.any(String),
    })
  })

  it('fails the transaction without auditing success when cleanup cannot be queued', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', accessMode: 'workspace' },
    ])
    queueTableRows(document, [{ count: 2 }])
    mockEnqueueConnectorDeletion.mockRejectedValueOnce(new Error('Queue unavailable'))
    const outcome = await performDeleteKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      deleteDocuments: true,
    })
    expect(outcome).toMatchObject({ success: false })
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })

  it('refuses to keep documents whose files exceed the storage quota', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', accessMode: 'workspace' },
    ])
    queueTableRows(document, [{ count: 2, keptBytes: '30' }])
    mockIncrementStorage.mockRejectedValueOnce(new Error('Storage limit exceeded'))

    const outcome = await performDeleteKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
    })

    expect(outcome).toMatchObject({ success: false, error: 'Storage limit exceeded' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockEnqueueConnectorDetachment).not.toHaveBeenCalled()
    expect(mockNotifyStorage).not.toHaveBeenCalled()
  })
})

describe('performUpdateKnowledgeConnector', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockDispatchSync.mockResolvedValue({ queued: true })
    resolveBillingAttribution.mockResolvedValue(BILLING)
  })

  afterAll(resetDbChainMock)

  it('saves live permissions without indexing while protecting stale indexed ACLs', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        id: 'conn-1',
        knowledgeBaseId: 'kb-1',
        connectorType: 'notion',
        status: 'active',
        accessMode: 'admin',
        sourceConfig: {},
        updatedAt: new Date(),
      },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'conn-1', connectorType: 'notion' }])
    const write = vi.fn()
    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: { ...KB, isSearchIndex: true },
      connectorId: 'conn-1',
      updates: { status: 'active' },
      resolveBillingAttribution,
      permissionChange: {
        requiresAclReset: true,
        requiresContentSync: true,
        populateSyncContext: vi.fn(),
        write,
      },
    })
    expect(outcome.success).toBe(true)
    expect(write).toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        nextSyncAt: null,
        nextMemberSyncAt: null,
        accessRewritePending: true,
      })
    )
    expect(mockDispatchSync).not.toHaveBeenCalled()
    expect(mockDispatchMemberSync).not.toHaveBeenCalled()
    expect(resolveBillingAttribution).not.toHaveBeenCalled()
  })

  it.each(['permissions', 'token'] as const)(
    'commits a %s-only change without dispatching a content sync',
    async (change) => {
      const existing = {
        id: 'conn-1',
        connectorType: 'gitlab',
        accessMode: 'admin',
        status: 'active',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      }
      dbChainMockFns.limit.mockResolvedValueOnce([existing])
      dbChainMockFns.returning.mockResolvedValueOnce([existing])
      const write = vi.fn().mockResolvedValue(undefined)
      const outcome = await performUpdateKnowledgeConnector({
        ...ACTOR,
        knowledgeBase: KB,
        connectorId: existing.id,
        updates: {},
        permissionChange: {
          requiresAclReset: false,
          requiresContentSync: false,
          ...(change === 'token' ? { encryptedApiKey: 'encrypted-fixture-pat' } : {}),
          populateSyncContext: vi.fn(),
          write,
        },
        resolveBillingAttribution,
      })

      expect(outcome).toMatchObject({ success: true })
      expect(write).toHaveBeenCalledWith(expect.anything(), existing.id)
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ updatedFields: ['permissionConfig'] }),
        })
      )
      expect(mockDispatchSync).not.toHaveBeenCalled()
      expect(mockDispatchMemberSync).not.toHaveBeenCalled()
      expect(resolveBillingAttribution).not.toHaveBeenCalled()
      if (change === 'token') {
        expect(dbChainMockFns.set).toHaveBeenCalledWith(
          expect.objectContaining({ encryptedApiKey: 'encrypted-fixture-pat' })
        )
      }
    }
  )

  it('classifies a sub-hourly interval on an unentitled workspace as forbidden', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', accessMode: 'workspace' },
    ])
    mockHasWorkspaceLiveSyncAccess.mockResolvedValue(false)

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { syncIntervalMinutes: 5 },
      resolveBillingAttribution,
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'forbidden' })
    expect(mockHasWorkspaceLiveSyncAccess).toHaveBeenCalledWith('ws-1')
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

  it('returns the committed settings and leaves the source sync due when dispatch fails', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'conn-1',
        connectorType: 'notion',
        status: 'active',
        syncIntervalMinutes: 0,
      },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        id: 'conn-1',
        connectorType: 'notion',
        status: 'active',
        syncIntervalMinutes: 0,
      },
    ])
    mockDispatchSync.mockRejectedValueOnce(new Error('queue unavailable'))

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { sourceConfig: { database: 'next' } },
      resolveBillingAttribution,
      validateSourceConfig: async () => null,
    })

    expect(outcome).toMatchObject({
      success: true,
      connector: { id: 'conn-1' },
    })
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceConfig: { database: 'next' },
        nextSyncAt: expect.any(Date),
      })
    )
    expect(mockDispatchSync).toHaveBeenCalledOnce()
  })

  it('rejects an interval update that races with a source-sync due marker', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        { id: 'conn-1', connectorType: 'notion', nextSyncAt: null, status: 'active' },
      ])
      .mockResolvedValueOnce([
        {
          id: 'conn-1',
          connectorType: 'notion',
          nextSyncAt: new Date(),
          status: 'active',
        },
      ])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { syncIntervalMinutes: 0 },
      resolveBillingAttribution,
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(mockDispatchSync).not.toHaveBeenCalled()
  })

  it('fails before persisting when sync billing attribution cannot be resolved', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'active' },
    ])
    const rejectsBilling = vi.fn().mockRejectedValue(new Error('billing unavailable'))

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { sourceConfig: { database: 'next' } },
      resolveBillingAttribution: rejectsBilling,
      validateSourceConfig: async () => null,
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'internal' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockDispatchSync).not.toHaveBeenCalled()
  })

  it('refuses an update whose status moved after the guards ran', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ id: 'conn-1', connectorType: 'notion', status: 'pending' }])
      .mockResolvedValueOnce([{ id: 'conn-1', connectorType: 'notion', status: 'syncing' }])
    /** The CAS matches nothing because a worker took the lock in between. */
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { status: 'paused' },
    })

    /**
     * Leaving `pending` clears the lock columns. Landing that on a row that has
     * since gone `syncing` would wipe the token the run's heartbeat and terminal
     * write match on, stranding a sync that had already started.
     */
    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(mockRecordAudit).not.toHaveBeenCalled()

    /**
     * The mock does not evaluate predicates, so assert the clause itself is
     * present — an empty `returning()` alone would pass without it.
     */
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls.at(-2)?.[0],
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnector.status &&
          node.right === 'pending'
      )
    ).toBe(true)
  })
})

describe('performSyncKnowledgeConnector', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockDispatchSync.mockResolvedValue({ queued: true })
  })

  afterAll(resetDbChainMock)

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

  /**
   * The dispatch guards run after this operation's own, so they see state that
   * changed underneath it. Reporting their verdict is what stops a sync that was
   * never queued from being audited and reported as one that was.
   */
  it('reports a skipped dispatch, and records neither the audit nor the product event', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'active' },
    ])
    mockDispatchSync.mockResolvedValueOnce({
      queued: false,
      reason: 'A sync is already queued or running for this connector',
    })

    const outcome = await performSyncKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      resolveBillingAttribution,
    })

    expect(outcome).toMatchObject({
      success: false,
      errorCode: 'conflict',
      error: 'A sync is already queued or running for this connector',
    })
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})

describe('members-mode connectors', () => {
  const MEMBERS_CONNECTOR = {
    id: 'c-1',
    knowledgeBaseId: 'kb-1',
    connectorType: 'notion',
    credentialId: null,
    encryptedApiKey: null,
    sourceConfig: {},
    syncMode: 'full',
    syncIntervalMinutes: 1440,
    status: 'active',
    accessMode: 'members',
    credentialGroupId: 'group-1',
    credentialGroupOptionId: 'option-1',
    memberSyncStatus: 'idle',
    lastMemberSyncError: null,
  }

  beforeEach(() => {
    resetDbChainMock()
    mockDispatchSync.mockResolvedValue({ queued: true })
    mockDispatchMemberSync.mockResolvedValue({ queued: true })
    mockGrant.mockResolvedValue(undefined)
    mockRevoke.mockResolvedValue(undefined)
  })

  it('invalidates member cursors and freshness atomically when the source scope changes', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [MEMBERS_CONNECTOR])
    dbChainMockFns.returning.mockResolvedValueOnce([MEMBERS_CONNECTOR])
    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'c-1',
      updates: { sourceConfig: { database: 'different-scope' } },
      resolveBillingAttribution,
      validateSourceConfig: async () => null,
    })
    expect(outcome).toMatchObject({ success: true })
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        listingCheckpoint: null,
        changeCursor: null,
        memberSyncedThrough: null,
        lastCompleteListingAt: null,
        lastListedCount: null,
        nextAttemptAt: expect.any(Date),
      })
    )
    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.knowledgeConnectorMember)
    expect(mockDispatchMemberSync).toHaveBeenCalledOnce()
  })

  it('refuses to keep the documents of a connector that syncs per member', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [MEMBERS_CONNECTOR])

    const outcome = await performDeleteKnowledgeConnector({
      knowledgeBase: KB,
      connectorId: 'c-1',
      deleteDocuments: false,
      ...ACTOR,
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('refuses a manual sync while a member run is queued or running', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      { ...MEMBERS_CONNECTOR, memberSyncStatus: 'running' },
    ])

    const outcome = await performSyncKnowledgeConnector({
      knowledgeBase: KB,
      connectorId: 'c-1',
      resolveBillingAttribution,
      ...ACTOR,
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(mockDispatchMemberSync).not.toHaveBeenCalled()
  })

  /** A CAS clause of the last connector update, found by shape since the mock evaluates nothing. */
  function updateCasHas(predicate: (node: MockCondition) => boolean): boolean {
    return hasMockCondition(dbChainMockFns.where.mock.calls.at(-1)?.[0], predicate)
  }

  it('refuses a config edit while a member run is queued, but lets a pause release the entry', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      { ...MEMBERS_CONNECTOR, memberSyncStatus: 'pending', memberSyncLockToken: 'd-1' },
    ])

    const refused = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'c-1',
      updates: { syncIntervalMinutes: 30 },
      resolveBillingAttribution,
    })
    expect(refused).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()

    queueTableRows(schemaMock.knowledgeConnector, [
      { ...MEMBERS_CONNECTOR, memberSyncStatus: 'pending', memberSyncLockToken: 'd-1' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ ...MEMBERS_CONNECTOR, status: 'paused' }])

    const paused = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'c-1',
      updates: { status: 'paused' },
      resolveBillingAttribution,
    })

    /**
     * The queued task starts without re-checking `status`, so the entry has to
     * go for the pause to hold; the CAS keeps that off a run that has started.
     */
    expect(paused).toMatchObject({ success: true })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'paused',
        memberSyncStatus: 'idle',
        memberSyncLockToken: null,
        memberSyncLockLeaseAt: null,
      })
    )
    expect(
      updateCasHas(
        (node) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnector.memberSyncStatus &&
          node.right === 'pending'
      )
    ).toBe(true)
  })

  it('reuses a matching Search source without inserting, redispatching, or recording another creation', async () => {
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        ...MEMBERS_CONNECTOR,
        connectorType: 'google_drive',
        sourceConfig: { folderId: 'one' },
      },
    ])
    const outcome = await performCreateKnowledgeConnector({
      knowledgeBase: KB,
      connectorType: 'google_drive',
      sourceConfig: { folderId: 'one' },
      syncIntervalMinutes: 60,
      reuseSearchSource: true,
      membersBinding: { credentialGroupId: 'group-1', credentialGroupOptionId: 'option-1' },
      resolveBillingAttribution,
      resolveAccessToken: vi.fn(),
      ...ACTOR,
    })
    expect(outcome).toMatchObject({
      success: true,
      reused: true,
      connector: { id: MEMBERS_CONNECTOR.id },
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mockDispatchMemberSync).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockRevoke).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: expect.any(String) }),
      ACTOR.userId
    )
    expect(mockRevoke.mock.calls[0][0].connectorId).not.toBe(MEMBERS_CONNECTOR.id)
  })

  it('does not reuse matching settings bound to a different account option', async () => {
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        ...MEMBERS_CONNECTOR,
        connectorType: 'google_drive',
        sourceConfig: {},
        credentialGroupOptionId: 'another-option',
      },
    ])
    const outcome = await performCreateKnowledgeConnector({
      knowledgeBase: KB,
      connectorType: 'google_drive',
      sourceConfig: {},
      syncIntervalMinutes: 60,
      reuseSearchSource: true,
      membersBinding: { credentialGroupId: 'group-1', credentialGroupOptionId: 'option-1' },
      resolveBillingAttribution,
      resolveAccessToken: vi.fn(),
      ...ACTOR,
    })
    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mockDispatchMemberSync).not.toHaveBeenCalled()
  })

  it('refuses members mode for a connector whose listing is not permission scoped, before any grant', async () => {
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([MEMBERS_CONNECTOR])

    const outcome = await performCreateKnowledgeConnector({
      knowledgeBase: KB,
      connectorType: 'notion',
      sourceConfig: {},
      syncIntervalMinutes: 1440,
      membersBinding: { credentialGroupId: 'group-1', credentialGroupOptionId: 'option-1' },
      resolveBillingAttribution,
      resolveAccessToken: vi.fn(),
      ...ACTOR,
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'validation' })
    expect(mockGrant).not.toHaveBeenCalled()
  })
})

describe('withoutSecret', () => {
  it('drops the stored API key and the members-mode reconcile cursor from what callers receive', () => {
    const row = {
      id: 'conn-1',
      connectorType: 'notion',
      encryptedApiKey: 'cipher',
      memberTombstoneCursor: { externalId: 'hidden-document' },
    } as unknown as Parameters<typeof withoutSecret>[0]
    const presented = withoutSecret(row)
    expect(presented).toEqual({ id: 'conn-1', connectorType: 'notion' })
    expect(presented).not.toHaveProperty('memberTombstoneCursor')
  })
})
