import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/skills/application/use-cases', () => ({
  listSkillEditorsUseCase: {
    operation: { id: 'skills.editors.list' },
    execute: mocks.list,
  },
  grantSkillEditorUseCase: {
    operation: { id: 'skills.editors.grant' },
    execute: mocks.grant,
  },
  revokeSkillEditorUseCase: {
    operation: { id: 'skills.editors.revoke' },
    execute: mocks.revoke,
  },
}))

import { GET, POST } from '@/app/api/v2/skills/[skillId]/editors/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const SKILL_ID = 'skill-1'
const PRINCIPAL = createPersonalApiKeyPrincipal()
const AUTH = {
  principal: PRINCIPAL,
  rateLimitSubjectIds: ['user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}
const context = createRouteContext({ skillId: SKILL_ID })
const editor = {
  id: 'membership-1',
  userId: 'user-2',
  userName: 'Ada',
  userEmail: 'ada@example.com',
  userImage: null,
  isWorkspaceAdmin: false,
}

function request(method: 'GET' | 'POST' | 'DELETE', body?: unknown) {
  const query =
    method === 'GET'
      ? `?workspaceId=${WORKSPACE_ID}`
      : method === 'DELETE'
        ? `?workspaceId=${WORKSPACE_ID}&email=${encodeURIComponent(editor.userEmail)}`
        : ''
  return new NextRequest(`http://localhost:3000/api/v2/skills/${SKILL_ID}/editors${query}`, {
    method,
    headers: {
      'x-api-key': 'key',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('/api/v2/skills/[skillId]/editors', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.list.mockResolvedValue({
      editors: [editor],
      hasMore: false,
      offset: 0,
      limit: 50,
    })
    mocks.grant.mockResolvedValue({ editor, created: true, workspaceId: WORKSPACE_ID })
    mocks.revoke.mockResolvedValue({ editor, workspaceId: WORKSPACE_ID })
  })

  it('lists public editor identity fields without internal IDs', async () => {
    const response = await GET(request('GET'), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          email: editor.userEmail,
          name: editor.userName,
          image: null,
          isWorkspaceAdmin: false,
        },
      ],
      nextCursor: null,
    })
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          skillId: SKILL_ID,
          workspaceId: WORKSPACE_ID,
          sortBy: 'email',
          sortOrder: 'asc',
          limit: 50,
          offset: 0,
        }),
      })
    )
  })

  it('returns 200 for an idempotent existing editor grant', async () => {
    mocks.grant.mockResolvedValueOnce({ editor, created: false, workspaceId: WORKSPACE_ID })

    const response = await POST(
      request('POST', { workspaceId: WORKSPACE_ID, email: editor.userEmail }),
      context
    )

    expect(response.status).toBe(200)
    expect(posthogServerMockFns.mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})
