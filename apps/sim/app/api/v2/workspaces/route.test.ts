/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  listMembers: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/workspaces/application/get-public-workspace', () => ({
  getPublicWorkspace: {
    operation: { id: 'workspaces.read_public_detail' },
    execute: mocks.getWorkspace,
  },
}))

vi.mock('@/lib/workspaces/application/list-public-workspace-members', () => ({
  listPublicWorkspaceMembers: {
    operation: { id: 'workspaces.members.list_public' },
    execute: mocks.listMembers,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET as listMembers } from '@/app/api/v2/workspaces/[workspaceId]/members/route'
import { GET as getWorkspace } from '@/app/api/v2/workspaces/[workspaceId]/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
  },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const context = () => ({ params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })

describe('v2 workspace routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.getWorkspace.mockResolvedValue({
      workspace: {
        id: WORKSPACE_ID,
        name: 'Engineering',
        color: '#33C482',
        logoUrl: null,
        memberCount: 1,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      },
    })
    mocks.listMembers.mockResolvedValue({
      page: {
        members: [
          {
            userId: 'user-1',
            email: 'ada@example.com',
            name: 'Ada',
            image: null,
            role: 'admin',
            isExternal: false,
            joinedAt: new Date('2026-01-01T00:00:00Z'),
          },
        ],
        nextEmail: 'ada@example.com',
      },
    })
  })

  it('projects public workspace metadata without governance identities', async () => {
    const request = new NextRequest(`http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}`)
    const response = await getWorkspace(request, context())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({ id: WORKSPACE_ID, name: 'Engineering' })
    expect(body.data).not.toHaveProperty('mode')
    expect(body.data).not.toHaveProperty('ownerId')
    expect(body.data).not.toHaveProperty('billedAccountUserId')
    expect(mocks.getWorkspace).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { workspaceId: WORKSPACE_ID },
      request,
    })
  })

  it('keeps member user IDs out of data and cursors', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}/members?limit=1`
    )
    const response = await listMembers(request, context())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data[0]).toEqual({
      email: 'ada@example.com',
      name: 'Ada',
      image: null,
      role: 'admin',
      isExternal: false,
      joinedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(JSON.parse(Buffer.from(body.nextCursor, 'base64').toString())).toEqual({
      email: 'ada@example.com',
    })
  })

  it('rejects malformed cursors before the application read', async () => {
    const response = await listMembers(
      new NextRequest(
        `http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}/members?cursor=not-a-cursor`
      ),
      context()
    )

    expect(response.status).toBe(400)
    expect(mocks.listMembers).not.toHaveBeenCalled()
  })

  it('projects typed workspace policy errors', async () => {
    mocks.getWorkspace.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Access denied'))

    const response = await getWorkspace(
      new NextRequest(`http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}`),
      context()
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })
})
