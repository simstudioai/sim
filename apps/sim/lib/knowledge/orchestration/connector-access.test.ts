/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  grant: vi.fn(),
  revoke: vi.fn(),
  validateBinding: vi.fn(),
  loadGroup: vi.fn(),
  dispatchSync: vi.fn(),
  dispatchMemberSync: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {},
  AuditResourceType: {},
  recordAudit: vi.fn(),
}))
vi.mock('@/lib/api-key/crypto', () => ({ encryptApiKey: vi.fn() }))
vi.mock('@/lib/billing/core/subscription', () => ({ hasWorkspaceLiveSyncAccess: vi.fn() }))
vi.mock('@/lib/knowledge/documents/service', () => ({
  deleteDocumentStorageFiles: vi.fn(),
}))
vi.mock('@/lib/knowledge/tags/service', () => ({
  cleanupUnusedTagDefinitions: vi.fn(),
  createTagDefinition: vi.fn(),
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('@/lib/knowledge/connectors/member-access', () => ({
  grantKnowledgeConnectorCredentialAccess: mocks.grant,
  revokeKnowledgeConnectorCredentialAccess: mocks.revoke,
  validateKnowledgeConnectorMembersBinding: mocks.validateBinding,
  findListingCapViolation: vi.fn(() => null),
}))
vi.mock('@/lib/credential-groups/credentials', () => ({
  loadCredentialGroupCredentialListContext: mocks.loadGroup,
}))
vi.mock('@/lib/knowledge/connectors/queue', () => ({ dispatchSync: mocks.dispatchSync }))
vi.mock('@/lib/knowledge/connectors/member-queue', () => ({
  dispatchMemberSync: mocks.dispatchMemberSync,
}))

import {
  performUpdateKnowledgeConnectorAccess,
  resolveKnowledgeConnectorMembersBinding,
} from '@/lib/knowledge/orchestration/connector-access'

const KB = { id: 'kb-1', name: 'Docs', workspaceId: 'ws-1' }
const ACTOR = { userId: 'admin-1', source: 'ui' as const, requestId: 'req-1' }
const BILLING = { actorUserId: 'admin-1', workspaceId: 'ws-1' } as never
const resolveBillingAttribution = vi.fn().mockResolvedValue(BILLING)

const WORKSPACE_CONNECTOR = {
  id: 'c-1',
  knowledgeBaseId: 'kb-1',
  connectorType: 'google_drive',
  credentialId: 'cred-1',
  encryptedApiKey: null,
  sourceConfig: { folderId: ['f-1'] },
  syncMode: 'full',
  syncIntervalMinutes: 1440,
  accessMode: 'workspace',
  credentialGroupId: null,
  credentialGroupOptionId: null,
  memberSyncStatus: 'idle',
  status: 'active',
  syncLockToken: null,
  memberSyncLockToken: null,
}

const MEMBERS_CONNECTOR = {
  ...WORKSPACE_CONNECTOR,
  credentialId: null,
  accessMode: 'members',
  credentialGroupId: 'group-1',
  credentialGroupOptionId: 'option-1',
}

const BINDING = {
  credentialGroupId: 'group-1',
  credentialGroupOptionId: 'option-1',
  workspaceId: 'ws-1',
}

function switchTo(target: Parameters<typeof performUpdateKnowledgeConnectorAccess>[0]['target']) {
  return performUpdateKnowledgeConnectorAccess({
    knowledgeBase: KB,
    connectorId: 'c-1',
    target,
    resolveBillingAttribution,
    ...ACTOR,
  })
}

describe('resolveKnowledgeConnectorMembersBinding', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refuses a group from another workspace before validating anything', async () => {
    mocks.loadGroup.mockResolvedValue({ workspaceId: 'ws-2', status: 'active', options: [] })
    await expect(
      resolveKnowledgeConnectorMembersBinding({
        workspaceId: 'ws-1',
        connectorMeta: {} as never,
        binding: { credentialGroupId: 'group-1', credentialGroupOptionId: 'option-1' },
        sourceConfig: {},
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.validateBinding).not.toHaveBeenCalled()
  })

  it('surfaces the validator refusal as a validation error', async () => {
    mocks.loadGroup.mockResolvedValue({ workspaceId: 'ws-1', status: 'active', options: [] })
    mocks.validateBinding.mockReturnValue({ ok: false, message: 'Max Files cannot be set' })
    await expect(
      resolveKnowledgeConnectorMembersBinding({
        workspaceId: 'ws-1',
        connectorMeta: {} as never,
        binding: { credentialGroupId: 'group-1', credentialGroupOptionId: 'option-1' },
        sourceConfig: { maxFiles: '5' },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'Max Files cannot be set' })
  })
})

describe('performUpdateKnowledgeConnectorAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.grant.mockResolvedValue(undefined)
    mocks.revoke.mockResolvedValue(undefined)
    mocks.dispatchSync.mockResolvedValue({ queued: true })
    mocks.dispatchMemberSync.mockResolvedValue({ queued: true })
  })

  it('is a no-op when the connector already has the requested binding', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [MEMBERS_CONNECTOR])

    const outcome = await switchTo({ accessMode: 'members', binding: BINDING })

    expect(outcome).toMatchObject({ success: true, changed: false })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.grant).not.toHaveBeenCalled()
  })

  it('refuses while a sync of either engine owns the connector', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [WORKSPACE_CONNECTOR])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const outcome = await switchTo({ accessMode: 'members', binding: BINDING })

    expect(outcome).toEqual({
      success: false,
      error: 'Sync already in progress',
      errorCode: 'conflict',
    })
    expect(mocks.grant).not.toHaveBeenCalled()
  })

  it('hides the documents, grants the option, flips to members mode, and queues the first member run', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [WORKSPACE_CONNECTOR])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ ...WORKSPACE_CONNECTOR, status: 'syncing', syncLockToken: 's-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...MEMBERS_CONNECTOR, nextMemberSyncAt: new Date() }])

    const outcome = await switchTo({ accessMode: 'members', binding: BINDING })

    expect(outcome).toMatchObject({ success: true, changed: true })
    expect(mocks.grant).toHaveBeenCalledWith(
      {
        workspaceId: 'ws-1',
        credentialGroupId: 'group-1',
        credentialGroupOptionId: 'option-1',
        connectorId: 'c-1',
      },
      'admin-1'
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ acl: [] }))
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        accessMode: 'members',
        credentialId: null,
        credentialGroupId: 'group-1',
        credentialGroupOptionId: 'option-1',
        accessRewritePending: false,
        nextSyncAt: null,
        nextMemberSyncAt: expect.any(Date),
        status: 'active',
        syncLockToken: null,
      })
    )
    expect(mocks.dispatchMemberSync).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({ billingAttribution: BILLING, requireRunnable: true })
    )
    expect(mocks.dispatchSync).not.toHaveBeenCalled()
  })

  it('drops the members, restores workspace access, revokes the grant, flips, and queues a content sync', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [MEMBERS_CONNECTOR])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ ...MEMBERS_CONNECTOR, status: 'syncing', syncLockToken: 's-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...WORKSPACE_CONNECTOR, credentialId: 'cred-2' }])

    const outcome = await switchTo({ accessMode: 'workspace', credentialId: 'cred-2' })

    expect(outcome).toMatchObject({ success: true, changed: true })
    expect(dbChainMockFns.delete).toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ acl: ['ws'] }))
    expect(mocks.revoke).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', credentialGroupId: 'group-1', connectorId: 'c-1' },
      'admin-1'
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        accessMode: 'workspace',
        credentialId: 'cred-2',
        credentialGroupId: null,
        credentialGroupOptionId: null,
        nextMemberSyncAt: null,
        nextSyncAt: expect.any(Date),
      })
    )
    expect(mocks.dispatchSync).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({ billingAttribution: BILLING, requireRunnable: true })
    )
    expect(mocks.dispatchMemberSync).not.toHaveBeenCalled()
  })

  it('leaves a paused connector paused and queues nothing', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [{ ...WORKSPACE_CONNECTOR, status: 'paused' }])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ ...WORKSPACE_CONNECTOR, status: 'paused' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...MEMBERS_CONNECTOR, status: 'paused' }])

    await switchTo({ accessMode: 'members', binding: BINDING })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ accessMode: 'members', status: 'paused' })
    )
    expect(mocks.dispatchMemberSync).not.toHaveBeenCalled()
  })

  it('releases the lease and reports the failure when the grant cannot be written', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [WORKSPACE_CONNECTOR])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ ...WORKSPACE_CONNECTOR, status: 'syncing', syncLockToken: 's-1' }])
      .mockResolvedValueOnce([])
    mocks.grant.mockRejectedValueOnce(new Error('policy store unavailable'))

    const outcome = await switchTo({ accessMode: 'members', binding: BINDING })

    expect(outcome).toMatchObject({ success: false, errorCode: 'internal' })
    expect(dbChainMockFns.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'active', syncLockToken: null, syncLockLeaseAt: null })
    )
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ accessMode: 'members' })
    )
  })
})
