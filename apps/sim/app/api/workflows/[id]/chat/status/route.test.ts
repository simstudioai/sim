/**
 * Tests for workflow chat status route auth and access.
 *
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  hybridAuthMockFns,
  resetDbChainMock,
  workflowAuthzMockFns,
  workflowsUtilsMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  eq: vi.fn(),
  isNull: vi.fn((field: unknown) => ({ type: 'isNull', field })),
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

import { GET } from '@/app/api/workflows/[id]/chat/status/route'

describe('Workflow Chat Status Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({ success: false })

    const req = new NextRequest('http://localhost:3000/api/workflows/wf-1/chat/status')
    const response = await GET(req, { params: Promise.resolve({ id: 'wf-1' }) })

    expect(response.status).toBe(401)
  })

  it('returns 403 when user lacks workspace access', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 403,
      message: 'Access denied',
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
      workspacePermission: null,
    })

    const req = new NextRequest('http://localhost:3000/api/workflows/wf-1/chat/status')
    const response = await GET(req, { params: Promise.resolve({ id: 'wf-1' }) })

    expect(response.status).toBe(403)
  })

  it('returns deployment details when authorized', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
      workspacePermission: 'read',
    })
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'chat-1',
        identifier: 'assistant',
        title: 'Support Bot',
        description: 'desc',
        customizations: { theme: 'dark' },
        authType: 'public',
        allowedEmails: [],
        outputConfigs: [{ blockId: 'agent-1', path: 'content' }],
        password: 'secret',
        isActive: true,
      },
    ])

    const req = new NextRequest('http://localhost:3000/api/workflows/wf-1/chat/status')
    const response = await GET(req, { params: Promise.resolve({ id: 'wf-1' }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.isDeployed).toBe(true)
    expect(data.deployment.id).toBe('chat-1')
    expect(data.deployment.hasPassword).toBe(true)
    expect(data.deployment.outputConfigs).toEqual([{ blockId: 'agent-1', path: 'content' }])
  })
})
