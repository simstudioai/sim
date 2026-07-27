/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest, workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkflowReferences } = vi.hoisted(() => ({
  mockGetWorkflowReferences: vi.fn(),
}))

const mockAuthorizeWorkflow = workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission

vi.mock('@/lib/workflows/references/operations', () => ({
  getWorkflowReferences: mockGetWorkflowReferences,
}))

import { GET } from '@/app/api/workflows/[id]/references/route'

const mockGetSession = authMockFns.mockGetSession

const REFERENCES = {
  callers: [{ id: 'b', name: 'B', cycle: false, children: [] }],
  callees: [],
}

function callRoute(id = 'wf-1') {
  const url = `http://localhost:3000/api/workflows/${id}/references`
  return GET(createMockRequest('GET', undefined, {}, url), { params: Promise.resolve({ id }) })
}

describe('GET /api/workflows/[id]/references', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAuthorizeWorkflow.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
      workspacePermission: 'read',
    })
    mockGetWorkflowReferences.mockResolvedValue(REFERENCES)
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)
    const response = await callRoute()
    expect(response.status).toBe(401)
    expect(mockGetWorkflowReferences).not.toHaveBeenCalled()
  })

  it('returns 404 when the workflow does not exist', async () => {
    mockAuthorizeWorkflow.mockResolvedValue({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: null,
      workspacePermission: null,
    })
    const response = await callRoute()
    expect(response.status).toBe(404)
    expect(mockGetWorkflowReferences).not.toHaveBeenCalled()
  })

  it('returns 403 when the user cannot read the workflow', async () => {
    mockAuthorizeWorkflow.mockResolvedValue({
      allowed: false,
      status: 403,
      message: 'Unauthorized: Access denied to read this workflow',
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
      workspacePermission: null,
    })
    const response = await callRoute()
    expect(response.status).toBe(403)
    expect(mockGetWorkflowReferences).not.toHaveBeenCalled()
  })

  it('returns the reference trees scoped to the workflow workspace', async () => {
    const response = await callRoute()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(REFERENCES)
    expect(mockAuthorizeWorkflow).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      userId: 'user-1',
      action: 'read',
    })
    expect(mockGetWorkflowReferences).toHaveBeenCalledWith('ws-1', 'wf-1')
  })
})
