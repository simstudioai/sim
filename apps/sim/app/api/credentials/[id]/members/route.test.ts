import { credential } from '@sim/db/schema'
import {
  auditMock,
  authMockFns,
  createMockRequest,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listMembers: vi.fn(),
  removeMember: vi.fn(),
  upsertMember: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/credentials/members', () => ({
  leaveCredentialMembership: vi.fn(),
  listCredentialMembers: mocks.listMembers,
  listCredentialMembershipsForUser: vi.fn(),
  removeCredentialMember: mocks.removeMember,
  upsertCredentialMember: mocks.upsertMember,
}))

import { DELETE, GET, POST } from '@/app/api/credentials/[id]/members/route'

const CREDENTIAL_ID = 'credential-1'
const WORKSPACE_ID = 'workspace-1'
const routeContext = createRouteContext({ id: CREDENTIAL_ID })
const credentialRow = {
  id: CREDENTIAL_ID,
  workspaceId: WORKSPACE_ID,
  type: 'oauth' as const,
  displayName: 'Google account',
  description: null,
  providerId: 'google-email',
  accountId: 'account-1',
  envKey: null,
  envOwnerUserId: null,
  encryptedServiceAccountKey: null,
  createdBy: 'user-1',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
}

describe('/api/credentials/[id]/members compatibility', () => {
  beforeEach(() => {
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'owner-1',
    })
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
    mocks.listMembers.mockResolvedValue([
      {
        id: 'member-1',
        userId: 'user-2',
        role: 'member',
        status: 'active',
        joinedAt: new Date('2026-08-02T00:00:00.000Z'),
        userName: 'Member',
        userEmail: 'member@example.com',
      },
    ])
  })

  it('allows any workspace reader to list the credential roster', async () => {
    queueTableRows(credential, [credentialRow])

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost/api/credentials/${CREDENTIAL_ID}/members`
      ),
      routeContext
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      members: [
        expect.objectContaining({
          id: 'member-1',
          joinedAt: '2026-08-02T00:00:00.000Z',
        }),
      ],
    })
    expect(mocks.listMembers).toHaveBeenCalledWith(credentialRow)
  })

  it('conceals an existing credential outside the caller workspace as not found', async () => {
    queueTableRows(credential, [credentialRow])
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost/api/credentials/${CREDENTIAL_ID}/members`
      ),
      routeContext
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(mocks.listMembers).not.toHaveBeenCalled()
  })

  it('keeps nonexistent POST and DELETE targets behind the uniform admin denial', async () => {
    queueTableRows(credential, [])
    const postResponse = await POST(
      createMockRequest('POST', { userId: 'user-2', role: 'member' }),
      routeContext
    )
    queueTableRows(credential, [])
    const deleteResponse = await DELETE(
      createMockRequest(
        'DELETE',
        undefined,
        {},
        `http://localhost/api/credentials/${CREDENTIAL_ID}/members?userId=user-2`
      ),
      routeContext
    )

    expect(postResponse.status).toBe(403)
    expect(await postResponse.json()).toEqual({ error: 'Admin access required' })
    expect(deleteResponse.status).toBe(403)
    expect(await deleteResponse.json()).toEqual({ error: 'Admin access required' })
  })
})
