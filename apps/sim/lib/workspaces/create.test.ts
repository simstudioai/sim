/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  resetDbChainMock,
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveGoverningPermissionGroupOrganization,
  mockLockWorkspaceCreationContext,
  mockGetWorkspaceInvitePolicy,
} = vi.hoisted(() => ({
  mockResolveGoverningPermissionGroupOrganization: vi.fn(),
  mockLockWorkspaceCreationContext: vi.fn(),
  mockGetWorkspaceInvitePolicy: vi.fn(),
}))

/** The starter workflow is not what these cases are about, and it reaches the block registry. */
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/lib/credential-groups/workspace-accounts', () => ({
  createWorkspaceAccountsGroup: vi.fn(),
}))

vi.mock('@/lib/workflows/defaults', () => ({
  buildDefaultWorkflowArtifacts: () => ({ workflowState: {} }),
}))

vi.mock('@/lib/workspaces/policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspaces/policy')>()
  return {
    ...actual,
    resolveGoverningPermissionGroupOrganization: mockResolveGoverningPermissionGroupOrganization,
    lockWorkspaceCreationContext: mockLockWorkspaceCreationContext,
    getWorkspaceInvitePolicy: mockGetWorkspaceInvitePolicy,
  }
})

import type { DbOrTx } from '@/lib/db/types'
import {
  createDefaultPersonalWorkspaceInTransaction,
  createWorkspace,
} from '@/lib/workspaces/create'
import { WORKSPACE_MODE } from '@/lib/workspaces/policy'

const params = {
  userId: 'creator-1',
  observedOrganizationId: 'org-1',
  name: 'Test Workspace',
  organizationId: 'org-1',
  workspaceMode: WORKSPACE_MODE.ORGANIZATION,
  billedAccountUserId: 'creator-1',
}

describe('createWorkspace capability-gate placement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetWorkspaceInvitePolicy.mockResolvedValue({})
  })

  /**
   * The ENTITLEMENT half must be settled before the transaction opens — see
   * {@link resolveGoverningPermissionGroupOrganization}.
   *
   * Asserted as an explicit ordering rather than inferred from the absence of a
   * tripwire warning: nothing else in the unit suite can catch a regression
   * here, because `vitest.setup.ts` mocks `@sim/db` globally and the real pool
   * instrumentation never runs.
   */
  it('resolves the permission regime before opening the transaction', async () => {
    mockResolveGoverningPermissionGroupOrganization.mockResolvedValue('org-1')
    /**
     * The callback is deliberately NOT invoked, so the transaction's own
     * internals stay out of the assertion and cannot fail it for an unrelated
     * reason.
     */
    dbChainMockFns.transaction.mockResolvedValue({
      id: 'ws-1',
      name: params.name,
      organizationId: 'org-1',
      workspaceMode: WORKSPACE_MODE.ORGANIZATION,
      billedAccountUserId: 'creator-1',
      ownerId: 'creator-1',
    })

    await createWorkspace(params)

    expect(mockResolveGoverningPermissionGroupOrganization).toHaveBeenCalledWith({
      organizationId: 'org-1',
      observedOrganizationId: 'org-1',
    })
    expect(
      mockResolveGoverningPermissionGroupOrganization.mock.invocationCallOrder[0]
    ).toBeLessThan(dbChainMockFns.transaction.mock.invocationCallOrder[0])
  })

  /**
   * The capability itself is enforced INSIDE the transaction, under the
   * permission-group lock — so the governing organization has to reach
   * `lockWorkspaceCreationContext`. Dropping it there would silently skip the
   * gate for every governed organization.
   */
  it('carries the governing organization into the locked creation context', async () => {
    mockResolveGoverningPermissionGroupOrganization.mockResolvedValue('org-1')
    mockLockWorkspaceCreationContext.mockResolvedValue({ billedAccountUserId: 'creator-1' })
    const tx = { insert: vi.fn(() => ({ values: vi.fn() })) } as unknown as DbOrTx
    dbChainMockFns.transaction.mockImplementation(
      (callback: (executor: DbOrTx) => Promise<unknown>) => callback(tx)
    )

    await createWorkspace({ ...params, skipDefaultWorkflow: true })

    expect(mockLockWorkspaceCreationContext).toHaveBeenCalledWith(tx, {
      userId: 'creator-1',
      organizationId: 'org-1',
      observedOrganizationId: 'org-1',
      governingPermissionGroupOrganizationId: 'org-1',
    })
  })

  /**
   * The preflight policy resolved this value microseconds earlier in the same
   * request, and React's `cache()` memo does not span the two calls, so a
   * forwarded answer must be used as-is rather than re-read.
   */
  it('reuses the governing organization the caller already resolved', async () => {
    mockLockWorkspaceCreationContext.mockResolvedValue({ billedAccountUserId: 'creator-1' })
    const tx = { insert: vi.fn(() => ({ values: vi.fn() })) } as unknown as DbOrTx
    dbChainMockFns.transaction.mockImplementation(
      (callback: (executor: DbOrTx) => Promise<unknown>) => callback(tx)
    )

    await createWorkspace({
      ...params,
      skipDefaultWorkflow: true,
      governingPermissionGroupOrganizationId: 'org-1',
    })

    expect(mockResolveGoverningPermissionGroupOrganization).not.toHaveBeenCalled()
    expect(mockLockWorkspaceCreationContext).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ governingPermissionGroupOrganizationId: 'org-1' })
    )
  })
})

describe('createDefaultPersonalWorkspaceInTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  /**
   * Reached from `lib/billing/enterprise-owner-claim.ts` inside an EXTERNAL
   * transaction. No organization governs it, so it must take no permission-group
   * lock — which is also what keeps it from deadlocking against the locks that
   * enclosing transaction already holds.
   */
  it('creates an ungoverned personal workspace and resolves no regime', async () => {
    mockLockWorkspaceCreationContext.mockResolvedValue({ billedAccountUserId: 'user-1' })
    const tx = { insert: vi.fn(() => ({ values: vi.fn() })) } as unknown as DbOrTx

    await createDefaultPersonalWorkspaceInTransaction(tx, {
      userId: 'user-1',
      userName: 'Ada Lovelace',
    })

    expect(mockResolveGoverningPermissionGroupOrganization).not.toHaveBeenCalled()
    expect(mockLockWorkspaceCreationContext).toHaveBeenCalledWith(tx, {
      userId: 'user-1',
      organizationId: null,
      observedOrganizationId: null,
      governingPermissionGroupOrganizationId: null,
    })
  })

  /** The starter workflow is built before the locks, so it must still be written. */
  it('seeds the starter workflow it built before taking the locks', async () => {
    mockLockWorkspaceCreationContext.mockResolvedValue({ billedAccountUserId: 'user-1' })
    const tx = { insert: vi.fn(() => ({ values: vi.fn() })) } as unknown as DbOrTx

    await createDefaultPersonalWorkspaceInTransaction(tx, {
      userId: 'user-1',
      userName: 'Ada Lovelace',
    })

    expect(
      workflowsPersistenceUtilsMockFns.mockSaveWorkflowToNormalizedTables
    ).toHaveBeenCalledWith(expect.any(String), {}, { workspaceId: null, subjectUserId: null }, tx)
  })
})
