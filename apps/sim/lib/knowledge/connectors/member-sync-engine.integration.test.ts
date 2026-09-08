/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExternalDocument } from '@/connectors/types'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  dispatch: vi.fn(),
  token: vi.fn(),
  rejectToken: vi.fn(),
  isCredentialInvalidError: vi.fn(),
  observe: vi.fn(),
  removeUnseen: vi.fn(),
  materialize: vi.fn(),
  lifecycle: vi.fn(),
  credentials: vi.fn(),
  getChangeCursor: vi.fn(),
  listChanges: vi.fn(),
  supportsChangeFeed: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionOwner: vi.fn(),
  assertBillingAttributionSnapshot: (value: unknown) => value,
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: vi.fn(async () => true),
}))
vi.mock('@/lib/credential-groups/credentials', () => ({
  CredentialGroupCredentialCursorNotFoundError: class extends Error {},
  isManagedCredentialGroupBindingLive: vi.fn(async () => true),
  loadScopedAccountsCredentialListContext: vi.fn(async () => ({
    status: 'active',
    options: [{ id: 'option', status: 'active' }],
  })),
}))
vi.mock('@/lib/knowledge/connectors/member-provisioning', () => ({
  inviteWorkspaceMembersToCredentialGroup: vi.fn(async () => ({ invited: 0 })),
}))
vi.mock('@/lib/knowledge/connectors/access-token', () => ({
  resolveConnectorTokenUserId: vi.fn(async () => 'credential-owner'),
  resolveConnectorAccessToken: mocks.token,
  syncContextForToken: (token: { cloudId?: string }) => ({ cloudId: token.cloudId }),
}))
vi.mock('@/lib/knowledge/connectors/member-access', () => ({
  KnowledgeConnectorMemberAccessDeniedError: class extends Error {},
  listKnowledgeConnectorMemberCredentials: mocks.credentials,
  mintKnowledgeConnectorMemberToken: vi.fn(async () => ({ accessToken: 'member-token' })),
  rejectKnowledgeConnectorMemberToken: mocks.rejectToken,
}))
vi.mock('@/lib/knowledge/connectors/member-observations', () => ({
  applyMemberDocumentLifecycle: mocks.lifecycle,
  materializeDocumentAcls: mocks.materialize,
  recordMemberObservations: mocks.observe,
  removeMemberObservationsForDocuments: vi.fn(async () => []),
  removeUnseenMemberObservations: mocks.removeUnseen,
  rewriteConnectorAcls: vi.fn(async () => true),
}))
vi.mock('@/lib/knowledge/connectors/sync-persistence', () => ({
  addDocument: mocks.add,
  updateDocument: mocks.update,
  persistSkippedDocuments: vi.fn(async () => []),
  persistSourceDocumentFailures: vi.fn(async () => undefined),
  persistSkippedRetryHashes: vi.fn(async () => []),
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  isTriggerAvailable: () => true,
  hardDeleteDocuments: vi.fn(),
  processDocumentsWithQueue: mocks.dispatch,
  ConnectorSyncDeletionGuardError: class extends Error {},
}))
vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    full_listing: {
      id: 'full_listing',
      name: 'Full listing source',
      auth: { mode: 'oauth', provider: 'google-drive' },
      permissionScopedListing: { capFieldIds: [] },
      supportsSeparateContentCredential: true,
      listDocuments: mocks.list,
      getDocument: mocks.get,
    },
    drive: {
      id: 'drive',
      name: 'Drive',
      auth: { mode: 'oauth', provider: 'google-drive' },
      permissionScopedListing: { capFieldIds: [] },
      supportsSeparateContentCredential: true,
      listDocuments: mocks.list,
      getDocument: mocks.get,
      getChangeCursor: mocks.getChangeCursor,
      listChanges: mocks.listChanges,
      supportsChangeFeed: mocks.supportsChangeFeed,
      isCredentialInvalidError: mocks.isCredentialInvalidError,
    },
  },
}))

import {
  CredentialGroupCredentialCursorNotFoundError,
  loadScopedAccountsCredentialListContext,
} from '@/lib/credential-groups/credentials'
import { listingFingerprint } from '@/lib/knowledge/connectors/listing-checkpoint'
import { executeMemberSync } from '@/lib/knowledge/connectors/member-sync-engine'

const serviceDocument: ExternalDocument = {
  externalId: 'file-shared',
  title: 'Shared file',
  content: '',
  contentHash: 'v1',
  contentDeferred: true,
  mimeType: 'text/plain',
}

