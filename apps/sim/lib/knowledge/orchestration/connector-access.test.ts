import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  grant: vi.fn(),
  revoke: vi.fn(),
  validateBinding: vi.fn(),
  loadGroup: vi.fn(),
  dispatchSync: vi.fn(),
  dispatchMemberSync: vi.fn(),
  memberAccessAvailable: vi.fn(),
  provision: vi.fn(),
  rewriteAcls: vi.fn(),
}))

vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    google_drive: { configFields: [], permissionScopedListing: { capFieldIds: [] } },
  },
}))

vi.mock('@/lib/knowledge/connectors/member-observations', () => ({
  rewriteConnectorAcls: mocks.rewriteAcls,
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
  stripListingCapFields: (_meta: unknown, sourceConfig: Record<string, unknown>) => sourceConfig,
}))
vi.mock('@/lib/credential-groups/credentials', () => ({
  loadScopedAccountsCredentialListContext: mocks.loadGroup,
}))
vi.mock('@/lib/knowledge/access/availability', async () => {
  const { OrchestrationError } = await import('@/lib/core/orchestration/types')
  return {
    isKnowledgeMemberAccessAvailable: mocks.memberAccessAvailable,
    requireKnowledgeMemberAccessAvailable: async (context: { workspaceId: string }) => {
      if (await mocks.memberAccessAvailable(context)) return
      throw new OrchestrationError(
        'validation',
        'Per-member access is not available for this workspace'
      )
    },
  }
})
vi.mock('@/lib/knowledge/connectors/member-provisioning', () => ({
  provisionKnowledgeConnectorMembersBinding: mocks.provision,
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
  updatedAt: new Date('2026-09-01T00:00:00Z'),
}

const _MEMBERS_CONNECTOR = {
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

/** The group row the flip locks; `optionIds` are the options it still has. */
function queueGroupRow(...optionIds: string[]) {
  queueTableRows(schemaMock.credentialGroup, [
    { options: optionIds.map((id) => ({ id, provider: 'google-drive', status: 'active' })) },
  ])
}

/** The values of the `set()` call that wrote `field`, so a test can read what a later call must repeat. */
function setCallWith(field: string): Record<string, unknown> {
  const call = dbChainMockFns.set.mock.calls.find(([values]) => field in values)
  if (!call) throw new Error(`No set() call wrote ${field}`)
  return call[0]
}

/** The `set()` calls carrying `field`, in order. */
function setCallsWith(field: string): Record<string, unknown>[] {
  return dbChainMockFns.set.mock.calls.filter(([values]) => field in values).map(([v]) => v)
}

const SCOPED_META = {
  name: 'Google Drive',
  auth: { mode: 'oauth', provider: 'google-drive' },
  permissionScopedListing: { capFieldIds: [] },
  configFields: [],
} as never

describe('resolveKnowledgeConnectorMembersBinding', () => {
  beforeEach(() => {
    mocks.memberAccessAvailable.mockResolvedValue(true)
    mocks.provision.mockResolvedValue({
      credentialGroupId: 'group-1',
      credentialGroupOptionId: 'option-1',
    })
  })

  it('refuses a connector whose listing is not permission-scoped, before loading anything', async () => {
    await expect(
      resolveKnowledgeConnectorMembersBinding({
        workspaceId: 'ws-1',
        connectorMeta: { name: 'Slack', auth: { mode: 'oauth' }, configFields: [] } as never,
        actingUserId: 'admin-1',
        sourceConfig: {},
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.provision).not.toHaveBeenCalled()
    expect(mocks.loadGroup).not.toHaveBeenCalled()
  })

  it('refuses members mode where the feature is off, before loading anything', async () => {
    mocks.memberAccessAvailable.mockResolvedValue(false)
    await expect(
      resolveKnowledgeConnectorMembersBinding({
        workspaceId: 'ws-1',
        connectorMeta: SCOPED_META,
        actingUserId: 'admin-1',
        sourceConfig: {},
      })
    ).rejects.toMatchObject({ message: 'Per-member access is not available for this workspace' })
    expect(mocks.memberAccessAvailable).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(mocks.loadGroup).not.toHaveBeenCalled()
  })

  it('refuses a group from another workspace before validating anything', async () => {
    mocks.loadGroup.mockResolvedValue({ workspaceId: 'ws-2', status: 'active', options: [] })
    await expect(
      resolveKnowledgeConnectorMembersBinding({
        workspaceId: 'ws-1',
        connectorMeta: SCOPED_META,
        actingUserId: 'admin-1',
        sourceConfig: {},
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.validateBinding).not.toHaveBeenCalled()
  })
})

describe('performUpdateKnowledgeConnectorAccess', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.rewriteAcls.mockResolvedValue(true)
    mocks.grant.mockResolvedValue(undefined)
    mocks.revoke.mockResolvedValue(undefined)
    mocks.dispatchSync.mockResolvedValue({ queued: true })
    mocks.dispatchMemberSync.mockResolvedValue({ queued: true })
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

  it('refuses the flip, and undoes the grant, when the option is gone by the time the group is locked', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [WORKSPACE_CONNECTOR])
    queueGroupRow()
    dbChainMockFns.returning.mockResolvedValueOnce([
      { ...WORKSPACE_CONNECTOR, status: 'syncing', syncLockToken: 's-1' },
    ])

    const outcome = await switchTo({ accessMode: 'members', binding: BINDING })

    expect(outcome).toMatchObject({ success: false, errorCode: 'validation' })
    expect(setCallsWith('accessMode')).toEqual([])
    expect(mocks.revoke).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', credentialGroupId: 'group-1', connectorId: 'c-1' },
      'admin-1'
    )
    expect(dbChainMockFns.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'active', syncLockToken: null })
    )
    expect(mocks.dispatchMemberSync).not.toHaveBeenCalled()
  })

  /**
   * The bug this pins: administrator mode hides on entry, and a flip that
   * landed before the rewrite showed every workspace-visible document under a
   * mode whose reader expects source ACLs. The rewrite must precede the flip,
   * exactly as it does for members mode.
   */
  it('hides the documents before flipping to administrator mode, then queues a content sync', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [WORKSPACE_CONNECTOR])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ ...WORKSPACE_CONNECTOR, status: 'syncing', syncLockToken: 's-1' }])
      .mockResolvedValueOnce([{ id: 'c-1' }])
      .mockResolvedValueOnce([
        { ...WORKSPACE_CONNECTOR, accessMode: 'admin', credentialId: 'cred-2' },
      ])

    const outcome = await switchTo({ accessMode: 'admin', credentialId: 'cred-2' })

    expect(outcome).toMatchObject({ success: true, changed: true })
    expect(mocks.rewriteAcls).toHaveBeenCalledWith(
      'c-1',
      [],
      expect.objectContaining({
        lease: expect.objectContaining({ stillHeld: expect.any(Function) }),
      })
    )
    const flipIndex = dbChainMockFns.set.mock.calls.findIndex(
      ([values]) => (values as Record<string, unknown>).accessMode !== undefined
    )
    const flippedAt = dbChainMockFns.set.mock.invocationCallOrder[flipIndex]
    const rewrittenAt = mocks.rewriteAcls.mock.invocationCallOrder[0]
    expect(rewrittenAt).toBeLessThan(flippedAt)
    expect(setCallWith('accessMode')).toMatchObject({
      accessMode: 'admin',
      credentialId: 'cred-2',
      accessRewritePending: false,
      lastSyncAt: null,
      nextSyncAt: expect.any(Date),
    })
    expect(mocks.dispatchSync).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({ requireRunnable: true })
    )
    expect(mocks.dispatchMemberSync).not.toHaveBeenCalled()
  })

  it('rejects the complete save if a sync starts during validation', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [WORKSPACE_CONNECTOR])
    queueTableRows(schemaMock.knowledgeConnector, [{ ...WORKSPACE_CONNECTOR, status: 'syncing' }])
    const outcome = await performUpdateKnowledgeConnectorAccess({
      knowledgeBase: KB,
      connectorId: 'c-1',
      target: { accessMode: 'workspace', credentialId: 'cred-2' },
      sourceConfig: { folderId: ['f-2'] },
      resolveBillingAttribution,
      ...ACTOR,
    })
    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.dispatchSync).not.toHaveBeenCalled()
  })

  it('refuses a disabled credential replacement when Resume acquires the row first', async () => {
    const disabled = { ...WORKSPACE_CONNECTOR, accessMode: 'admin', status: 'disabled' }
    queueTableRows(schemaMock.knowledgeConnector, [disabled])
    queueTableRows(schemaMock.knowledgeConnector, [
      { ...disabled, status: 'syncing', syncLockToken: 'run-1' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const outcome = await switchTo({ accessMode: 'admin', credentialId: 'cred-2' })

    expect(outcome).toEqual({
      success: false,
      error: 'Sync already in progress',
      errorCode: 'conflict',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.dispatchSync).not.toHaveBeenCalled()
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
