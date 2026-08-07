/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockGetPublicWorkspaceDetail,
  mockQueryPublicWorkspaceMembers,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockGetPublicWorkspaceDetail: vi.fn(),
  mockQueryPublicWorkspaceMembers: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/workspaces/public-queries', () => ({
  getPublicWorkspaceDetail: mockGetPublicWorkspaceDetail,
  queryPublicWorkspaceMembers: mockQueryPublicWorkspaceMembers,
}))

import { GET as listWorkspaceMembers } from '@/app/api/v2/workspaces/[workspaceId]/members/route'
import { GET as getWorkspace } from '@/app/api/v2/workspaces/[workspaceId]/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  workspaceId: WORKSPACE_ID,
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-08-06T01:00:00.000Z'),
}
const context = () => ({ params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })

function callWorkspace() {
  return getWorkspace(
    new NextRequest(`http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}`),
    context()
  )
}

function callMembers(query = '') {
  return listWorkspaceMembers(
    new NextRequest(`http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}/members${query}`),
    context()
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
  mockResolveWorkspaceAccess.mockResolvedValue(null)
  mockGetPublicWorkspaceDetail.mockResolvedValue({
    id: WORKSPACE_ID,
    name: 'Engineering',
    color: '#33C482',
    logoUrl: null,
    mode: 'organization',
    memberCount: 2,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  })
  mockQueryPublicWorkspaceMembers.mockResolvedValue({
    members: [
      {
        userId: 'user-1',
        email: 'ada@example.com',
        name: 'Ada',
        image: null,
        role: 'admin',
        isExternal: false,
        joinedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    nextEmail: 'ada@example.com',
  })
})

describe('GET /api/v2/workspaces/[workspaceId]', () => {
  it('returns public metadata without governance or billing identities', async () => {
    const response = await callWorkspace()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual({
      id: WORKSPACE_ID,
      name: 'Engineering',
      color: '#33C482',
      logoUrl: null,
      mode: 'organization',
      memberCount: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
    expect(body.data).not.toHaveProperty('ownerId')
    expect(body.data).not.toHaveProperty('billedAccountUserId')
  })

  it('enforces workspace read access before loading metadata', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })

    const response = await callWorkspace()

    expect(response.status).toBe(403)
    expect(mockGetPublicWorkspaceDetail).not.toHaveBeenCalled()
  })
})

describe('GET /api/v2/workspaces/[workspaceId]/members', () => {
  it('returns email-attributed members and keeps user IDs out of data and cursors', async () => {
    const response = await callMembers('?limit=1')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual([
      {
        email: 'ada@example.com',
        name: 'Ada',
        image: null,
        role: 'admin',
        isExternal: false,
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    expect(body.data[0]).not.toHaveProperty('userId')
    expect(JSON.parse(Buffer.from(body.nextCursor, 'base64').toString())).toEqual({
      email: 'ada@example.com',
    })
  })

  it('rejects malformed cursors without querying members', async () => {
    const response = await callMembers('?cursor=not-a-cursor')

    expect(response.status).toBe(400)
    expect(mockQueryPublicWorkspaceMembers).not.toHaveBeenCalled()
  })
})
