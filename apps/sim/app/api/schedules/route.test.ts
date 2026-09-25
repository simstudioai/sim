/**
 * Tests for schedule GET API route
 */
import { authMockFns, databaseMock, workflowAuthzMockFns, workflowsUtilsMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

import { GET } from '@/app/api/schedules/route'

function createRequest(url: string): NextRequest {
  return new NextRequest(new URL(url), { method: 'GET' })
}

const mockDbSelect = databaseMock.db.select as ReturnType<typeof vi.fn>

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
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
      workspacePermission: 'read',
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('denies access for unauthorized user', async () => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: false,
      status: 403,
      message: 'Unauthorized: Access denied to read this workflow',
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
      workspacePermission: null,
    })
    mockDbChain([[{ userId: 'other-user', workspaceId: null }]])

    const res = await GET(createRequest('http://test/api/schedules?workflowId=wf-1'))

    expect(res.status).toBe(403)
  })
})
