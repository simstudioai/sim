/**
 * @vitest-environment node
 */
import { document } from '@sim/db/schema'
import {
  dbChainMockFns,
  hasMockCondition,
  type MockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
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
      validateConfig: vi.fn().mockResolvedValue({ valid: true }),
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

import {
  performCreateKnowledgeConnector,
  performDeleteKnowledgeConnector,
  performSyncKnowledgeConnector,
  performUpdateKnowledgeConnector,
} from '@/lib/knowledge/orchestration/connectors'

const KB = { id: 'kb-1', name: 'Docs', workspaceId: 'ws-1' }
const ACTOR = { userId: 'user-1', source: 'agent' as const, requestId: 'req-1' }
const BILLING = { actorUserId: 'user-1', workspaceId: 'ws-1' } as never
const resolveBillingAttribution = vi.fn().mockResolvedValue(BILLING)

describe('performCreateKnowledgeConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it.each([
    { connectorType: 'google_drive', apiKey: 'token', error: 'requires an OAuth account' },
    {
      connectorType: 'github',
      apiKey: 'token',
      credentialId: 'credential-1',
      error: 'Choose either',
    },
    {
      connectorType: 'github',
      apiKey: 'token',
      accessMode: 'members' as const,
      error: 'requires an OAuth account',
    },
  ])(
    'rejects invalid authentication combinations before source access or storage: $connectorType $accessMode',
    async ({ error, ...input }) => {
      const result = await performCreateKnowledgeConnector({ ...createParams, ...input })
      expect(result).toMatchObject({
        success: false,
        errorCode: 'validation',
        error: expect.stringContaining(error),
      })
      expect(mockValidateGitHub).not.toHaveBeenCalled()
      expect(mockEncryptApiKey).not.toHaveBeenCalled()
      expect(createParams.resolveAccessToken).not.toHaveBeenCalled()
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    }
  )

  it('continues to resolve an explicitly selected GitHub OAuth account', async () => {
    queueSuccessfulInsert()
    createParams.resolveAccessToken.mockResolvedValueOnce({ accessToken: 'oauth-token' })
    const result = await performCreateKnowledgeConnector({
      ...createParams,
      connectorType: 'github',
      credentialId: 'credential-1',
    })
    expect(result.success).toBe(true)
    expect(createParams.resolveAccessToken).toHaveBeenCalledWith('credential-1')
    expect(mockValidateGitHub).toHaveBeenCalledWith('oauth-token', {}, { mirrorsSourceAcls: false })
    expect(mockEncryptApiKey).not.toHaveBeenCalled()
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: 'credential-1',
        encryptedApiKey: null,
      })
    )
  })

  /**
   * A detached dispatch settles after the caller has already been handed the
   * connector, so its outcome could never reach the response.
   */
  it('waits for the initial sync dispatch before returning', async () => {
    queueSuccessfulInsert()
    let dispatchSettled = false
    mockDispatchSync.mockImplementationOnce(() =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 1)
      }).then(() => {
        dispatchSettled = true
        return { queued: true }
      })
    )

    const outcome = await performCreateKnowledgeConnector(createParams)

    expect(dispatchSettled).toBe(true)
    expect(outcome).toMatchObject({ success: true, initialSyncQueued: true })
  })

  it('reports a failed initial dispatch instead of claiming the sync was queued', async () => {
    queueSuccessfulInsert()
    mockDispatchSync.mockRejectedValueOnce(new Error('queue unavailable'))

    const outcome = await performCreateKnowledgeConnector(createParams)

    expect(outcome).toMatchObject({ success: true, initialSyncQueued: false })
  })

  /**
   * A dispatch that declines to queue is as invisible to the caller as one that
   * throws: the connector is created either way, so the only signal that its
   * first sync never started is this flag.
   */
  it('reports a skipped initial dispatch the same as a failed one', async () => {
    queueSuccessfulInsert()
    mockDispatchSync.mockResolvedValueOnce({
      queued: false,
      reason: 'A sync is already queued or running for this connector',
    })

    const outcome = await performCreateKnowledgeConnector(createParams)

    expect(outcome).toMatchObject({ success: true, initialSyncQueued: false })
  })
})

