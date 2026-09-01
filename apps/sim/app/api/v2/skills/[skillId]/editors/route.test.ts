/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
  capture: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))
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

import { DELETE, GET, POST } from '@/app/api/v2/skills/[skillId]/editors/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const SKILL_ID = 'skill-1'
const PRINCIPAL = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' }
const AUTH = {
  principal: PRINCIPAL,
  rateLimitSubjectIds: ['user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}
const context = { params: Promise.resolve({ skillId: SKILL_ID }) }
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
    vi.clearAllMocks()
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

  it('allows a workspace key to list the editor roster', async () => {
    const principal = {
      kind: 'workspace_api_key' as const,
      workspaceId: WORKSPACE_ID,
      keyId: 'workspace-key-1',
    }
    v2RouteMocks.authenticate.mockResolvedValueOnce({
      ...AUTH,
      principal,
      keyType: 'workspace' as const,
    })

    const response = await GET(request('GET'), context)

    expect(response.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ principal }))
  })

  it('mints a cursor for the next editor page', async () => {
    mocks.list.mockResolvedValueOnce({
      editors: [editor],
      hasMore: true,
      offset: 0,
      limit: 1,
    })

    const response = await GET(request('GET'), context)

    expect(response.status).toBe(200)
    expect(typeof (await response.json()).nextCursor).toBe('string')
  })

  it('creates an editor grant by email and returns 201', async () => {
    const response = await POST(
      request('POST', { workspaceId: WORKSPACE_ID, email: editor.userEmail }),
      context
    )

    expect(response.status).toBe(201)
    expect(mocks.grant).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          skillId: SKILL_ID,
          workspaceId: WORKSPACE_ID,
          target: { kind: 'email', email: editor.userEmail },
        },
      })
    )
    expect(mocks.capture).toHaveBeenCalledOnce()
  })

  it('returns 200 for an idempotent existing editor grant', async () => {
    mocks.grant.mockResolvedValueOnce({ editor, created: false, workspaceId: WORKSPACE_ID })

    const response = await POST(
      request('POST', { workspaceId: WORKSPACE_ID, email: editor.userEmail }),
      context
    )

    expect(response.status).toBe(200)
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('revokes an explicit editor grant by email', async () => {
    const response = await DELETE(request('DELETE'), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { email: editor.userEmail, revoked: true },
    })
    expect(mocks.revoke).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          skillId: SKILL_ID,
          workspaceId: WORKSPACE_ID,
          target: { kind: 'email', email: editor.userEmail },
        },
      })
    )
  })
})