const member = {
  id: 'member',
  credentialId: 'member-credential',
  connectorId: 'connector',
  status: 'active',
  subjectToken: 'subject:google-drive:person',
  consecutiveFailures: 0,
  lastCompleteListingAt: null,
  memberSyncedThrough: null,
  changeCursor: null,
}

/** Real engine, content stages, pagination, classification, and leases; external I/O is mocked. */
function arrange(
  options: {
    connectorType?: 'drive' | 'full_listing'
    members?: boolean
    memberContent?: boolean
    existingDocument?: boolean
    openMemberFeed?: boolean
    contentFresh?: boolean
    forceContentRefresh?: boolean
    noDueMembers?: boolean
    syncIntervalMinutes?: number
    unchangedContent?: boolean
    contentIncomplete?: boolean
    changedIdentity?: boolean
    directoryCheckpoint?: Record<string, unknown>
    organizationId?: string
  } = {}
) {
  const connector = {
    id: 'connector',
    knowledgeBaseId: 'kb',
    connectorType: options.connectorType ?? 'drive',
    credentialId: options.memberContent ? null : 'content-credential',
    encryptedApiKey: null,
    credentialGroupId: 'group',
    credentialGroupOptionId: 'option',
    accessMode: 'members',
    status: 'active',
    memberSyncStatus: 'idle',
    memberSyncConsecutiveFailures: 0,
    syncIntervalMinutes: options.syncIntervalMinutes ?? 1440,
    lastSyncAt: options.contentFresh ? new Date() : null,
    directoryCheckpoint: options.directoryCheckpoint ?? null,
    sourceConfig: { folderId: 'shared-folder', adminEmail: 'admin@example.com' },
    accessRewritePending: false,
    archivedAt: null,
    deletedAt: null,
    connectorArchivedAt: null,
    connectorDeletedAt: null,
    kbDeletedAt: null,
  }
  for (let i = 0; i < 40; i++) {
    queueTableRows(schemaMock.knowledgeConnector, [connector])
    queueTableRows(schemaMock.knowledgeBase, [
      {
        id: 'kb',
        workspaceId: options.organizationId ? null : 'workspace',
        organizationId: options.organizationId ?? null,
        userId: 'owner',
        deletedAt: null,
      },
    ])
  }
  const memberRow = options.openMemberFeed
    ? {
        ...member,
        lastCompleteListingAt: new Date(),
        memberSyncedThrough: new Date(),
        changeCursor: 'old-cursor',
      }
    : member
  const claims = options.members && !options.noDueMembers ? [[memberRow], []] : [[]]
  dbChainMockFns.returning.mockImplementation(async () => {
    const values = dbChainMockFns.set.mock.calls.at(-1)?.[0]
    if (values && 'lastStartedAt' in values) return claims.shift() ?? []
    return [connector]
  })
  if (!options.contentFresh || options.forceContentRefresh) {
    queueTableRows(
      schemaMock.document,
      options.unchangedContent
        ? [
            {
              id: 'stored-file',
              externalId: 'file-shared',
              contentHash: 'v1',
              storageKey: 'stored',
              userExcluded: false,
            },
          ]
        : []
    )
    if (!options.contentIncomplete) {
      queueTableRows(schemaMock.document, [
        {
          ownedCount: options.existingDocument ? 2 : 1,
          listedCount: 1,
          softCount: 0,
          hardCount: 0,
        },
      ])
      queueTableRows(schemaMock.document, [])
      queueTableRows(schemaMock.document, [])
    }
    queueTableRows(schemaMock.document, [{ count: 1 }])
  }
  if (options.members && !options.noDueMembers)
    queueTableRows(schemaMock.document, [
      { id: 'stored-file', externalId: 'file-shared', contentHash: 'v1', userExcluded: false },
    ])
  queueTableRows(schemaMock.document, [])
  queueTableRows(
    schemaMock.knowledgeConnectorMember,
    options.changedIdentity
      ? [
          {
            ...member,
            memberSyncedThrough: new Date(),
            lastCompleteListingAt: new Date(),
            changeCursor: 'old-account-cursor',
          },
        ]
      : []
  )
  if (options.changedIdentity) queueTableRows(schemaMock.knowledgeConnectorMember, [])
  queueTableRows(schemaMock.knowledgeConnectorMember, [])
  queueTableRows(schemaMock.knowledgeConnectorMember, [{ count: 0 }])
  queueTableRows(schemaMock.credential, [{ count: 0 }])
  mocks.credentials.mockResolvedValue({
    credentials: options.changedIdentity
      ? [
          {
            credentialId: member.credentialId,
            providerId: 'google-drive',
            providerTenantId: null,
            providerSubjectId: 'different-person',
            managedOauthStatus: 'active',
            enrollmentStatus: 'completed',
          },
        ]
      : [],
    nextCursor: null,
  })
  mocks.token.mockResolvedValue({ accessToken: 'service-token', cloudId: 'site' })
  mocks.get.mockResolvedValue({
    ...serviceDocument,
    content: 'Service content',
    contentDeferred: false,
  })
  mocks.list.mockImplementation(async (token: string) => ({
    documents:
      token === 'service-token'
        ? [serviceDocument]
        : [
            serviceDocument,
            { ...serviceDocument, externalId: 'member-only', content: 'Private body' },
          ],
    hasMore: false,
  }))
  mocks.add.mockResolvedValue({ documentId: 'stored-file' })
  mocks.dispatch.mockResolvedValue({ accepted: 1, failed: 0 })
  mocks.observe.mockResolvedValue(1)
  mocks.removeUnseen.mockResolvedValue({ removed: 0, finished: true })
  mocks.getChangeCursor.mockResolvedValue('new-cursor')
  mocks.listChanges.mockResolvedValue({ changes: [], hasMore: false, nextCursor: 'drained' })
  mocks.supportsChangeFeed.mockReturnValue(true)
  mocks.isCredentialInvalidError.mockReturnValue(false)
  mocks.rejectToken.mockResolvedValue(true)
  return () =>
    executeMemberSync('connector', {
      forceContentRefresh: options.forceContentRefresh,
      billingAttribution: {
        actorUserId: 'owner',
        ...(options.organizationId
          ? { organizationId: options.organizationId }
          : { workspaceId: 'workspace' }),
      } as Parameters<typeof executeMemberSync>[1]['billingAttribution'],
    })
}

