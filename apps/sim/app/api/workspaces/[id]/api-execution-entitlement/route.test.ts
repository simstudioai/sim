/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGetUserEntityPermissions, mockIsWorkspaceApiExecutionEntitled } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockGetUserEntityPermissions: vi.fn(),
    mockIsWorkspaceApiExecutionEntitled: vi.fn(),
  }))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/billing/core/api-access', () => ({
  isWorkspaceApiExecutionEntitled: mockIsWorkspaceApiExecutionEntitled,
}))

import { GET } from '@/app/api/workspaces/[id]/api-execution-entitlement/route'

const WORKSPACE_ID = 'ws-1'

function buildParams() {
  return { params: Promise.resolve({ id: WORKSPACE_ID }) }
}

async function callGet() {
  const request = createMockRequest('GET')
  const response = await GET(request, buildParams())
  return { status: response.status, body: await response.json() }
}

describe('GET /api/workspaces/[id]/api-execution-entitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'u-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockIsWorkspaceApiExecutionEntitled.mockResolvedValue(true)
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const { status } = await callGet()
    expect(status).toBe(401)
    expect(mockIsWorkspaceApiExecutionEntitled).not.toHaveBeenCalled()
  })

  it('returns 404 when the caller has no workspace access', async () => {
    mockGetUserEntityPermissions.mockResolvedValue(null)
    const { status } = await callGet()
    expect(status).toBe(404)
    expect(mockIsWorkspaceApiExecutionEntitled).not.toHaveBeenCalled()
  })

  it('returns entitled: true for an entitled workspace', async () => {
    mockIsWorkspaceApiExecutionEntitled.mockResolvedValue(true)
    const { status, body } = await callGet()
    expect(status).toBe(200)
    expect(body).toEqual({ entitled: true })
    expect(mockIsWorkspaceApiExecutionEntitled).toHaveBeenCalledWith(WORKSPACE_ID)
  })

  it('returns entitled: false for a free workspace with the gate active', async () => {
    mockIsWorkspaceApiExecutionEntitled.mockResolvedValue(false)
    const { status, body } = await callGet()
    expect(status).toBe(200)
    expect(body).toEqual({ entitled: false })
  })
})
