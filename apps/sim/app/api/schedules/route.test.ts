/**
 * Tests for schedule GET API route
 *
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGetUserEntityPermissions, mockDbSelect } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockDbSelect: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  workflow: { id: 'id', userId: 'userId', workspaceId: 'workspaceId' },
  workflowSchedule: {
    workflowId: 'workflowId',
    blockId: 'blockId',
    deploymentVersionId: 'deploymentVersionId',
  },
  workflowDeploymentVersion: {
    id: 'id',
    workflowId: 'workflowId',
    isActive: 'isActive',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  isNull: vi.fn(),
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: () => 'test-request-id',
}))

vi.mock('@sim/logger', () => loggerMock)

import { GET } from '@/app/api/schedules/route'

function createRequest(url: string): NextRequest {
  return new NextRequest(new URL(url), { method: 'GET' })
}

function mockDbChain(results: any[]) {
  let callIndex = 0
  mockDbSelect.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => results[callIndex++] || [],
      }),
      leftJoin: () => ({
        where: () => ({
          limit: () => results[callIndex++] || [],
        }),
      }),
    }),
  }))
}

describe('Schedule GET API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('read')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns schedule data for authorized user', async () => {
    mockDbChain([
      [{ userId: 'user-1', workspaceId: null }],
      [
        {
          schedule: {
            id: 'sched-1',
            cronExpression: '0 9 * * *',
            status: 'active',
            failedCount: 0,
          },
        },
      ],
    ])

    const res = await GET(createRequest('http://test/api/schedules?workflowId=wf-1'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.schedule.cronExpression).toBe('0 9 * * *')
    expect(data.isDisabled).toBe(false)
  })

  it('returns null when no schedule exists', async () => {
    mockDbChain([[{ userId: 'user-1', workspaceId: null }], []])

    const res = await GET(createRequest('http://test/api/schedules?workflowId=wf-1'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.schedule).toBeNull()
  })

  it('requires authentication', async () => {
    mockGetSession.mockResolvedValue(null)

    const res = await GET(createRequest('http://test/api/schedules?workflowId=wf-1'))

    expect(res.status).toBe(401)
  })

  it('requires workflowId parameter', async () => {
    const res = await GET(createRequest('http://test/api/schedules'))

    expect(res.status).toBe(400)
  })

  it('returns 404 for non-existent workflow', async () => {
    mockDbChain([[]])

    const res = await GET(createRequest('http://test/api/schedules?workflowId=wf-1'))

    expect(res.status).toBe(404)
  })

  it('denies access for unauthorized user', async () => {
    mockDbChain([[{ userId: 'other-user', workspaceId: null }]])

    const res = await GET(createRequest('http://test/api/schedules?workflowId=wf-1'))

    expect(res.status).toBe(403)
  })

  it('allows workspace members to view', async () => {
    mockDbChain([
      [{ userId: 'other-user', workspaceId: 'ws-1' }],
      [{ schedule: { id: 'sched-1', status: 'active', failedCount: 0 } }],
    ])

    const res = await GET(createRequest('http://test/api/schedules?workflowId=wf-1'))

    expect(res.status).toBe(200)
  })

  it('indicates disabled schedule with failures', async () => {
    mockDbChain([
      [{ userId: 'user-1', workspaceId: null }],
      [{ schedule: { id: 'sched-1', status: 'disabled', failedCount: 100 } }],
    ])

    const res = await GET(createRequest('http://test/api/schedules?workflowId=wf-1'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.isDisabled).toBe(true)
    expect(data.hasFailures).toBe(true)
  })
})
