/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ role: vi.fn(), list: vi.fn() }))
vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: mocks.role,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: async (workspaceId: string) => ({
    workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
  }),
}))
vi.mock('@/lib/invitations/core', () => ({ listInvitationsForWorkspaces: mocks.list }))

import { listWorkspaceInvitations } from '@/lib/invitations/application/list-workspace-invitations'

const principal = {
  kind: 'delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  workspaceId: 'workspace',
  audience: 'sim:settings',
  delegationId: 'call',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
} as const
const row = {
  id: 'invite',
  workspaceId: 'workspace',
  email: 'invitee@example.com',
  permission: 'read',
  membershipIntent: 'external',
  status: 'pending',
  createdAt: new Date(),
  expiresAt: new Date(),
  token: 'sensitive',
  futurePrivateColumn: 'secret',
}

describe('workspace invitation discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.role.mockResolvedValue('admin')
    mocks.list.mockResolvedValue([row])
  })

  it('projects only safe pending metadata in the authoritative workspace', async () => {
    mocks.list.mockResolvedValue([
      row,
      { ...row, id: 'accepted', status: 'accepted' },
      { ...row, id: 'foreign', workspaceId: 'foreign' },
    ])
    const result = await listWorkspaceInvitations.execute({
      principal,
      input: { workspaceId: 'workspace' },
    })
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(['workspace'])
    expect(result).toEqual({
      invitations: [
        {
          id: 'invite',
          workspaceId: 'workspace',
          email: row.email,
          permission: 'read',
          membershipIntent: 'external',
          status: 'pending',
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('sensitive')
    expect(JSON.stringify(result)).not.toContain('futurePrivateColumn')
  })

  it.each(['read', 'write', null])(
    'refuses non-admin authority %s before listing',
    async (role) => {
      mocks.role.mockResolvedValue(role)
      await expect(
        listWorkspaceInvitations.execute({ principal, input: { workspaceId: 'workspace' } })
      ).rejects.toThrow()
      expect(mocks.list).not.toHaveBeenCalled()
    }
  )

  it('refuses wrong target, expired authority, and wrong audience', async () => {
    await expect(
      listWorkspaceInvitations.execute({ principal, input: { workspaceId: 'other' } })
    ).rejects.toThrow()
    await expect(
      listWorkspaceInvitations.execute({
        principal: { ...principal, expiresAt: new Date(0) },
        input: { workspaceId: 'workspace' },
      })
    ).rejects.toThrow()
    await expect(
      listWorkspaceInvitations.execute({
        principal: { ...principal, audience: 'sim:other' },
        input: { workspaceId: 'workspace' },
      })
    ).rejects.toThrow()
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