describe('member engine with a dedicated content credential', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it.each([undefined, 'organization'])(
    'loads the account container within the canonical owner %s',
    async (organizationId) => {
      const result = await arrange({ organizationId, contentFresh: true, noDueMembers: true })()
      expect(result.error).toBeUndefined()
      expect(loadScopedAccountsCredentialListContext).toHaveBeenCalledWith(
        organizationId
          ? { kind: 'organization', organizationId }
          : { kind: 'workspace', workspaceId: 'workspace' },
        'group'
      )
    }
  )

  it('invalidates authorization freshness and cursors before reusing a changed provider identity', async () => {
    const run = arrange({ changedIdentity: true, contentFresh: true, noDueMembers: true })
    const result = await run()
    expect(result.error).toBeUndefined()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectToken: 's:google-drive:-:different-person',
        memberSyncedThrough: null,
        lastCompleteListingAt: null,
        listingCheckpoint: { kind: 'membership', cursor: null, removeMember: false },
        changeCursor: null,
        nextAttemptAt: expect.any(Date),
      })
    )
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('restarts a deleted directory cursor without treating its unfinished page as EOF', async () => {
    const fingerprint = listingFingerprint({
      workspaceId: 'workspace',
      credentialGroupId: 'group',
      credentialGroupOptionId: 'option',
      option: { id: 'option', status: 'active' },
      status: 'active',
    })
    const run = arrange({
      contentFresh: true,
      directoryCheckpoint: {
        version: 1,
        fingerprint,
        phase: 'listing',
        cursor: 'deleted-credential',
      },
    })
    mocks.credentials.mockRejectedValueOnce(new CredentialGroupCredentialCursorNotFoundError())
    expect((await run()).error).toBeUndefined()
    expect(mocks.credentials.mock.calls.map(([value]) => value.cursor)).toEqual([
      'deleted-credential',
      undefined,
    ])
  })

  it('holds a directory cursor across a worker budget without running absence cleanup', async () => {
    const run = arrange({ contentFresh: true })
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now')
    mocks.credentials.mockImplementationOnce(async () => {
      clock.mockReturnValue(now + 46 * 60_000)
      return { credentials: [], nextCursor: 'next-directory-page' }
    })
    try {
      const result = await run()
      expect(result.error).toBeUndefined()
      expect(result.membersRemaining).toBe(true)
      expect(mocks.credentials).toHaveBeenCalledOnce()
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({
          directoryCheckpoint: expect.objectContaining({
            phase: 'listing',
            cursor: 'next-directory-page',
          }),
        })
      )
      expect(
        dbChainMockFns.set.mock.calls.some(([value]) => value.directoryCheckpoint === null)
      ).toBe(false)
      expect(mocks.removeUnseen).not.toHaveBeenCalled()
    } finally {
      clock.mockRestore()
    }
  })

  it('indexes with no enrolled members and keeps the next content crawl scheduled', async () => {
    const run = arrange()
    const result = await run()
    expect(result.error).toBeUndefined()
    expect(result.docsAdded).toBe(1)
    expect(result.membersClaimed).toBe(0)
    expect(mocks.get).toHaveBeenCalledWith(
      'service-token',
      expect.objectContaining({ folderId: 'shared-folder', adminEmail: 'admin@example.com' }),
      'file-shared',
      expect.objectContaining({ cloudId: 'site' })
    )
    expect(mocks.add.mock.calls[0][6]).toBe('members')
    expect(mocks.lifecycle).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ memberSyncStatus: 'idle', nextMemberSyncAt: expect.any(Date) })
    )
  })

  it('uses member listings only for visibility and ignores identities outside the content corpus', async () => {
    const run = arrange({ members: true })
    const result = await run()
    expect(result.error).toBeUndefined()
    expect(result.membersCompleted).toBe(1)
    expect(mocks.get).toHaveBeenCalledTimes(1)
    expect(mocks.get.mock.calls[0][0]).toBe('service-token')
    expect(mocks.add).toHaveBeenCalledTimes(1)
    expect(mocks.add.mock.calls[0][3].content).toBe('Service content')
    expect(mocks.observe).toHaveBeenCalledWith(
      expect.anything(),
      'member',
      ['stored-file'],
      expect.any(String)
    )
    expect(mocks.list.mock.calls[1][3]).toMatchObject({ perMemberListing: true })
    expect(mocks.lifecycle).not.toHaveBeenCalled()
  })

  it('refreshes dedicated content even when enrolled members are not due', async () => {
    const run = arrange({ members: true, noDueMembers: true })
    const result = await run()
    expect(result.error).toBeUndefined()
    expect(result.docsAdded).toBe(1)
    expect(result.membersClaimed).toBe(0)
    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(mocks.list.mock.calls[0][0]).toBe('service-token')
    expect(mocks.observe).not.toHaveBeenCalled()
  })

  it('reserves time for member permissions when a slow dedicated content page has more batches', async () => {
    const run = arrange({ members: true, contentIncomplete: true })
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now')
    const memberListing = mocks.list.getMockImplementation()!
    mocks.list.mockImplementation(async (token: string) =>
      token === 'service-token'
        ? {
            documents: Array.from({ length: 26 }, (_, i) => ({
              ...serviceDocument,
              externalId: `content-${i}`,
            })),
            hasMore: false,
          }
        : memberListing(token)
    )
    mocks.get.mockImplementation(async (_token, _config, externalId: string) => {
      clock.mockReturnValue(now + 35 * 60_000)
      return { ...serviceDocument, externalId, content: 'Service content', contentDeferred: false }
    })
    try {
      const result = await run()
      expect(result.error).toBeUndefined()
      expect(result.docsAdded).toBeGreaterThan(0)
      expect(result.docsAdded).toBeLessThan(26)
      expect(result.membersCompleted).toBe(1)
      expect(result.membersRemaining).toBe(true)
      expect(mocks.observe).toHaveBeenCalledWith(
        expect.anything(),
        'member',
        ['stored-file'],
        expect.any(String)
      )
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({
          listingCheckpoint: expect.objectContaining({
            cursor: null,
            complete: false,
            listedCount: 0,
          }),
        })
      )
    } finally {
      clock.mockRestore()
    }
  })

  it('keeps a manual connector unscheduled after its requested content pass', async () => {
    const run = arrange({ syncIntervalMinutes: 0 })
    const result = await run()
    expect(result.error).toBeUndefined()
    expect(result.docsAdded).toBe(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ memberSyncStatus: 'idle', nextMemberSyncAt: null })
    )
  })

  it('does not crawl members or grant observations when the content credential fails', async () => {
    const run = arrange({ members: true })
    mocks.token.mockRejectedValueOnce(new Error('Service token revoked'))
    const result = await run()
    expect(result.error).toBe('Service token revoked')
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.observe).not.toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('refreshes member visibility hourly while the dedicated content interval has not elapsed', async () => {
    const run = arrange({ members: true, contentFresh: true })
    const startedAt = Date.now()
    const result = await run()
    expect(result.error).toBeUndefined()
    expect(result.membersCompleted).toBe(1)
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(mocks.list.mock.calls[0][0]).toBe('member-token')
    const completion = dbChainMockFns.set.mock.calls.find(
      ([value]) => value.memberSyncStatus === 'idle'
    )?.[0]
    expect(completion.nextMemberSyncAt.getTime() - startedAt).toBeLessThan(66 * 60_000)
  })

  it('refreshes permissions without rehydrating or reindexing unchanged source content', async () => {
    const run = arrange({ members: true, unchangedContent: true })
    const result = await run()
    expect(result.error).toBeUndefined()
    expect(result.docsUnchanged).toBe(1)
    expect(result.membersCompleted).toBe(1)
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.observe).toHaveBeenCalledWith(
      expect.anything(),
      'member',
      ['stored-file'],
      expect.any(String)
    )
  })

  it('reconciles omissions on every complete listing when the source has no incremental API', async () => {
    const run = arrange({
      connectorType: 'full_listing',
      members: true,
      contentFresh: true,
      openMemberFeed: true,
    })
    const result = await run()
    expect(result.error).toBeUndefined()
    expect(result.membersCompleted).toBe(1)
    expect(mocks.list.mock.calls[0][4]).toBeUndefined()
    expect(mocks.removeUnseen).toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.listChanges).not.toHaveBeenCalled()
  })

  it('does not advance the content watermark when hydration fails', async () => {
    const run = arrange()
    mocks.get.mockRejectedValueOnce(new Error('Download interrupted'))
    const result = await run()
    expect(result.docsFailed).toBe(1)
    expect(mocks.add).not.toHaveBeenCalled()
    expect(dbChainMockFns.set.mock.calls.some(([value]) => value.lastSyncAt instanceof Date)).toBe(
      false
    )
  })

  it('an explicit sync request refreshes content before its configured interval elapses', async () => {
    const run = arrange({ contentFresh: true, forceContentRefresh: true })
    const result = await run()
    expect(result.error).toBeUndefined()
    expect(result.docsAdded).toBe(1)
    expect(mocks.get.mock.calls[0][0]).toBe('service-token')
  })

  it('keeps an interrupted forced crawl due instead of retaining its previous fresh watermark', async () => {
    const run = arrange({ contentFresh: true, forceContentRefresh: true })
    mocks.list
      .mockResolvedValueOnce({
        documents: [serviceDocument],
        hasMore: true,
        nextCursor: 'page-two',
      })
      .mockRejectedValueOnce(new Error('Source interrupted'))
    const result = await run()
    expect(result.error).toBe('Source interrupted')
    expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ lastSyncAt: null }))
    expect(dbChainMockFns.set.mock.calls.some(([value]) => value.lastSyncAt instanceof Date)).toBe(
      false
    )
  })

  it('relists visibility for newly indexed content even when the member already has a drained change feed', async () => {
    const run = arrange({ members: true, openMemberFeed: true })
    const result = await run()
    expect(result.error).toBeUndefined()
    expect(result.docsAdded).toBe(1)
    expect(mocks.listChanges).not.toHaveBeenCalled()
    expect(mocks.getChangeCursor).toHaveBeenCalled()
    expect(mocks.observe).toHaveBeenCalledWith(
      expect.anything(),
      'member',
      ['stored-file'],
      expect.any(String)
    )
  })

  it('removes the final observer without handing content deletion to the member lifecycle', async () => {
    const run = arrange({ members: true })
    mocks.list.mockImplementation(async (token: string) => ({
      documents: token === 'service-token' ? [serviceDocument] : [],
      hasMore: false,
    }))
    mocks.removeUnseen.mockImplementation(async (_tx, _member, _runId, onRemoved) => {
      await onRemoved(['stored-file'])
      return { removed: 1, finished: true }
    })
    const result = await run()
    expect(result.error).toBeUndefined()
    expect(result.observationsRemoved).toBe(1)
    expect(mocks.materialize).toHaveBeenCalledWith('connector', ['stored-file'], expect.anything())
    expect(mocks.lifecycle).not.toHaveBeenCalled()
    expect(result.docsDeleted).toBe(0)
  })

  it('fully lists scopes whose ancestor moves cannot be represented by the change feed', async () => {
    const run = arrange({ members: true, openMemberFeed: true, contentFresh: true })
    mocks.supportsChangeFeed.mockReturnValue(false)
    expect((await run()).error).toBeUndefined()
    expect(mocks.supportsChangeFeed).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'shared-folder' })
    )
    expect(mocks.listChanges).not.toHaveBeenCalled()
    expect(mocks.getChangeCursor).not.toHaveBeenCalled()
    expect(mocks.list).toHaveBeenCalledWith(
      'member-token',
      expect.anything(),
      undefined,
      expect.anything(),
      undefined
    )
    expect(mocks.removeUnseen).toHaveBeenCalled()
  })

  it('suspends observations immediately when the provider rejects the current member token', async () => {
    const run = arrange({ members: true, openMemberFeed: true, contentFresh: true })
    mocks.listChanges.mockRejectedValue(new Error('provider token revoked'))
    mocks.isCredentialInvalidError.mockReturnValue(true)
    expect((await run()).membersFailed).toBe(1)
    expect(mocks.rejectToken).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: 'member-credential',
        rejectedAccessToken: 'member-token',
      })
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'suspended',
        memberSyncedThrough: null,
        lastCompleteListingAt: null,
        listingCheckpoint: { kind: 'membership', cursor: null, removeMember: false },
      })
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ directoryCheckpoint: null })
    expect(mocks.observe).not.toHaveBeenCalled()
  })

  it('withdraws access when a token is revoked after listing but before content hydration', async () => {
    const run = arrange({ members: true, memberContent: true, contentFresh: true })
    mocks.isCredentialInvalidError.mockImplementation(
      (error: Error) => error.message === 'revoked during hydration'
    )
    mocks.list.mockResolvedValue({
      documents: [{ ...serviceDocument, contentHash: 'v2' }],
      hasMore: false,
    })
    mocks.get.mockRejectedValue(new Error('revoked during hydration'))
    mocks.lifecycle.mockResolvedValue({ tombstoned: 0, resurrected: 0, purged: 0, finished: true })
    const result = await run()
    expect(result.error).toBeUndefined()
    expect(result.membersFailed).toBe(1)
    expect(result.membersCompleted).toBe(0)
    expect(mocks.rejectToken).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'suspended' })
    )
    expect(mocks.observe).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'preserves observations when terminal=%s but the credential was reconnected',
    async (terminal) => {
      const run = arrange({ members: true, openMemberFeed: true, contentFresh: true })
      mocks.listChanges.mockRejectedValue(new Error('provider request failed'))
      mocks.isCredentialInvalidError.mockReturnValue(terminal)
      mocks.rejectToken.mockResolvedValue(false)
      expect((await run()).membersFailed).toBe(1)
      expect(dbChainMockFns.set.mock.calls.some(([value]) => value.status === 'suspended')).toBe(
        false
      )
      expect(mocks.rejectToken).toHaveBeenCalledTimes(terminal ? 1 : 0)
    }
  )

  it('retains the EOF checkpoint and old permission watermark when revocation exhausts its budget', async () => {
    const run = arrange({ members: true, contentFresh: true })
    const clock = vi.spyOn(Date, 'now')
    const now = Date.now()
    mocks.removeUnseen.mockImplementation(async () => {
      clock.mockReturnValue(now + 46 * 60_000)
      return { removed: 500, finished: false }
    })
    try {
      const result = await run()
      expect(result.error).toBeUndefined()
      expect(result.membersIncomplete).toBe(1)
      expect(result.membersCompleted).toBe(0)
      expect(result.observationsRemoved).toBe(500)
      const completedMember = dbChainMockFns.set.mock.calls.find(
        ([value]) =>
          'lastError' in value && 'consecutiveFailures' in value && 'nextAttemptAt' in value
      )?.[0]
      expect(completedMember).toBeDefined()
      expect(completedMember).not.toHaveProperty('listingCheckpoint')
      expect(completedMember).not.toHaveProperty('memberSyncedThrough')
    } finally {
      clock.mockRestore()
    }
  })

  it('withholds deletion and corroboration when service pagination has no continuation cursor', async () => {
    const run = arrange({ existingDocument: true })
    mocks.list.mockResolvedValue({ documents: [serviceDocument], hasMore: true })
    const result = await run()
    expect(result.error).toContain('pagination did not advance')
    expect(result.docsDeleted).toBe(0)
    expect(mocks.add).not.toHaveBeenCalled()
    expect(dbChainMockFns.set.mock.calls.some(([value]) => value.deletedAt instanceof Date)).toBe(
      false
    )
    expect(dbChainMockFns.set.mock.calls.some(([value]) => value.lastSyncAt instanceof Date)).toBe(
      false
    )
  })
})
