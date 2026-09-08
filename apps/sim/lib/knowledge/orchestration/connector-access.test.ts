/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  hasMockCondition,
  type MockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
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
    vi.clearAllMocks()
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

  it('resolves and validates the workspace account option for the acting admin', async () => {
    mocks.provision.mockResolvedValue({
      credentialGroupId: 'group-9',
      credentialGroupOptionId: 'option-9',
    })
    mocks.loadGroup.mockResolvedValue({
      credentialGroupId: 'group-9',
      workspaceId: 'ws-1',
      status: 'active',
      options: [],
    })
    mocks.validateBinding.mockReturnValue({ ok: true, option: {} })
    await expect(
      resolveKnowledgeConnectorMembersBinding({
        workspaceId: 'ws-1',
        connectorMeta: SCOPED_META,
        actingUserId: 'admin-1',
        sourceConfig: {},
      })
    ).resolves.toEqual({
      credentialGroupId: 'group-9',
      credentialGroupOptionId: 'option-9',
      sourceConfig: {},
    })
    expect(mocks.provision).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      connectorMeta: SCOPED_META,
      userId: 'admin-1',
    })
    expect(mocks.loadGroup).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: 'ws-1' })
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

  it('surfaces the validator refusal as a validation error', async () => {
    mocks.loadGroup.mockResolvedValue({
      credentialGroupId: 'group-1',
      workspaceId: 'ws-1',
      status: 'active',
      options: [],
    })
    mocks.validateBinding.mockReturnValue({ ok: false, message: 'Max Files cannot be set' })
    await expect(
      resolveKnowledgeConnectorMembersBinding({
        workspaceId: 'ws-1',
        connectorMeta: SCOPED_META,
        actingUserId: 'admin-1',
        sourceConfig: { maxFiles: '5' },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'Max Files cannot be set' })
  })
})

describe('performUpdateKnowledgeConnectorAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.rewriteAcls.mockResolvedValue(true)
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
    queueGroupRow('option-1')
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ ...WORKSPACE_CONNECTOR, status: 'syncing', syncLockToken: 's-1' }])
      /** The flip lands under the lease, then the release. */
      .mockResolvedValueOnce([{ id: 'c-1' }])
      .mockResolvedValueOnce([{ ...MEMBERS_CONNECTOR, nextMemberSyncAt: new Date() }])

    const outcome = await switchTo({ accessMode: 'members', binding: BINDING })

    expect(outcome).toMatchObject({ success: true, changed: true })
    /** The rewrite hides every document and proves the switch lease inside each batch. */
    expect(mocks.rewriteAcls).toHaveBeenCalledWith(
      'c-1',
      [],
      expect.objectContaining({
        lease: expect.objectContaining({ stillHeld: expect.any(Function) }),
      })
    )
    expect(mocks.grant).toHaveBeenCalledWith(
      {
        workspaceId: 'ws-1',
        credentialGroupId: 'group-1',
        credentialGroupOptionId: 'option-1',
        connectorId: 'c-1',
      },
      'admin-1'
    )
    /** The flip is written inside the group's row lock. */
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    const flip = setCallWith('accessMode')
    expect(flip).toMatchObject({
      accessMode: 'members',
      credentialId: null,
      credentialGroupId: 'group-1',
      credentialGroupOptionId: 'option-1',
      accessRewritePending: false,
      nextSyncAt: null,
      nextMemberSyncAt: expect.any(Date),
    })
    expect(flip).not.toHaveProperty('status')
    expect(dbChainMockFns.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'active', syncLockToken: null, syncLockLeaseAt: null })
    )
    /** The dispatch asserts the schedule the flip wrote, so the queue accepts it. */
    expect(mocks.dispatchMemberSync).toHaveBeenCalledWith('c-1', {
      billingAttribution: BILLING,
      expectedNextMemberSyncAt: flip.nextMemberSyncAt,
      requestId: 'req-1',
      requireRunnable: true,
    })
    expect(mocks.dispatchSync).not.toHaveBeenCalled()
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

  it('drops the members, restores workspace access, revokes the grant, flips, and queues a content sync', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [MEMBERS_CONNECTOR])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ ...MEMBERS_CONNECTOR, status: 'syncing', syncLockToken: 's-1' }])
      /** The flip lands under the lease, then the release. */
      .mockResolvedValueOnce([{ id: 'c-1' }])
      .mockResolvedValueOnce([{ ...WORKSPACE_CONNECTOR, credentialId: 'cred-2' }])

    const outcome = await switchTo({ accessMode: 'workspace', credentialId: 'cred-2' })

    expect(outcome).toMatchObject({ success: true, changed: true })
    expect(dbChainMockFns.delete).toHaveBeenCalled()
    /** Workspace access is restored under the switch lease, proved inside each batch. */
    expect(mocks.rewriteAcls).toHaveBeenCalledWith(
      'c-1',
      ['ws'],
      expect.objectContaining({
        lease: expect.objectContaining({ stillHeld: expect.any(Function) }),
      })
    )
    expect(mocks.revoke).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', credentialGroupId: 'group-1', connectorId: 'c-1' },
      'admin-1'
    )
    const flip = setCallWith('accessMode')
    expect(flip).toMatchObject({
      accessMode: 'workspace',
      credentialId: 'cred-2',
      credentialGroupId: null,
      credentialGroupOptionId: null,
      nextMemberSyncAt: null,
      nextSyncAt: expect.any(Date),
    })
    /** The revoke lands while the lease is still held; the release is the last write. */
    const revokedAt = mocks.revoke.mock.invocationCallOrder[0]
    const releasedAt = dbChainMockFns.set.mock.invocationCallOrder.at(-1) ?? 0
    expect(revokedAt).toBeLessThan(releasedAt)
    expect(dbChainMockFns.set).toHaveBeenLastCalledWith(
      expect.objectContaining({
        accessRewritePending: false,
        status: 'active',
        syncLockToken: null,
        syncLockLeaseAt: null,
      })
    )
    /**
     * The row holds the instant the flip wrote as `nextSyncAt`; a dispatch
     * asserting any later clock read is refused by the queue as stale.
     */
    expect(mocks.dispatchSync).toHaveBeenCalledWith('c-1', {
      billingAttribution: BILLING,
      expectedNextSyncAt: flip.nextSyncAt,
      requestId: 'req-1',
      requireRunnable: true,
    })
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

  it('flips to administrator mode with the rewrite pending when it outgrows the request budget', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [WORKSPACE_CONNECTOR])
    mocks.rewriteAcls.mockResolvedValue(false)
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ ...WORKSPACE_CONNECTOR, status: 'syncing', syncLockToken: 's-1' }])
      .mockResolvedValueOnce([{ id: 'c-1' }])
      .mockResolvedValueOnce([
        { ...WORKSPACE_CONNECTOR, accessMode: 'admin', credentialId: 'cred-2' },
      ])

    await switchTo({ accessMode: 'admin', credentialId: 'cred-2' })

    expect(setCallWith('accessMode')).toMatchObject({
      accessMode: 'admin',
      accessRewritePending: true,
    })
  })

  it('changes a workspace credential without the lease, drops the watermark, and queues a full sync', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      { ...WORKSPACE_CONNECTOR, lastSyncAt: new Date('2026-08-01T00:00:00Z') },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { ...WORKSPACE_CONNECTOR, credentialId: 'cred-2', lastSyncAt: null },
    ])

    const outcome = await switchTo({ accessMode: 'workspace', credentialId: 'cred-2' })

    expect(outcome).toMatchObject({ success: true, changed: true })
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
    const change = setCallWith('credentialId')
    expect(change).toMatchObject({
      credentialId: 'cred-2',
      lastSyncAt: null,
      nextSyncAt: expect.any(Date),
    })
    expect(change).not.toHaveProperty('status')
    /**
     * A running sync's terminal write would restore the watermark, so the
     * write is refused while any sync holds the row.
     */
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls.at(-1)?.[0],
        (node: MockCondition) =>
          node.type === 'isNull' && node.column === schemaMock.knowledgeConnector.syncLockToken
      )
    ).toBe(true)
    expect(mocks.dispatchSync).toHaveBeenCalledWith('c-1', {
      billingAttribution: BILLING,
      expectedNextSyncAt: change.nextSyncAt,
      requestId: 'req-1',
      requireRunnable: true,
    })
    expect(mocks.grant).not.toHaveBeenCalled()
    expect(mocks.revoke).not.toHaveBeenCalled()
  })

  it('refuses a credential change while a sync owns the connector', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [WORKSPACE_CONNECTOR])
    queueTableRows(schemaMock.knowledgeConnector, [
      { ...WORKSPACE_CONNECTOR, status: 'syncing', syncLockToken: 'run-1' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const outcome = await switchTo({ accessMode: 'workspace', credentialId: 'cred-2' })

    expect(outcome).toEqual({
      success: false,
      error: 'Sync already in progress',
      errorCode: 'conflict',
    })
    expect(mocks.dispatchSync).not.toHaveBeenCalled()
  })

  it('changes the credential of a paused connector without queuing a sync', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [{ ...WORKSPACE_CONNECTOR, status: 'paused' }])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { ...WORKSPACE_CONNECTOR, status: 'paused', credentialId: 'cred-2' },
    ])

    const outcome = await switchTo({ accessMode: 'workspace', credentialId: 'cred-2' })

    expect(outcome).toMatchObject({ success: true, changed: true })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: 'cred-2', lastSyncAt: null })
    )
    expect(mocks.dispatchSync).not.toHaveBeenCalled()
  })

  it('leaves a paused connector paused and queues nothing', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [{ ...WORKSPACE_CONNECTOR, status: 'paused' }])
    queueGroupRow('option-1')
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ ...WORKSPACE_CONNECTOR, status: 'paused' }])
      .mockResolvedValueOnce([{ id: 'c-1' }])
      .mockResolvedValueOnce([{ ...MEMBERS_CONNECTOR, status: 'paused' }])

    const outcome = await switchTo({ accessMode: 'members', binding: BINDING })

    expect(outcome).toMatchObject({ success: true, changed: true })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ accessMode: 'members' })
    )
    expect(dbChainMockFns.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'paused', syncLockToken: null })
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
