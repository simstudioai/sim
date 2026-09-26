import { dbChainMockFns, resetDbChainMock, workflowsPersistenceUtilsMock } from '@sim/testing'
import {
  workspacesPolicyMock,
  workspacesPolicyMockFns,
} from '@sim/testing/mocks/workspaces-policy.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateWorkspaceAccountsGroup } = vi.hoisted(() => ({
  mockCreateWorkspaceAccountsGroup: vi.fn(),
}))

/** The starter workflow is not what these cases are about, and it reaches the block registry. */
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/lib/credential-groups/workspace-accounts', () => ({
  createWorkspaceAccountsGroup: mockCreateWorkspaceAccountsGroup,
}))

vi.mock('@/lib/workflows/defaults', () => ({
  buildDefaultWorkflowArtifacts: () => ({ workflowState: {} }),
}))

vi.mock('@/lib/workspaces/policy', () => workspacesPolicyMock)

import type { DbOrTx } from '@/lib/db/types'
import {
  createDefaultPersonalWorkspaceInTransaction,
  createWorkspace,
} from '@/lib/workspaces/create'
import { WORKSPACE_MODE, WorkspaceOwnerMissingError } from '@/lib/workspaces/policy'

const {
  mockResolveGoverningPermissionGroupOrganization,
  mockLockWorkspaceCreationContext,
  mockGetWorkspaceInvitePolicy,
} = workspacesPolicyMockFns

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
   * A cached session cookie can outlive the user row by a few minutes. The
   * insert then fails on a `workspace` -> `user` foreign key, which the caller
   * must be able to tell apart from a fault so it answers 401, not 500.
   */
  it('reports a missing owner as a typed error instead of a fault', async () => {
    mockResolveGoverningPermissionGroupOrganization.mockResolvedValue('org-1')
    dbChainMockFns.transaction.mockRejectedValue(
      Object.assign(new Error('insert or update on table "workspace" violates foreign key'), {
        code: '23503',
        constraint_name: 'workspace_billed_account_user_id_user_id_fk',
      })
    )

    await expect(createWorkspace(params)).rejects.toBeInstanceOf(WorkspaceOwnerMissingError)
  })
})

describe('createDefaultPersonalWorkspaceInTransaction', () => {
  beforeEach(() => {
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

    expect(mockCreateWorkspaceAccountsGroup).not.toHaveBeenCalled()

    expect(mockResolveGoverningPermissionGroupOrganization).not.toHaveBeenCalled()
    expect(mockLockWorkspaceCreationContext).toHaveBeenCalledWith(tx, {
      userId: 'user-1',
      organizationId: null,
      observedOrganizationId: null,
      governingPermissionGroupOrganizationId: null,
    })
  })
})
