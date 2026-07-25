/**
 * @vitest-environment node
 */
import { document, knowledgeBase, workspaceFiles } from '@sim/db/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckStorageQuotaForBillingContext,
  mockResolveStorageBillingContext,
  mockGetOrganizationSubscription,
  mockGetHighestPriorityPersonalSubscription,
} = vi.hoisted(() => ({
  mockCheckStorageQuotaForBillingContext: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
  mockGetOrganizationSubscription: vi.fn(),
  mockGetHighestPriorityPersonalSubscription: vi.fn(),
}))

vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuotaForBillingContext: mockCheckStorageQuotaForBillingContext,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))
vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))
vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPriorityPersonalSubscription: mockGetHighestPriorityPersonalSubscription,
}))

/**
 * Minimal stand-in for the domain error so this unit test never loads the authz module's
 * billing/feature-flag import chain. Shape-compatible with the real `ForkError`.
 */
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => ({
  ForkError: class ForkError extends Error {
    statusCode: number
    constructor(message: string, statusCode = 400) {
      super(message)
      this.name = 'ForkError'
      this.statusCode = statusCode
    }
  },
}))

import type { DbOrTx } from '@/lib/db/types'
import {
  assertForkStorageHeadroom,
  sumForkCopyBytes,
} from '@/ee/workspace-forking/lib/copy/storage-quota'
import { ForkError } from '@/ee/workspace-forking/lib/lineage/authz'

function makeExecutor(total: number | string) {
  const execute = vi.fn((_query: unknown) => Promise.resolve([{ total }]))
  return { executor: { execute } as unknown as DbOrTx, execute }
}