describe('performDeleteKnowledgeConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterAll(resetDbChainMock)

  it('reports the documents it kept, so the caller cannot claim otherwise', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', accessMode: 'workspace' },
    ])
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
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', accessMode: 'workspace' },
    ])
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
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', accessMode: 'workspace' },
    ])
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
    mockDispatchSync.mockResolvedValue({ queued: true })
    resolveBillingAttribution.mockResolvedValue(BILLING)
  })

  afterAll(resetDbChainMock)

  it('rejects an update that names nothing before reading the connector', async () => {
    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: {},
      resolveBillingAttribution,
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'validation' })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

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

  it('leaves a caller-supplied validator to reject a bad source config', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', accessMode: 'workspace' },
    ])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { sourceConfig: { database: 'gone' } },
      resolveBillingAttribution,
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
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', accessMode: 'workspace' },
    ])

    // A stale stored credential kept the route's 401; collapsing every
    // rejection to `validation` had flattened it (and the 409) into a 400.
    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { sourceConfig: { database: 'x' } },
      resolveBillingAttribution,
      validateSourceConfig: async () => ({
        message: 'Failed to refresh access token. Please reconnect your account.',
        errorCode: 'unauthorized' as const,
      }),
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'unauthorized' })
  })

  it('clears the failure counters when a paused connector is resumed', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', accessMode: 'workspace' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'active' },
    ])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { status: 'active' },
      resolveBillingAttribution,
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
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', accessMode: 'workspace' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'paused' },
    ])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { status: 'paused' },
      resolveBillingAttribution,
      recordSemanticAudit: false,
    })

    expect(outcome).toMatchObject({ success: true })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('queues synchronization after replacing an active connector source', async () => {
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

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { sourceConfig: { database: 'next' } },
      resolveBillingAttribution,
      validateSourceConfig: async () => null,
    })

    expect(outcome).toMatchObject({ success: true })
    expect(resolveBillingAttribution).toHaveBeenCalledOnce()
    expect(mockDispatchSync).toHaveBeenCalledWith('conn-1', {
      billingAttribution: BILLING,
      expectedNextSyncAt: expect.any(Date),
      requestId: 'req-1',
      requireRunnable: true,
    })
  })

  it('reports a queue failure and leaves the source sync due for retry', async () => {
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
      success: false,
      errorCode: 'internal',
      error: 'queue unavailable',
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

  it('saves a paused connector source without synchronizing it', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'paused' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'paused' },
    ])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { sourceConfig: { database: 'next' } },
      resolveBillingAttribution,
      validateSourceConfig: async () => null,
    })

    expect(outcome).toMatchObject({ success: true })
    expect(resolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockDispatchSync).not.toHaveBeenCalled()
  })

  it('does not synchronize a schedule-only update', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'active' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'active' },
    ])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { syncIntervalMinutes: 60 },
      resolveBillingAttribution,
    })

    expect(outcome).toMatchObject({ success: true })
    expect(resolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockDispatchSync).not.toHaveBeenCalled()
  })

  it('clears an already-due source sync when scheduled sync is disabled', async () => {
    const pendingSourceSyncAt = new Date(0)
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'conn-1',
        connectorType: 'notion',
        nextSyncAt: pendingSourceSyncAt,
        status: 'active',
      },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        id: 'conn-1',
        connectorType: 'notion',
        nextSyncAt: pendingSourceSyncAt,
        status: 'active',
      },
    ])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { syncIntervalMinutes: 0 },
      resolveBillingAttribution,
    })

    expect(outcome).toMatchObject({ success: true })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ nextSyncAt: null, syncIntervalMinutes: 0 })
    )
    expect(mockDispatchSync).not.toHaveBeenCalled()
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

  it('rejects a source replacement while synchronization is in progress', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'syncing' },
    ])
    const validateSourceConfig = vi.fn()

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { sourceConfig: { database: 'next' } },
      resolveBillingAttribution,
      validateSourceConfig,
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(validateSourceConfig).not.toHaveBeenCalled()
    expect(resolveBillingAttribution).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('rejects a schedule change while synchronization is in progress', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'syncing' },
    ])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { syncIntervalMinutes: 0 },
      resolveBillingAttribution,
    })

    expect(outcome).toMatchObject({
      success: false,
      error: 'Sync already in progress',
      errorCode: 'conflict',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('rejects a schedule change that races with synchronization startup', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        { id: 'conn-1', connectorType: 'notion', nextSyncAt: null, status: 'active' },
      ])
      .mockResolvedValueOnce([
        { id: 'conn-1', connectorType: 'notion', nextSyncAt: null, status: 'syncing' },
      ])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { syncIntervalMinutes: 0 },
      resolveBillingAttribution,
    })

    expect(outcome).toMatchObject({
      success: false,
      error: 'Sync already in progress',
      errorCode: 'conflict',
    })
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

  it('rejects a source replacement that races with a pause', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ id: 'conn-1', connectorType: 'notion', status: 'active' }])
      .mockResolvedValueOnce([{ id: 'conn-1', connectorType: 'notion', status: 'paused' }])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { sourceConfig: { database: 'next' } },
      resolveBillingAttribution,
      validateSourceConfig: async () => null,
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(mockDispatchSync).not.toHaveBeenCalled()
  })

  it('rejects a pause that races with synchronization startup', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ id: 'conn-1', connectorType: 'notion', status: 'active' }])
      .mockResolvedValueOnce([{ id: 'conn-1', connectorType: 'notion', status: 'syncing' }])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      updates: { status: 'paused' },
      resolveBillingAttribution,
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
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
    vi.clearAllMocks()
    resetDbChainMock()
    mockDispatchSync.mockResolvedValue({ queued: true })
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

  it.each(['pending', 'paused', 'disabled'] as const)(
    'refuses an on-demand sync on a %s connector',
    async (status) => {
      dbChainMockFns.limit.mockResolvedValueOnce([
        { id: 'conn-1', connectorType: 'notion', status },
      ])

      const outcome = await performSyncKnowledgeConnector({
        ...ACTOR,
        knowledgeBase: KB,
        connectorId: 'conn-1',
        resolveBillingAttribution,
      })

      /**
       * `pending` already has a run queued. `paused`/`disabled` have no way
       * back: queueing overwrites `status`, and every exit from the run writes
       * its own verdict — success writes `active`, a lost queue entry writes
       * `error`, which the due-sweep then keeps syncing. One "Sync now" would
       * silently resume the connector for good.
       */
      expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
      expect(resolveBillingAttribution).not.toHaveBeenCalled()
      expect(mockDispatchSync).not.toHaveBeenCalled()
    }
  )

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

  it('reports a failed dispatch instead of claiming the sync was queued', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'conn-1', connectorType: 'notion', status: 'active' },
    ])
    mockDispatchSync.mockRejectedValueOnce(new Error('queue unavailable'))

    const outcome = await performSyncKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'conn-1',
      resolveBillingAttribution,
    })

    expect(outcome).toMatchObject({ success: false })
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
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
    vi.clearAllMocks()
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

  it('revokes the credential grant once the connector and its documents are gone', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [MEMBERS_CONNECTOR])
    queueTableRows(schemaMock.document, [])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'c-1' }])

    const outcome = await performDeleteKnowledgeConnector({
      knowledgeBase: KB,
      connectorId: 'c-1',
      deleteDocuments: true,
      ...ACTOR,
    })

    expect(outcome).toMatchObject({ success: true })
    expect(mockRevoke).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', credentialGroupId: 'group-1', connectorId: 'c-1' },
      'user-1'
    )
  })

  it('routes a manual sync of a members-mode connector to the member queue', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [MEMBERS_CONNECTOR])

    const outcome = await performSyncKnowledgeConnector({
      knowledgeBase: KB,
      connectorId: 'c-1',
      resolveBillingAttribution,
      ...ACTOR,
    })

    expect(outcome).toEqual({ success: true })
    expect(mockDispatchMemberSync).toHaveBeenCalledWith('c-1', {
      billingAttribution: BILLING,
      requestId: 'req-1',
    })
    expect(mockDispatchSync).not.toHaveBeenCalled()
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

  it('writes an interval change to the member schedule, which is what the member scheduler reads', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      { ...MEMBERS_CONNECTOR, nextSyncAt: null, nextMemberSyncAt: null },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([MEMBERS_CONNECTOR])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'c-1',
      updates: { syncIntervalMinutes: 60 },
      resolveBillingAttribution,
    })

    expect(outcome).toMatchObject({ success: true })
    const values = dbChainMockFns.set.mock.calls[0][0]
    expect(values).toMatchObject({ syncIntervalMinutes: 60, nextMemberSyncAt: expect.any(Date) })
    expect(values).not.toHaveProperty('nextSyncAt')
    expect(
      updateCasHas(
        (node) =>
          node.type === 'isNull' && node.column === schemaMock.knowledgeConnector.nextMemberSyncAt
      )
    ).toBe(true)
    expect(mockDispatchMemberSync).not.toHaveBeenCalled()
  })

  it('clears the member schedule when scheduled sync is turned off', async () => {
    const scheduled = new Date(Date.now() + 60 * 60 * 1000)
    queueTableRows(schemaMock.knowledgeConnector, [
      { ...MEMBERS_CONNECTOR, nextSyncAt: null, nextMemberSyncAt: scheduled },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([MEMBERS_CONNECTOR])

    await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'c-1',
      updates: { syncIntervalMinutes: 0 },
      resolveBillingAttribution,
    })

    expect(dbChainMockFns.set.mock.calls[0][0]).toMatchObject({
      syncIntervalMinutes: 0,
      nextMemberSyncAt: null,
    })
    expect(
      updateCasHas(
        (node) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnector.nextMemberSyncAt &&
          node.right === scheduled
      )
    ).toBe(true)
  })

  it('resumes a paused members-mode connector by making its member run due', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      { ...MEMBERS_CONNECTOR, status: 'paused', nextSyncAt: null, nextMemberSyncAt: null },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([MEMBERS_CONNECTOR])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'c-1',
      updates: { status: 'active' },
      resolveBillingAttribution,
    })

    expect(outcome).toMatchObject({ success: true })
    const values = dbChainMockFns.set.mock.calls[0][0]
    expect(values).toMatchObject({ status: 'active', nextMemberSyncAt: expect.any(Date) })
    expect(values).not.toHaveProperty('nextSyncAt')
  })

  it('refuses any edit while a member run is running', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      { ...MEMBERS_CONNECTOR, memberSyncStatus: 'running' },
    ])

    const outcome = await performUpdateKnowledgeConnector({
      ...ACTOR,
      knowledgeBase: KB,
      connectorId: 'c-1',
      updates: { sourceConfig: { database: 'other' } },
      resolveBillingAttribution,
    })

    /**
     * The member run reads `sourceConfig` once at its start and reconciles
     * against it, exactly as the content engine does; `status` stays `active`
     * throughout, so only the member lease shows the row is owned.
     */
    expect(outcome).toMatchObject({
      success: false,
      errorCode: 'conflict',
      error: 'Sync already in progress',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

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

  it('binds a new members-mode connector under the group lock', async () => {
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.credentialGroup, [{ options: [{ id: 'option-1' }] }])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { ...MEMBERS_CONNECTOR, connectorType: 'google_drive' },
    ])

    const outcome = await performCreateKnowledgeConnector({
      knowledgeBase: KB,
      connectorType: 'google_drive',
      sourceConfig: {},
      syncIntervalMinutes: 1440,
      membersBinding: { credentialGroupId: 'group-1', credentialGroupOptionId: 'option-1' },
      resolveBillingAttribution,
      resolveAccessToken: vi.fn(),
      ...ACTOR,
    })

    expect(outcome).toMatchObject({ success: true })
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.insert).toHaveBeenCalledOnce()
    expect(mockRevoke).not.toHaveBeenCalled()
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

  it('refuses to create a members-mode connector on an option removed before the group was locked', async () => {
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.credentialGroup, [{ options: [{ id: 'option-2' }] }])

    const outcome = await performCreateKnowledgeConnector({
      knowledgeBase: KB,
      connectorType: 'google_drive',
      sourceConfig: {},
      syncIntervalMinutes: 1440,
      membersBinding: { credentialGroupId: 'group-1', credentialGroupOptionId: 'option-1' },
      resolveBillingAttribution,
      resolveAccessToken: vi.fn(),
      ...ACTOR,
    })

    /**
     * The group's option edit refuses while a connector row is bound to what it
     * removes, and this row is written under the same lock, so the two can
     * never both commit: the grant is undone and no row is inserted.
     */
    expect(outcome).toMatchObject({ success: false, errorCode: 'validation' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mockRevoke).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', credentialGroupId: 'group-1', connectorId: expect.any(String) },
      'user-1'
    )
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
