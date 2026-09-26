import {
  dbChainMockFns,
  hasMockCondition,
  permissionsMock,
  permissionsMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { billingStorageMock, billingStorageMockFns } from '@sim/testing/mocks/billing-storage.mock'
import { inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeAccessProvider } from '@/lib/knowledge/access/types'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/billing/storage', () => billingStorageMock)

import {
  attachKnowledgeBaseConnectors,
  findActiveKnowledgeBasesByExactName,
  getWorkspaceKnowledgeBases,
  KnowledgeBasePermissionError,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'

const mockApplyStorageUsageDeltasInTx = billingStorageMockFns.mockApplyStorageUsageDeltasInTx
const mockMaybeNotifyStorageLimitForBillingContext =
  billingStorageMockFns.mockMaybeNotifyStorageLimitForBillingContext
const mockResolveStorageBillingContext = billingStorageMockFns.mockResolveStorageBillingContext

/**
 * A row cap on this read could only ever fire for a caller that did NOT ask for a page — the
 * one kind of caller with no cursor to act on it — so an oversized workspace has to be served,
 * not refused.
 */
describe('getWorkspaceKnowledgeBases — paging', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('reads one row past the page so it can report another page', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce(
        Array.from({ length: 3 }, (_, index) => ({
          id: `kb-${index}`,
          chunkingConfig: {},
          docCount: 0,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        }))
      )
      .mockResolvedValueOnce([])

    const result = await getWorkspaceKnowledgeBases('ws-1', 'active', { limit: 2 })

    expect(dbChainMockFns.limit).toHaveBeenCalledWith(3)
    expect(result.data).toHaveLength(2)
    expect(result.nextCursorKeys).not.toBeNull()
  })
})

/**
 * A VFS path names one knowledge base exactly. Resolving it by reading every base whose name
 * merely CONTAINS the term, then filtering in JS, makes a single-row lookup scale with the
 * workspace — the sibling `findActiveTablesByExactName` is the shape to match.
 */
describe('findActiveKnowledgeBasesByExactName', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('matches the name exactly and reads at most two rows', async () => {
    await findActiveKnowledgeBasesByExactName('ws-1', 'Docs')

    const [condition] = dbChainMockFns.where.mock.calls[0] ?? []
    expect(
      hasMockCondition(
        condition,
        (node) =>
          node.type === 'eq' && node.left === schemaMock.knowledgeBase.name && node.right === 'Docs'
      )
    ).toBe(true)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(2)
  })
})

/**
 * These tests guard the workspace mass-assignment fix:
 * a user with write/admin on the *source* workspace must not be able to move a
 * knowledge base into a workspace where they have no permission, and must not
 * be able to clear `workspaceId` (which would orphan the KB to its original
 * `userId`, who may not be the caller).
 */
describe('updateKnowledgeBase — chunking config persistence', () => {
  beforeEach(() => {
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'ws-current', userId: 'u-1' }])
  })

  /**
   * The strategy fields are the half a `{ maxSize, minSize, overlap }` shape
   * cannot describe, so they are what a narrower write type — or a destructure
   * of only those three — drops. Nothing downstream re-derives them.
   */
  it('persists every declared chunking field, strategy included', async () => {
    await updateKnowledgeBase(
      'kb-1',
      {
        chunkingConfig: {
          maxSize: 512,
          minSize: 50,
          overlap: 100,
          strategy: 'markdown',
          strategyOptions: { headingDepth: 3 },
        },
      },
      'req-1'
    )

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkingConfig: {
          maxSize: 512,
          minSize: 50,
          overlap: 100,
          strategy: 'markdown',
          strategyOptions: { headingDepth: 3 },
        },
      })
    )
  })
})

describe('updateKnowledgeBase — workspace transfer authorization', () => {
  beforeEach(() => {
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'ws-current', userId: 'u-1' }])
    mockResolveStorageBillingContext.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      billedAccountUserId: `${workspaceId}-owner`,
      billingEntity: { type: 'user', id: `${workspaceId}-owner` },
      plan: 'team_25000',
      customStorageLimitGB: null,
    }))
    mockApplyStorageUsageDeltasInTx.mockResolvedValue(100)
  })

  it('rejects workspaceId change without actorUserId', async () => {
    await expect(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1')
    ).rejects.toBeInstanceOf(KnowledgeBasePermissionError)
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it.each(['owner', 'other-user'])(
    'rejects detaching a KB for %s before any writes',
    async (actorUserId) => {
      await expect(
        /** @ts-expect-error Exercise runtime callers that bypass the HTTP contract. */
        updateKnowledgeBase('kb-1', { workspaceId: null }, 'req-1', { actorUserId })
      ).rejects.toMatchObject({ code: 'validation', message: 'Workspace ID is required' })
      expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      expect(mockApplyStorageUsageDeltasInTx).not.toHaveBeenCalled()
      expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
    }
  )

  it('rejects transfer when actor has no permission on target workspace', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'ws-current', userId: 'u-1' }])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce(null)

    await expect(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', {
        actorUserId: 'attacker',
      })
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'User does not have permission on the target workspace',
    })
    expect(permissionsMockFns.mockGetUserEntityPermissions).toHaveBeenCalledWith(
      'attacker',
      'workspace',
      'ws-target'
    )
  })

  it('rejects transfer when actor only has read permission on target workspace', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'ws-current', userId: 'u-1' }])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')

    await expect(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', {
        actorUserId: 'reader',
      })
    ).rejects.toBeInstanceOf(KnowledgeBasePermissionError)
  })
})

