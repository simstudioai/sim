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
  getWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  listMembers: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

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

vi.mock('@/lib/workspaces/application/list-public-workspaces', () => ({
  listPublicWorkspaces: {
    operation: { id: 'workspaces.list_public' },
    execute: mocks.listWorkspaces,
  },
}))

import { REFILTERED_CURSOR_MESSAGE, UNREADABLE_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET as listMembers } from '@/app/api/v2/workspaces/[workspaceId]/members/route'
import { GET as getWorkspace } from '@/app/api/v2/workspaces/[workspaceId]/route'
import { GET as listWorkspaces } from '@/app/api/v2/workspaces/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
  },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const OTHER_WORKSPACE_ID = 'b1c1a2f5-1f4b-4a2e-9a2f-1d0a5f1c9e77'
const context = (workspaceId: string = WORKSPACE_ID) => ({
  params: Promise.resolve({ workspaceId }),
})

function requestMembers(workspaceId: string, query = '') {
  return listMembers(
    new NextRequest(`http://localhost:3000/api/v2/workspaces/${workspaceId}/members${query}`),
    context(workspaceId)
  )
}

/**
 * A cursor as the route itself mints it, rather than a payload hand-built by
 * the test. The binding a cursor carries is the route's to compute, so a test
 * that reconstructed it would pass against a route that stopped applying one.
 */
async function mintMemberCursor(workspaceId: string): Promise<string> {
  const { nextCursor } = await (await requestMembers(workspaceId, '?limit=1')).json()
  expect(typeof nextCursor).toBe('string')
  return nextCursor
}

/** The payload inside a minted cursor's binding envelope. */
function innerPayload(cursor: string): unknown {
  const { inner } = JSON.parse(Buffer.from(cursor, 'base64').toString())
  return JSON.parse(Buffer.from(inner, 'base64').toString())
}

describe('v2 workspace routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
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
    mocks.listWorkspaces.mockResolvedValue({
      workspaces: [
        {
          id: WORKSPACE_ID,
          name: 'Engineering',
          color: '#33C482',
          logoUrl: null,
          memberCount: 1,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-02T00:00:00Z'),
        },
      ],
      hasMore: false,
      offset: 0,
      limit: 50,
    })
  })

  it('lists the workspaces available to the API key', async () => {
    const request = new NextRequest('http://localhost:3000/api/v2/workspaces')
    const response = await listWorkspaces(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          id: WORKSPACE_ID,
          name: 'Engineering',
          color: '#33C482',
          logoUrl: null,
          memberCount: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })
    expect(mocks.listWorkspaces).toHaveBeenCalledWith({
      principal: auth.principal,
      input: {
        sortBy: 'createdAt',
        sortOrder: 'desc',
        limit: 50,
        offset: 0,
      },
      request,
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
    expect(innerPayload(body.nextCursor)).toEqual({ email: 'ada@example.com' })
  })

  it('rejects malformed cursors before the application read', async () => {
    const response = await requestMembers(WORKSPACE_ID, '?cursor=not-a-cursor')

    expect(response.status).toBe(400)
    expect(mocks.listMembers).not.toHaveBeenCalled()
    expect((await response.json()).error.message).toBe(UNREADABLE_CURSOR_MESSAGE)
  })

  /**
   * The regression guard for the cursor's binding: the roster still pages
   * through its OWN cursor. A token no route accepts binds nothing — it just
   * breaks pagination.
   */
  it('resumes from the cursor it minted', async () => {
    const cursor = await mintMemberCursor(WORKSPACE_ID)
    mocks.listMembers.mockClear()

    const response = await requestMembers(WORKSPACE_ID, `?cursor=${encodeURIComponent(cursor)}`)

    expect(response.status).toBe(200)
    expect(mocks.listMembers).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ afterEmail: 'ada@example.com' }) })
    )
  })

  /**
   * The same person is a member of every workspace they belong to, so an
   * unbound email token from one roster decoded cleanly against another and
   * resumed from a position that silently skipped members.
   */
  it('refuses a members cursor minted on another workspace', async () => {
    const cursor = await mintMemberCursor(WORKSPACE_ID)
    mocks.listMembers.mockClear()

    const response = await requestMembers(
      OTHER_WORKSPACE_ID,
      `?cursor=${encodeURIComponent(cursor)}`
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
    expect(mocks.listMembers).not.toHaveBeenCalled()
  })

  it('mints a members cursor bound to the workspace that answered', async () => {
    expect(await mintMemberCursor(WORKSPACE_ID)).not.toBe(
      await mintMemberCursor(OTHER_WORKSPACE_ID)
    )
  })

  it.each([
    ['non-email', { email: 'not-an-email' }],
    ['carrying an unknown key', { email: 'ada@example.com', role: 'admin' }],
    ['missing its key', {}],
  ])('rejects a members cursor forged inside a valid binding %s', async (_case, payload) => {
    const { scope } = JSON.parse(
      Buffer.from(await mintMemberCursor(WORKSPACE_ID), 'base64').toString()
    )
    const inner = Buffer.from(JSON.stringify(payload)).toString('base64')
    const cursor = Buffer.from(JSON.stringify({ scope, inner })).toString('base64')
    mocks.listMembers.mockClear()

    const response = await requestMembers(WORKSPACE_ID, `?cursor=${encodeURIComponent(cursor)}`)

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
