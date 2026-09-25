import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { v1RateLimitContextModuleMock } from '@sim/testing/mocks/v1-route.mock'
import {
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing/mocks/v2-route.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/api/server/rate-limit-context', () => v1RateLimitContextModuleMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/skills/application/use-cases', () => ({
  getSkillUseCase: { operation: { id: 'skills.read' }, execute: mocks.get },
  updateSkillUseCase: { operation: { id: 'skills.update' }, execute: mocks.update },
  deleteSkillUseCase: { operation: { id: 'skills.delete' }, execute: mocks.remove },
}))

import { GET, PATCH } from '@/app/api/v2/skills/[skillId]/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = createPersonalApiKeyPrincipal({ keyId: 'key-personal' })
const AUTH = {
  principal: PRINCIPAL,
  rateLimitSubjectIds: ['user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}
const RATE_LIMIT_OK = {
  allowed: true,
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-01-01T00:00:00Z'),
  retryAfterMs: 0,
}
const skill = {
  id: 'skill-1',
  workspaceId: WORKSPACE_ID,
  userId: 'user-1',
  name: 'refund-policy',
  description: 'How to handle refunds',
  content: '# Refund policy',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}
const context = createRouteContext({ skillId: skill.id })

/**
 * The read and delete verbs scope themselves with `?workspaceId=`; the write
 * verb carries `workspaceId` in its body. Sending the query copy on a write is
 * now a 400 rather than a silently dropped key, so the helper only appends it
 * where the contract declares it.
 */
function request(method: 'GET' | 'PATCH' | 'DELETE', body?: unknown) {
  const query = method === 'PATCH' ? '' : `?workspaceId=${WORKSPACE_ID}`
  return createMockRequest({
    method,
    url: `http://localhost:3000/api/v2/skills/${skill.id}${query}`,
    headers: { 'x-api-key': 'key' },
    body,
  })
}

describe('/api/v2/skills/[skillId]', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    v2RouteMocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.get.mockResolvedValue({ skill })
    mocks.update.mockResolvedValue({ skill })
    mocks.remove.mockResolvedValue({ skill })
  })

  it('conceals cross-tenant access while preserving same-workspace role denials', async () => {
    mocks.get.mockRejectedValueOnce(new NoWorkspaceAccessError())
    expect((await GET(request('GET'), context)).status).toBe(404)

    mocks.update.mockRejectedValueOnce(new InsufficientWorkspacePermissionsError())
    expect(
      (await PATCH(request('PATCH', { workspaceId: WORKSPACE_ID, content: '# Updated' }), context))
        .status
    ).toBe(403)
  })
})
