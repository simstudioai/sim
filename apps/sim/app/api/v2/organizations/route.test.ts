/** @vitest-environment node */
import { recordAudit } from '@sim/audit'
import { member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  preauth: vi.fn(),
  rate: vi.fn(),
  config: vi.fn(),
  invitation: vi.fn(),
  resend: vi.fn(),
  Unauthenticated: class extends Error {},
}))
vi.mock('@sim/audit', async (original) => ({
  ...(await original<typeof import('@sim/audit')>()),
  recordAudit: vi.fn(),
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: mocks.Unauthenticated,
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mocks.preauth
    checkRateLimitDirectOrThrow = mocks.rate
  },
  getRateLimit: () => ({ maxTokens: 100, refillRate: 100, refillIntervalMs: 60_000 }),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))
vi.mock('@/lib/invitations/core', () => ({ getInvitationById: mocks.invitation }))
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

const principal = { kind: 'personal_api_key', userId: 'actor', keyId: 'key' } as const
const params = { organizationId: 'org', invitationId: 'invite' }
const context = { params: Promise.resolve(params) }
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
  return new NextRequest('http://localhost/api/v2/organizations/org/invitations/invite/resend', {
    method: 'POST',
    headers: {
      'x-api-key': 'key',
      'content-type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.authenticate.mockResolvedValue({
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
  mocks.preauth.mockResolvedValue(admission)
  mocks.rate.mockResolvedValue(admission)
  mocks.config.mockResolvedValue(null)
  mocks.invitation.mockResolvedValue(inv)
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

  it('rejects unknown action fields before protected loading', async () => {
    expect((await POST(request({ role: 'owner' }), context)).status).toBe(400)
    expect(mocks.invitation).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it.each([
    ['member', 403],
    [null, 404],
  ] as const)('refuses org role %s', async (role, status) => {
    queueTableRows(member, role ? [{ role }] : [])
    expect((await POST(request(), context)).status).toBe(status)
    expect(mocks.resend).not.toHaveBeenCalled()
  })

  it('conceals a cross-organization invitation', async () => {
    mocks.invitation.mockResolvedValue({ ...inv, organizationId: 'another' })
    expect((await POST(request(), context)).status).toBe(404)
    expect(mocks.resend).not.toHaveBeenCalled()
  })

  it('refuses workspace keys before canonical loading', async () => {
    mocks.authenticate.mockResolvedValue({
      principal: { kind: 'workspace_api_key', workspaceId: 'ws', keyId: 'key' },
      keyType: 'workspace',
      rateLimitSubjectIds: ['key:key'],
      rateLimitSubscription: null,
    })
    expect((await POST(request(), context)).status).toBe(403)
    expect(mocks.invitation).not.toHaveBeenCalled()
  })

  it('rechecks the organization credential restriction', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.config.mockResolvedValue({
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
