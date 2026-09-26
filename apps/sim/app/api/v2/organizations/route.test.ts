import { member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import {
  invitationsCoreMock,
  invitationsCoreMockFns,
} from '@sim/testing/mocks/invitations-core.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import {
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing/mocks/v2-route.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resend: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/invitations/core', () => invitationsCoreMock)
vi.mock('@/lib/invitations/mutation-manager', () => ({
  resendInvitationRecord: mocks.resend,
  revokeInvitationRecord: vi.fn(),
}))

import { dispatchMcpOperation } from '@/lib/api/mcp/dispatch'
import {
  internalOrganizationErrorPolicy,
  v2OrganizationErrorPolicy,
} from '@/lib/api/server/routes/organizations'
import { InvitationNotPendingError } from '@/lib/invitations/errors'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { POST } from '@/app/api/v2/organizations/[organizationId]/invitations/[invitationId]/resend/route'

const { mockGetInvitationById } = invitationsCoreMockFns

const principal = createPersonalApiKeyPrincipal({ userId: 'actor', keyId: 'key' })
const params = { organizationId: 'org', invitationId: 'invite' }
const context = createRouteContext(params)
const inv = {
  id: 'invite',
  organizationId: 'org',
  email: 'person@example.com',
  role: 'member',
  kind: 'organization',
  membershipIntent: 'internal',
  status: 'pending',
  token: 'SECRET',
  grants: [],
  createdAt: new Date('2026-01-01'),
  expiresAt: new Date('2099-01-01'),
}
function request(body?: unknown) {
  return createMockRequest({
    method: 'POST',
    url: 'http://localhost/api/v2/organizations/org/invitations/invite/resend',
    headers: {
      'x-api-key': 'key',
      'content-type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
    },
    body,
  })
}
beforeEach(() => {
  resetDbChainMock()
  v2RouteMocks.authenticate.mockResolvedValue({
    principal,
    keyType: 'personal',
    rateLimitSubjectIds: ['key:key'],
    rateLimitSubscription: null,
  })
  const admission = {
    allowed: true,
    remaining: 99,
    resetAt: new Date(Date.now() + 60_000),
    retryAfterMs: 0,
  }
  v2RouteMocks.preauthRate.mockResolvedValue(admission)
  v2RouteMocks.operationRate.mockResolvedValue(admission)
  permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue(null)
  mockGetInvitationById.mockResolvedValue(inv)
  mocks.resend.mockResolvedValue(inv)
})

describe('organization invitation API and MCP', () => {
  it.each(['resend', 'revoke'] as const)(
    'preserves internal validation status for %s while exposing public conflict status',
    (action) => {
      const error = new InvitationNotPendingError(action)
      expect(internalOrganizationErrorPolicy.project(error)?.status).toBe(400)
      expect(v2OrganizationErrorPolicy.render(error)?.status).toBe(409)
    }
  )

  it.each([undefined, {}])(
    'accepts a bodyless or empty resend and never returns tokens',
    async (body) => {
      queueTableRows(member, [{ role: 'admin' }])
      const response = await POST(request(body), context)
      expect(response.status).toBe(200)
      const payload = await response.json()
      expect(payload).toMatchObject({ data: { id: 'invite', organizationId: 'org' } })
      expect(payload.data).not.toHaveProperty('token')
      expect(mocks.resend).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 'actor', assertedOrganizationId: 'org' })
      )
    }
  )

  it.each([
    ['member', 403],
    [null, 404],
  ] as const)('refuses org role %s', async (role, status) => {
    queueTableRows(member, role ? [{ role }] : [])
    expect((await POST(request(), context)).status).toBe(status)
    expect(mocks.resend).not.toHaveBeenCalled()
  })

  it('conceals a cross-organization invitation', async () => {
    mockGetInvitationById.mockResolvedValue({ ...inv, organizationId: 'another' })
    expect((await POST(request(), context)).status).toBe(404)
    expect(mocks.resend).not.toHaveBeenCalled()
  })

  it('refuses workspace keys before canonical loading', async () => {
    v2RouteMocks.authenticate.mockResolvedValue({
      principal: createWorkspaceApiKeyPrincipal({ workspaceId: 'ws', keyId: 'key' }),
      keyType: 'workspace',
      rateLimitSubjectIds: ['key:key'],
      rateLimitSubscription: null,
    })
    expect((await POST(request(), context)).status).toBe(403)
    expect(mockGetInvitationById).not.toHaveBeenCalled()
  })

  it('rechecks the organization credential restriction', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disablePersonalApiKeys: true,
    })
    expect((await POST(request(), context)).status).toBe(403)
    expect(mocks.resend).not.toHaveBeenCalled()
  })

  it('dispatches MCP through the same route and schema', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    const result = await dispatchMcpOperation(
      { operation: 'resendOrganizationInvitation', params },
      {
        inbound: request(),
        credential: { apiKey: 'key', bearer: null },
        audience: { resource: 'https://mcp.sim.test/mcp', allowUnboundApiTokens: true },
        signal: new AbortController().signal,
      }
    )
    expect(result.isError).not.toBe(true)
    const content = result.content[0]
    if (content.type !== 'text') throw new Error('Expected JSON tool output')
    expect(JSON.parse(content.text)).toMatchObject({ data: { id: 'invite' } })
    expect(content.text).not.toContain('SECRET')
  })
})
