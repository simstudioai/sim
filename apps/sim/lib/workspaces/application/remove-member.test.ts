import type { DelegatedPrincipal, Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  auditMock,
  auditMockFns,
  authMockFns,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  context: vi.fn(),
  orgAdmin: vi.fn(),
  revoke: vi.fn(),
  removeOrg: vi.fn(),
  seats: vi.fn(),
  analytics: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: mocks.role,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.context,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  isOrganizationAdminOrOwner: mocks.orgAdmin,
}))
vi.mock('@/lib/workspaces/access/workspace-access', () => ({
  revokeWorkspaceAccessTx: mocks.revoke,
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  removeUserFromOrganization: mocks.removeOrg,
}))
vi.mock('@/lib/billing/organizations/seats', () => ({ reconcileOrganizationSeats: mocks.seats }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.analytics }))

import { removeWorkspaceMember } from '@/lib/workspaces/application/remove-member'

const delegated: DelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  delegationId: 'call',
  audience: 'sim:settings',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
}

function queueWorkspace(
  options: {
    userId?: string
    role?: string
    organizationId?: string
    ownerId?: string
    billedAccountUserId?: string
    missingTarget?: boolean
  } = {}
) {
  queueTableRows(schemaMock.workspace, [
    {
      ownerId: options.ownerId ?? 'owner',
      billedAccountUserId: options.billedAccountUserId ?? 'billing',
      organizationId: options.organizationId ?? null,
    },
  ])
  queueTableRows(
    schemaMock.permissions,
    options.missingTarget
      ? []
      : [{ userId: options.userId ?? 'target', permissionType: options.role ?? 'read' }]
  )
  if (options.organizationId) queueTableRows(schemaMock.member, [{ id: 'org-member' }])
}

const remove = (userId = 'target', principal: Principal = delegated) =>
  removeWorkspaceMember.execute({
    principal,
    input: { workspaceId: '11111111-1111-4111-8111-111111111111', userId },
  })

describe('workspace member removal', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.context.mockResolvedValue({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    })
    mocks.role.mockResolvedValue('admin')
    mocks.orgAdmin.mockResolvedValue(false)
    mocks.revoke.mockResolvedValue({ revoked: true, ownershipTransferred: false })
    mocks.removeOrg.mockResolvedValue({ success: true, removed: true })
    mocks.seats.mockResolvedValue({ changed: true })
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'actor' },
      session: { id: 'live-session' },
    })
  })

  it.each(['read', 'write'])(
    'allows a %s member to leave but not remove someone else',
    async (role) => {
      mocks.role.mockResolvedValue(role)
      queueWorkspace({ userId: 'actor', role })
      expect(await remove('actor')).toMatchObject({ selfRemoval: true })
      mocks.revoke.mockClear()
      await expect(remove()).rejects.toThrow('Insufficient workspace permissions')
      expect(mocks.revoke).not.toHaveBeenCalled()
    }
  )

  it('keeps the last explicit admin unless ownership will transfer', async () => {
    queueWorkspace({ userId: 'actor', role: 'admin' })
    queueTableRows(schemaMock.permissions, [{ userId: 'actor', permissionType: 'admin' }])
    await expect(remove('actor')).rejects.toThrow('Cannot remove the last admin')
    expect(mocks.revoke).not.toHaveBeenCalled()
  })

  it('allows owner-only membership to transfer to the billing account', async () => {
    queueWorkspace({ ownerId: 'target', missingTarget: true })
    mocks.revoke.mockResolvedValue({ revoked: true, ownershipTransferred: true })
    expect(await remove()).toMatchObject({ ownershipTransferred: true, removedUserRole: 'owner' })
  })

  it('refuses billing-account removal before revoking access', async () => {
    queueWorkspace({ billedAccountUserId: 'target' })
    await expect(remove()).rejects.toThrow('Cannot remove the workspace billing account')
    expect(mocks.revoke).not.toHaveBeenCalled()
  })

  it.each(['actor', 'target'])(
    'preserves inherited organization-admin access for %s',
    async (userId) => {
      queueWorkspace({ organizationId: 'org', userId })
      mocks.orgAdmin.mockResolvedValue(true)
      await expect(remove(userId)).rejects.toThrow(
        'Organization admins are automatically workspace admins'
      )
      expect(mocks.revoke).not.toHaveBeenCalled()
    }
  )

  it('throws a refusal before the transaction can commit any ownership changes', async () => {
    queueWorkspace()
    mocks.revoke.mockResolvedValue({
      revoked: false,
      reason: 'unresolved-workflows',
      unresolvedWorkflows: ['workflow'],
    })
    let committed = false
    dbChainMockFns.transaction.mockImplementationOnce(async (callback) => {
      const result = await callback(db)
      committed = true
      return result
    })
    await expect(remove()).rejects.toThrow()
    expect(committed).toBe(false)
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('retains membership and seat when another organization workspace remains', async () => {
    queueWorkspace({ organizationId: 'org' })
    mocks.removeOrg.mockResolvedValue({ success: true, removed: false })
    expect(await remove()).toMatchObject({ organizationRemoval: false })
    expect(mocks.seats).not.toHaveBeenCalled()
  })

  it.each(['membership', 'seats'])(
    'audits the committed removal when %s reconciliation fails',
    async (stage) => {
      queueWorkspace({ organizationId: 'org' })
      if (stage === 'membership')
        mocks.removeOrg.mockRejectedValue(new Error('Database unavailable'))
      else mocks.seats.mockRejectedValue(new Error('Provider unavailable'))
      expect(await remove()).toMatchObject({ success: true, reconciliationPending: true })
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
    }
  )

  it('rejects wrong-workspace and expired delegation before removing access', async () => {
    await expect(remove('target', { ...delegated, workspaceId: 'foreign' })).rejects.toThrow()
    await expect(remove('target', { ...delegated, expiresAt: new Date(0) })).rejects.toThrow()
    expect(mocks.revoke).not.toHaveBeenCalled()
  })
})
