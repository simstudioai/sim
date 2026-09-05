/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockTransaction,
  mockAssertWorkspaceCreationCapability,
  mockLockWorkspaceCreationContext,
  mockGetWorkspaceInvitePolicy,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockAssertWorkspaceCreationCapability: vi.fn(),
  mockLockWorkspaceCreationContext: vi.fn(),
  mockGetWorkspaceInvitePolicy: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: { transaction: mockTransaction },
}))

vi.mock('@/lib/workspaces/policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspaces/policy')>()
  return {
    ...actual,
    assertWorkspaceCreationCapability: mockAssertWorkspaceCreationCapability,
    lockWorkspaceCreationContext: mockLockWorkspaceCreationContext,
    getWorkspaceInvitePolicy: mockGetWorkspaceInvitePolicy,
  }
})

import { createWorkspace } from '@/lib/workspaces/create'
import { WORKSPACE_MODE, WorkspaceCreationCapabilityWithheldError } from '@/lib/workspaces/policy'

const params = {
  userId: 'creator-1',
  observedOrganizationId: 'org-1',
  name: 'Test Workspace',
  organizationId: 'org-1',
  workspaceMode: WORKSPACE_MODE.ORGANIZATION,
  billedAccountUserId: 'creator-1',
}

describe('createWorkspace capability gate placement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkspaceInvitePolicy.mockResolvedValue({})
  })

  /**
   * The gate resolves the organization's entitlement and default group — up to
   * four sequential reads. Run inside the transaction it checked out a SECOND
   * pooled connection while three advisory locks were held, which is what
   * `packages/db/tx-tripwire.ts` fires on and what pushed concurrent creates
   * past the 5s `lock_timeout` into a generic 500.
   *
   * Ordering is the whole fix, so it is asserted directly rather than inferred
   * from the absence of a tripwire warning: nothing else in the unit suite can
   * catch a regression here, because `vitest.setup.ts` mocks `@sim/db` globally
   * and the real pool instrumentation never runs.
   */
  it('gates before opening the transaction, not inside it', async () => {
    /**
     * The callback is deliberately NOT invoked. This pins the ORDER of the gate
     * against `db.transaction`, so the transaction's own internals stay out of
     * the assertion and cannot make it fail for an unrelated reason.
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

    expect(mockAssertWorkspaceCreationCapability).toHaveBeenCalledWith({
      organizationId: 'org-1',
      observedOrganizationId: 'org-1',
    })
    expect(mockAssertWorkspaceCreationCapability.mock.invocationCallOrder[0]).toBeLessThan(
      mockTransaction.mock.invocationCallOrder[0]
    )
  })

  /** A withheld capability must refuse before any transaction is opened at all. */
  it('never opens a transaction when the capability is withheld', async () => {
    mockAssertWorkspaceCreationCapability.mockRejectedValue(
      new WorkspaceCreationCapabilityWithheldError()
    )

    await expect(createWorkspace(params)).rejects.toBeInstanceOf(
      WorkspaceCreationCapabilityWithheldError
    )
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
