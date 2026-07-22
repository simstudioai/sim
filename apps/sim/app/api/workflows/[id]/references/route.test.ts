/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGetUserEntityPermissions, mockGetWorkflowReferences } = vi.hoisted(
  () => ({
    mockGetSession: vi.fn(),
    mockGetUserEntityPermissions: vi.fn(),
    mockGetWorkflowReferences: vi.fn(),
  })
)

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/workflows/references/operations', () => ({
  getWorkflowReferences: mockGetWorkflowReferences,
}))

import { GET } from '@/app/api/workflows/[id]/references/route'

const REFERENCES = {
  callers: [{ id: 'b', name: 'B', cycle: false, children: [] }],
  callees: [],
}

function callRoute(id = 'wf-1', workspaceId: string | null = 'ws-1') {
  const url = workspaceId
    ? `http://localhost:3000/api/workflows/${id}/references?workspaceId=${workspaceId}`
    : `http://localhost:3000/api/workflows/${id}/references`
  return GET(createMockRequest('GET', undefined, {}, url), { params: Promise.resolve({ id }) })
}

describe('GET /api/workflows/[id]/references', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockGetWorkflowReferences.mockResolvedValue(REFERENCES)
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)
    const response = await callRoute()
    expect(response.status).toBe(401)
    expect(mockGetWorkflowReferences).not.toHaveBeenCalled()
  })

  it('returns 400 without a workspaceId', async () => {
    const response = await callRoute('wf-1', null)
    expect(response.status).toBe(400)
  })

  it('returns 403 when the user cannot access the workspace', async () => {
    mockGetUserEntityPermissions.mockResolvedValue(null)
    const response = await callRoute()
    expect(response.status).toBe(403)
    expect(mockGetWorkflowReferences).not.toHaveBeenCalled()
  })

  it('returns the reference trees for the workflow', async () => {
    const response = await callRoute()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(REFERENCES)
    expect(mockGetWorkflowReferences).toHaveBeenCalledWith('ws-1', 'wf-1')
  })
})
