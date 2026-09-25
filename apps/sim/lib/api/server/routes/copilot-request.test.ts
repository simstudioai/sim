import {
  MockV2ApiKeyUnauthenticatedError,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const policy = vi.hoisted(() => ({ permission: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@sim/platform-authz/workspace', () => ({
  resolveEffectiveWorkspacePermission: policy.permission,
  permissionSatisfies: (actual: string | null) =>
    actual === 'read' || actual === 'write' || actual === 'admin',
}))
vi.mock('@/lib/core/network/config.server', () => ({ isOutboundRoutingEnabled: () => false }))

import { defineRouteContract } from '@/lib/api/contracts'
import { markCopilotRequest } from '@/lib/api/server/routes/copilot-request'
import {
  admitOptionalV2Request,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes/v2-json-route'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'

const operation = defineWorkspaceOperation({
  id: 'widgets.read',
  capability: 'none',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['personal_api_key', 'delegated'],
  delegatedServices: ['copilot'],
})
const useCase = defineAuthorizedWorkspaceUseCase({
  operation,
  resolveContext: ({ input }: { input: { workspaceId: string } }) => ({
    workspaceId: input.workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: false,
  }),
  authorizationOptions: { delegation: { audience: 'sim:widgets', isWithinScope: () => true } },
  execute: async ({ principal }) => {
    policy.execute(principal)
    return { ok: true }
  },
})
const contract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/widgets',
  query: z.object({ workspaceId: z.string() }),
  response: { mode: 'json', schema: z.object({ ok: z.boolean() }) },
})
const handler = defineV2JsonRoute({
  contract,
  operation,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  useCase,
  mapInput: ({ query }) => query,
  present: (result) => result,
})
function request(workspaceId = 'target', privateCall = true) {
  const req = new NextRequest(`http://localhost/api/v2/widgets?workspaceId=${workspaceId}`, {
    headers: { 'x-api-key': 'opaque', 'x-mothership-workspace-id': 'target' },
  })
  if (privateCall)
    markCopilotRequest(req, { userId: 'actor', workspaceId: 'target', chatId: 'owned-chat' })
  return req
}
beforeEach(() => {
  policy.permission.mockResolvedValue('write')
  v2RouteMocks.authenticate.mockResolvedValue({
    principal: { kind: 'personal_api_key', userId: 'actor', keyId: 'key' },
    keyType: 'personal',
    keyExpiresAt: null,
    rateLimitSubjectIds: ['key'],
    rateLimitSubscription: null,
  })
  v2RouteMocks.preauthRate.mockResolvedValue({
    allowed: true,
    remaining: 99,
    resetAt: new Date(Date.now() + 60000),
  })
  v2RouteMocks.operationRate.mockResolvedValue({
    allowed: true,
    remaining: 99,
    resetAt: new Date(Date.now() + 60000),
  })
})
describe('private Copilot route admission', () => {
  it('uses declared audience/current role when personal keys are disabled', async () => {
    const response = await withWorkspaceInvocationScope({ workspaceId: 'target' }, () =>
      handler(request())
    )
    expect(response.status).toBe(200)
    expect(policy.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'actor',
        workspaceId: 'target',
        audience: 'sim:widgets',
        resourceScope: { chatId: 'owned-chat' },
      })
    )
    expect(v2RouteMocks.authenticate).not.toHaveBeenCalled()
    expect(policy.permission).toHaveBeenCalled()
  })
  it('admits private optional-auth routes before public IP limits without bypassing public admission', async () => {
    v2RouteMocks.preauthRate.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60000),
      retryAfterMs: 60000,
    })
    const admission = await admitOptionalV2Request(
      request(),
      operation,
      v2ApiKeyAuth,
      v2RateLimits.publicApi,
      useCase
    )
    expect(admission).toMatchObject({
      success: true,
      auth: { principal: { kind: 'delegated', workspaceId: 'target', subjectUserId: 'actor' } },
    })
    expect(v2RouteMocks.preauthRate).not.toHaveBeenCalled()
    expect(v2RouteMocks.authenticate).not.toHaveBeenCalled()
    const publicAdmission = await admitOptionalV2Request(
      request('target', false),
      operation,
      v2ApiKeyAuth,
      v2RateLimits.publicApi,
      useCase
    )
    expect(publicAdmission.success).toBe(false)
    if (!publicAdmission.success) expect(publicAdmission.response.status).toBe(429)
    expect(v2RouteMocks.authenticate).not.toHaveBeenCalled()
  })
  it('does not downgrade an unsupported private optional route to anonymous access', async () => {
    const admission = await admitOptionalV2Request(
      request(),
      operation,
      v2ApiKeyAuth,
      v2RateLimits.publicApi
    )
    expect(admission.success).toBe(false)
    if (!admission.success) expect(admission.response.status).toBe(403)
    expect(v2RouteMocks.preauthRate).not.toHaveBeenCalled()
    expect(v2RouteMocks.authenticate).not.toHaveBeenCalled()
  })
  it('preserves public personal-key policy', async () => {
    expect((await handler(request('target', false))).status).toBe(403)
    expect(v2RouteMocks.authenticate).toHaveBeenCalledOnce()
    expect(policy.execute).not.toHaveBeenCalled()
  })
  it('does not trust model-controlled headers', async () => {
    v2RouteMocks.authenticate.mockRejectedValue(new MockV2ApiKeyUnauthenticatedError())
    expect((await handler(request('target', false))).status).toBe(401)
    expect(policy.execute).not.toHaveBeenCalled()
  })
  it('rechecks revocation and canonical foreign-resource scope', async () => {
    policy.permission.mockResolvedValue(null)
    expect((await handler(request())).status).toBe(403)
    policy.permission.mockResolvedValue('write')
    expect(
      (
        await withWorkspaceInvocationScope({ workspaceId: 'target' }, () =>
          handler(request('foreign'))
        )
      ).status
    ).toBe(404)
    expect(policy.execute).not.toHaveBeenCalled()
  })
  it('refuses use cases without delegation metadata', async () => {
    const unscoped = defineV2JsonRoute({
      contract,
      operation,
      auth: v2ApiKeyAuth,
      rateLimit: v2RateLimits.publicApi,
      errorPolicy: v2OrchestrationErrorPolicy,
      useCase: {
        operation,
        execute: async () => {
          throw new Error('must not execute')
        },
      },
      mapInput: ({ query }) => query,
      present: (result) => result,
    })
    expect((await unscoped(request())).status).toBe(403)
    expect(v2RouteMocks.authenticate).not.toHaveBeenCalled()
  })
})
