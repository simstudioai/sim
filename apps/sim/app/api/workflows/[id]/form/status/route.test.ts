/**
 * Tests for workflow form status route auth and access.
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckSessionOrInternalAuth,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockDbSelect,
  mockDbFrom,
  mockDbWhere,
  mockDbLimit,
} = vi.hoisted(() => ({
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbFrom: vi.fn(),
  mockDbWhere: vi.fn(),
  mockDbLimit: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  form: {
    id: 'id',
    identifier: 'identifier',
    title: 'title',
    workflowId: 'workflowId',
    isActive: 'isActive',
  },
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/workflows/utils', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

import { GET } from '@/app/api/workflows/[id]/form/status/route'

describe('Workflow Form Status Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockDbSelect.mockReturnValue({ from: mockDbFrom })
    mockDbFrom.mockReturnValue({ where: mockDbWhere })
    mockDbWhere.mockReturnValue({ limit: mockDbLimit })
    mockDbLimit.mockResolvedValue([])
  })

  it('returns 401 when unauthenticated', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({ success: false })

    const req = new NextRequest('http://localhost:3000/api/workflows/wf-1/form/status')
    const response = await GET(req, { params: Promise.resolve({ id: 'wf-1' }) })

    expect(response.status).toBe(401)
  })

  it('returns 403 when user lacks workspace access', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 403,
      message: 'Access denied',
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
      workspacePermission: null,
    })

    const req = new NextRequest('http://localhost:3000/api/workflows/wf-1/form/status')
    const response = await GET(req, { params: Promise.resolve({ id: 'wf-1' }) })

    expect(response.status).toBe(403)
  })

  it('returns deployed form when authorized', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
      workspacePermission: 'read',
    })
    mockDbLimit.mockResolvedValueOnce([
      {
        id: 'form-1',
        identifier: 'feedback-form',
        title: 'Feedback',
        isActive: true,
      },
    ])

    const req = new NextRequest('http://localhost:3000/api/workflows/wf-1/form/status')
    const response = await GET(req, { params: Promise.resolve({ id: 'wf-1' }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.isDeployed).toBe(true)
    expect(data.form.id).toBe('form-1')
  })
})
