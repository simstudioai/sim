import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import {
  invitationsCoreMock,
  invitationsCoreMockFns,
} from '@sim/testing/mocks/invitations-core.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { workspaceContextMock } from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/invitations/core', () => invitationsCoreMock)

import { listWorkspaceInvitations } from '@/lib/invitations/application/list-workspace-invitations'

const mocks = {
  list: invitationsCoreMockFns.mockListInvitationsForWorkspaces,
  role: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const principal = createDelegatedPrincipal({
  subjectUserId: 'actor',
  workspaceId: 'workspace',
  audience: 'sim:settings',
  delegationId: 'call',
})
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
