import type { DelegatedPrincipal, Principal } from '@sim/auth/principal'
import { auditMock, auditMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  permission: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
  reconcile: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.context,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspacePermissionsForViewer: mocks.read,
}))
vi.mock('@/lib/workspaces/permissions/management-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workspaces/permissions/management-store')>()),
  updateWorkspacePermissionRecords: mocks.update,
  reconcileWorkspacePermissionCredentials: mocks.reconcile,
}))

import {
  COPILOT_APPLICATION_SYSTEM_ERROR_MESSAGE,
  messageForCopilotApplicationError,
} from '@/lib/mothership/application/error'
import { updateWorkspacePermissions } from '@/lib/workspaces/application/manage-permissions'
import { WorkspacePermissionError } from '@/lib/workspaces/permissions/management-store'

const principal: DelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  workspaceId: 'workspace',
  delegationId: 'tool-call',
  audience: 'sim:settings',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
}
const input = {
  workspaceId: 'workspace',
  updates: [{ userId: 'target', permissions: 'write' as const }],
}
const change = {
  targetUserId: 'target',
  targetEmail: 'target@example.com',
  previousRole: 'read',
  newRole: 'write',
}

describe('workspace permission operations', () => {
  beforeEach(() => {
    mocks.context.mockResolvedValue({
      workspaceId: 'workspace',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    })
    mocks.permission.mockResolvedValue('admin')
    mocks.read.mockResolvedValue({
      users: [],
      total: 0,
      viewer: { userId: 'actor', isAdmin: true, permissionType: 'admin' },
    })
    mocks.update.mockResolvedValue([change])
    mocks.reconcile.mockResolvedValue(undefined)
  })

  it.each<Principal>([principal, { kind: 'session', userId: 'actor', sessionId: 'session' }])(
    'uses the current human actor and canonical workspace for %s',
    async (actor) => {
      await updateWorkspacePermissions.execute({ principal: actor, input })
      expect(mocks.permission).toHaveBeenCalledWith('actor', 'workspace', null, undefined, {
        forUpdate: undefined,
      })
      expect(mocks.update).toHaveBeenCalledWith('workspace', 'actor', input.updates)
      expect(mocks.reconcile).toHaveBeenCalledWith('workspace', 'actor')
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor',
          workspaceId: 'workspace',
          metadata: expect.objectContaining({
            targetUserId: 'target',
            previousRole: 'read',
            newRole: 'write',
            actor: expect.objectContaining({ kind: actor.kind }),
          }),
        })
      )
    }
  )

  it.each(['read', 'write', null])(
    'refuses non-admin mutations before protected writes (%s)',
    async (permission) => {
      mocks.permission.mockResolvedValue(permission)
      await expect(updateWorkspacePermissions.execute({ principal, input })).rejects.toThrow()
      expect(mocks.update).not.toHaveBeenCalled()
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    }
  )

  it.each([
    { ...principal, workspaceId: 'foreign' },
    { ...principal, audience: 'sim:files' },
    { ...principal, expiresAt: new Date(0) },
  ])('rejects a forged, expired or wrong-audience delegation', async (actor) => {
    await expect(updateWorkspacePermissions.execute({ principal: actor, input })).rejects.toThrow()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rejects unsupported principals before canonical loading', async () => {
    await expect(
      updateWorkspacePermissions.execute({
        principal: { kind: 'personal_api_key', userId: 'actor', keyId: 'key' },
        input,
      })
    ).rejects.toThrow()
    expect(mocks.context).not.toHaveBeenCalled()
  })

  it('rejects duplicate direct application updates before the mutation', async () => {
    await expect(
      updateWorkspacePermissions.execute({
        principal,
        input: { ...input, updates: [...input.updates, ...input.updates] },
      })
    ).rejects.toThrow('Each user may appear only once')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it.each([
    [400, 'validation'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
  ])(
    'preserves safe store failure %s through application and tool projection',
    async (status, code) => {
      const failure = new WorkspacePermissionError(
        Number(status),
        'Refresh your membership and retry'
      )
      mocks.update.mockRejectedValue(new Error('private SQL and credentials', { cause: failure }))
      const result = await updateWorkspacePermissions
        .execute({ principal, input })
        .catch((error: unknown) => error)
      expect(result).toMatchObject({ code, message: failure.message })
      expect(messageForCopilotApplicationError(result)).toBe(failure.message)
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
      expect(mocks.reconcile).not.toHaveBeenCalled()
    }
  )

  it.each([
    new Error('private SQL and credentials'),
    Object.assign(new Error('forged HTTP error'), { statusCode: 403 }),
    new WorkspacePermissionError(500, 'private unexpected failure'),
  ])('keeps unclassified and server errors out of tool output', async (failure) => {
    mocks.update.mockRejectedValue(failure)
    const result = await updateWorkspacePermissions
      .execute({ principal, input })
      .catch((error: unknown) => error)
    expect(result).toBe(failure)
    expect(messageForCopilotApplicationError(result)).toBe(COPILOT_APPLICATION_SYSTEM_ERROR_MESSAGE)
  })

  it('audits durable transitions before credential reconciliation', async () => {
    const order: string[] = []
    mocks.update.mockImplementation(async () => {
      order.push('mutation')
      return [change]
    })
    auditMockFns.mockRecordAudit.mockImplementation(() => {
      order.push('audit')
    })
    mocks.reconcile.mockImplementation(async () => {
      order.push('reconcile')
    })
    await updateWorkspacePermissions.execute({ principal, input })
    expect(order).toEqual(['mutation', 'audit', 'reconcile'])
  })
})