describe('sumForkCopyBytes', () => {
  it('returns the exact workspace-file plus KB-document total from one scalar query', async () => {
    const { executor, execute } = makeExecutor(1000)

    const bytes = await sumForkCopyBytes(executor, 'src-ws', {
      fileIds: ['wf-1'],
      knowledgeBaseIds: ['kb-1'],
    })

    expect(bytes).toBe(1000)
    expect(execute).toHaveBeenCalledTimes(1)
    const outerQuery = execute.mock.calls[0][0] as {
      toSQL: () => { sql: string; params: Array<{ toSQL: () => { params: unknown[] } }> }
    }
    const compiled = outerQuery.toSQL()
    expect(compiled.sql).toBe('SELECT (? + ?)::bigint AS total')
    const [fileBytes, kbBytes] = compiled.params
    expect(fileBytes.toSQL().params[2]).toEqual({
      type: 'and',
      conditions: [
        { type: 'inArray', column: workspaceFiles.id, values: ['wf-1'] },
        { type: 'eq', left: workspaceFiles.workspaceId, right: 'src-ws' },
        { type: 'eq', left: workspaceFiles.context, right: 'workspace' },
        { type: 'isNull', column: workspaceFiles.deletedAt },
      ],
    })
    expect(kbBytes.toSQL().params[4]).toEqual({
      type: 'and',
      conditions: [
        { type: 'inArray', column: knowledgeBase.id, values: ['kb-1'] },
        { type: 'eq', left: knowledgeBase.workspaceId, right: 'src-ws' },
        { type: 'isNull', column: knowledgeBase.deletedAt },
        { type: 'isNull', column: document.deletedAt },
        { type: 'isNull', column: document.archivedAt },
        { type: 'isNotNull', column: document.storageKey },
      ],
    })
  })

  it('coerces driver string aggregates (bigint sums) to numbers', async () => {
    const { executor } = makeExecutor('1024')

    const bytes = await sumForkCopyBytes(executor, 'src-ws', { fileKeys: ['workspace/src/k1'] })

    expect(bytes).toBe(1024)
  })

  it('runs no query for an empty selection', async () => {
    const { executor, execute } = makeExecutor(0)

    const bytes = await sumForkCopyBytes(executor, 'src-ws', {
      fileIds: [],
      fileKeys: [],
      knowledgeBaseIds: [],
    })

    expect(bytes).toBe(0)
    expect(execute).not.toHaveBeenCalled()
  })

  it('uses the same single scalar query when only KBs are selected', async () => {
    const { executor, execute } = makeExecutor(555)

    const bytes = await sumForkCopyBytes(executor, 'src-ws', { knowledgeBaseIds: ['kb-1'] })

    expect(bytes).toBe(555)
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

describe('assertForkStorageHeadroom', () => {
  const targetContext = {
    workspaceId: 'target-ws',
    billedAccountUserId: 'target-payer',
    billingEntity: { type: 'user', id: 'target-payer' },
    plan: 'pro',
    customStorageLimitGB: null,
  } as const

  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveStorageBillingContext.mockResolvedValue(targetContext)
  })

  it('never consults the quota helper for zero bytes', async () => {
    await assertForkStorageHeadroom({ targetWorkspaceId: 'target-ws', bytes: 0 })
    expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
    expect(mockCheckStorageQuotaForBillingContext).not.toHaveBeenCalled()
  })

  it('checks sync headroom against the actual target workspace payer, never the actor', async () => {
    mockCheckStorageQuotaForBillingContext.mockResolvedValue({
      allowed: true,
      currentUsage: 10,
      limit: 100,
    })

    await expect(
      assertForkStorageHeadroom({ targetWorkspaceId: 'target-ws', bytes: 50 })
    ).resolves.toBeUndefined()
    expect(mockResolveStorageBillingContext).toHaveBeenCalledWith('target-ws')
    expect(mockCheckStorageQuotaForBillingContext).toHaveBeenCalledWith(targetContext, 50)
  })

  it("throws a 413 ForkError carrying the upload path's quota message when over quota", async () => {
    mockCheckStorageQuotaForBillingContext.mockResolvedValue({
      allowed: false,
      currentUsage: 99,
      limit: 100,
      error: 'Storage limit exceeded. Used: 10.50GB, Limit: 10GB',
    })

    const rejection = expect(
      assertForkStorageHeadroom({ targetWorkspaceId: 'target-ws', bytes: 50 })
    ).rejects
    await rejection.toBeInstanceOf(ForkError)
    await rejection.toMatchObject({
      statusCode: 413,
      message:
        'Not enough storage to copy the selected resources. Storage limit exceeded. Used: 10.50GB, Limit: 10GB',
    })
  })

  it('falls back to a generic storage message when the quota helper omits one', async () => {
    mockCheckStorageQuotaForBillingContext.mockResolvedValue({
      allowed: false,
      currentUsage: 0,
      limit: 0,
    })

    await expect(
      assertForkStorageHeadroom({ targetWorkspaceId: 'target-ws', bytes: 1 })
    ).rejects.toThrow('Not enough storage to copy the selected resources. Storage limit exceeded')
  })

  it('derives a not-yet-created fork payer from the creation policy', async () => {
    mockGetOrganizationSubscription.mockResolvedValue({
      plan: 'team',
      metadata: { customStorageLimitGB: 250 },
    })
    mockCheckStorageQuotaForBillingContext.mockResolvedValue({
      allowed: true,
      currentUsage: 10,
      limit: 100,
    })

    await assertForkStorageHeadroom({
      plannedWorkspaceId: 'planned-child-ws',
      creationPolicy: {
        workspaceMode: 'organization',
        organizationId: 'target-org',
        billedAccountUserId: 'target-org-owner',
      },
      bytes: 50,
    })

    expect(mockGetOrganizationSubscription).toHaveBeenCalledWith('target-org', {
      onError: 'throw',
    })
    expect(mockGetHighestPriorityPersonalSubscription).not.toHaveBeenCalled()
    expect(mockCheckStorageQuotaForBillingContext).toHaveBeenCalledWith(
      {
        workspaceId: 'planned-child-ws',
        billedAccountUserId: 'target-org-owner',
        billingEntity: { type: 'organization', id: 'target-org' },
        plan: 'team',
        customStorageLimitGB: 250,
      },
      50
    )
  })
})
