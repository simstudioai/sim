/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockTransaction,
  mockIsWorkspaceCreationGovernedByPermissionGroups,
  mockLockWorkspaceCreationContext,
  mockGetWorkspaceInvitePolicy,
  mockSaveWorkflowToNormalizedTables,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockIsWorkspaceCreationGovernedByPermissionGroups: vi.fn(),
  mockLockWorkspaceCreationContext: vi.fn(),
  mockGetWorkspaceInvitePolicy: vi.fn(),
  mockSaveWorkflowToNormalizedTables: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: { transaction: mockTransaction },
}))

/** The starter workflow is not what these cases are about, and it reaches the block registry. */
vi.mock('@/lib/workflows/persistence/utils', () => ({
  saveWorkflowToNormalizedTables: mockSaveWorkflowToNormalizedTables,
}))

vi.mock('@/lib/workflows/defaults', () => ({
  buildDefaultWorkflowArtifacts: () => ({ workflowState: {} }),
}))

vi.mock('@/lib/workspaces/policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspaces/policy')>()
  return {
    ...actual,
    isWorkspaceCreationGovernedByPermissionGroups:
      mockIsWorkspaceCreationGovernedByPermissionGroups,
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
    mockGetWorkspaceInvitePolicy.mockResolvedValue({})
  })

  /**
   * The ENTITLEMENT half must be settled before the transaction opens: it
   * bottoms out in the `cache()`d `isOrganizationOnEnterprisePlan`, which admits
   * no executor, so running it inside checked out a SECOND pooled connection
   * while three advisory locks were held — what `packages/db/tx-tripwire.ts`
   * fires on, and what pushed concurrent creates past the 5s `lock_timeout`.
   *
   * Asserted as an explicit ordering rather than inferred from the absence of a
   * tripwire warning: nothing else in the unit suite can catch a regression
   * here, because `vitest.setup.ts` mocks `@sim/db` globally and the real pool
   * instrumentation never runs.
   */
  it('resolves the permission regime before opening the transaction', async () => {
    mockIsWorkspaceCreationGovernedByPermissionGroups.mockResolvedValue(true)
    /**
     * The callback is deliberately NOT invoked, so the transaction's own
     * internals stay out of the assertion and cannot fail it for an unrelated
     * reason.
     */
    mockTransaction.mockResolvedValue({
      id: 'ws-1',
      name: params.name,
      organizationId: 'org-1',
      workspaceMode: WORKSPACE_MODE.ORGANIZATION,
      billedAccountUserId: 'creator-1',
      ownerId: 'creator-1',
    })

    await createWorkspace(params)

    expect(mockIsWorkspaceCreationGovernedByPermissionGroups).toHaveBeenCalledWith({
      organizationId: 'org-1',
      observedOrganizationId: 'org-1',
    })
    expect(
      mockIsWorkspaceCreationGovernedByPermissionGroups.mock.invocationCallOrder[0]
    ).toBeLessThan(mockTransaction.mock.invocationCallOrder[0])
  })

  /**
   * The capability itself is enforced INSIDE the transaction, under the
   * permission-group lock — so the regime answer has to reach
   * `lockWorkspaceCreationContext`. Dropping it there would silently skip the
   * gate for every governed organization.
   */
  it('carries the regime answer into the locked creation context', async () => {
    mockIsWorkspaceCreationGovernedByPermissionGroups.mockResolvedValue(true)
    mockLockWorkspaceCreationContext.mockResolvedValue({ billedAccountUserId: 'creator-1' })
    const tx = { insert: vi.fn(() => ({ values: vi.fn() })) } as unknown as DbOrTx
    mockTransaction.mockImplementation((callback: (executor: DbOrTx) => Promise<unknown>) =>
      callback(tx)
    )

    await createWorkspace({ ...params, skipDefaultWorkflow: true })

    expect(mockLockWorkspaceCreationContext).toHaveBeenCalledWith(tx, {
      userId: 'creator-1',
      organizationId: 'org-1',
      observedOrganizationId: 'org-1',
      permissionGroupsGovernCreation: true,
    })
  })
})

describe('createDefaultPersonalWorkspaceInTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    expect(mockIsWorkspaceCreationGovernedByPermissionGroups).not.toHaveBeenCalled()
    expect(mockLockWorkspaceCreationContext).toHaveBeenCalledWith(tx, {
      userId: 'user-1',
      organizationId: null,
      observedOrganizationId: null,
      permissionGroupsGovernCreation: false,
    })
  })
})