/**
 * These tests guard the file-authorization follow-through: KB file ownership is
 * resolved from the trusted `workspace_files` binding, so when a KB moves to a
 * new workspace the bindings for its stored files must move with it. Otherwise
 * the bindings stay frozen at the upload-time workspace and the KB's files
 * become unreadable after a move.
 */
describe('updateKnowledgeBase — file ownership binding re-point on workspace change', () => {
  beforeEach(() => {
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'ws-current', userId: 'u-1' }])
    mockResolveStorageBillingContext.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      billedAccountUserId: `${workspaceId}-owner`,
      billingEntity: { type: 'user', id: `${workspaceId}-owner` },
      plan: 'team_25000',
      customStorageLimitGB: null,
    }))
    mockApplyStorageUsageDeltasInTx.mockResolvedValue(100)
  })

  // The mocked `@sim/db` cannot satisfy the post-transaction read-back select, so
  // the call rejects after the transaction body commits. These tests assert the
  // in-transaction binding statements, then swallow that read-back rejection.
  const runIgnoringReadBack = (promise: Promise<unknown>) => promise.catch(() => undefined)

  it('re-points file ownership bindings to the new workspace on a move', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ workspaceId: 'ws-current', userId: 'u-1' }])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('admin')

    await runIgnoringReadBack(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', { actorUserId: 'u-1' })
    )

    // Two updates inside the txn: the KB row, then the file bindings.
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ workspaceId: 'ws-target' })
  })

  it('transfers the SQL-summed non-connector bytes with pre-resolved payer contexts', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'u-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'u-1' }])
      .mockResolvedValueOnce([{ bytes: 321 }])
      .mockResolvedValueOnce([])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('admin')

    await runIgnoringReadBack(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', {
        actorUserId: 'u-1',
      })
    )

    expect(mockResolveStorageBillingContext).toHaveBeenCalledWith('ws-current')
    expect(mockResolveStorageBillingContext).toHaveBeenCalledWith('ws-target')
    expect(mockApplyStorageUsageDeltasInTx).toHaveBeenCalledWith(expect.anything(), {
      workspaceDeltas: [
        {
          context: expect.objectContaining({ workspaceId: 'ws-current' }),
          deltaBytes: -321,
        },
        {
          context: expect.objectContaining({ workspaceId: 'ws-target' }),
          deltaBytes: 321,
        },
      ],
      legacyDeltas: [],
    })
  })

  it('rejects moving an organization Search KB into a workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workspaceId: null, organizationId: 'org-1', isSearchIndex: true, userId: 'creator' },
    ])

    await expect(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', { actorUserId: 'admin' })
    ).rejects.toThrow('Only workspace knowledge bases can move between workspaces')
    expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
    expect(mockApplyStorageUsageDeltasInTx).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})

describe('knowledge base counts with live source permissions', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  function reader() {
    const scope = { kind: 'user' as const, userId: 'reader', tokens: ['reader-token'] }
    const getForConnectors = vi.fn().mockResolvedValue({
      ...scope,
      confluenceSiteGrants: [
        {
          cloudId: 'cloud-1',
          connectorId: 'confluence-source',
          contentCredentialId: 'crawler',
          readerCredentialId: 'reader-credential',
          readerSubjectToken: 'reader-token',
          domain: 'team.atlassian.net',
        },
      ],
    })
    const access: KnowledgeAccessProvider = {
      get: async () => scope,
      getForConnectors,
      getForDocuments: async () => scope,
      liveSourceConnectorCondition: async () =>
        inArray(schemaMock.knowledgeConnector.knowledgeBaseId, ['kb-1']),
    }
    return { access, getForConnectors }
  }

  it('never discovers live sources for a reader without live-source credentials', async () => {
    const { access, getForConnectors } = reader()
    access.liveSourceConnectorCondition = async () => null
    queueTableRows(schemaMock.knowledgeBase, [
      {
        id: 'kb-1',
        workspaceId: 'ws-1',
        chunkingConfig: {},
        docCount: 2,
        tokenCount: 10,
        createdAt: new Date('2026-01-01'),
      },
    ])
    const result = await getWorkspaceKnowledgeBases('ws-1', 'archived', { access })
    expect(result.data[0]).toMatchObject({ docCount: 2, tokenCount: 10 })
    expect(getForConnectors).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalledWith({
      connectorId: schemaMock.knowledgeConnector.id,
    })
    expect(dbChainMockFns.groupBy).toHaveBeenCalledOnce()
  })

  it('does not retain stale totals when a live source no longer authorizes its documents', async () => {
    const { access, getForConnectors } = reader()
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.knowledgeConnector, [{ connectorId: 'confluence-source' }])
    queueTableRows(schemaMock.document, [])
    const base = { id: 'kb-1', docCount: 5, tokenCount: 50 } as KnowledgeBaseWithCounts
    await expect(attachKnowledgeBaseConnectors(base, access)).resolves.toMatchObject({
      docCount: 0,
      tokenCount: 0,
    })
    expect(getForConnectors).toHaveBeenCalledOnce()
  })
})
