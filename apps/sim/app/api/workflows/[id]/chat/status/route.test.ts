/**
 * Tests for workflow chat status route auth and access.
 *
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCheckSessionOrInternalAuth = vi.fn()
const mockAuthorizeWorkflowByWorkspacePermission = vi.fn()
const mockDbSelect = vi.fn()
const mockDbFrom = vi.fn()
const mockDbWhere = vi.fn()
const mockDbLimit = vi.fn()

describe('Workflow Chat Status Route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockDbSelect.mockReturnValue({ from: mockDbFrom })
    mockDbFrom.mockReturnValue({ where: mockDbWhere })
    mockDbWhere.mockReturnValue({ limit: mockDbLimit })
    mockDbLimit.mockResolvedValue([])

    vi.doMock('@sim/logger', () => loggerMock)
    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn(),
    }))
    vi.doMock('@sim/db', () => ({
      db: {
        select: mockDbSelect,
      },
    }))
    vi.doMock('@sim/db/schema', () => ({
      chat: {
        id: 'id',
        identifier: 'identifier',
        title: 'title',
        description: 'description',
        customizations: 'customizations',
        authType: 'authType',
        allowedEmails: 'allowedEmails',
        outputConfigs: 'outputConfigs',
        password: 'password',
        isActive: 'isActive',
        workflowId: 'workflowId',
      },
    }))
    vi.doMock('@/lib/auth/hybrid', () => ({
      checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
    }))
    vi.doMock('@/lib/workflows/utils', () => ({
      authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({ success: false })

    const { GET } = await import('./route')
    const req = new NextRequest('http://localhost:3000/api/workflows/wf-1/chat/status')
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

    const { GET } = await import('./route')
    const req = new NextRequest('http://localhost:3000/api/workflows/wf-1/chat/status')
    const response = await GET(req, { params: Promise.resolve({ id: 'wf-1' }) })

    expect(response.status).toBe(403)
  })

  it('returns deployment details when authorized', async () => {
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
        id: 'chat-1',
        identifier: 'assistant',
        title: 'Support Bot',
        description: 'desc',
        customizations: { theme: 'dark' },
        authType: 'public',
        allowedEmails: [],
        outputConfigs: {},
        password: 'secret',
        isActive: true,
      },
    ])

    const { GET } = await import('./route')
    const req = new NextRequest('http://localhost:3000/api/workflows/wf-1/chat/status')
    const response = await GET(req, { params: Promise.resolve({ id: 'wf-1' }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.isDeployed).toBe(true)
    expect(data.deployment.id).toBe('chat-1')
    expect(data.deployment.hasPassword).toBe(true)
  })
})
