/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest, environmentUtilsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkspaceById, mockGetUserEntityPermissions, mockGetWorkspaceEnvKeyAdminAccess } =
  vi.hoisted(() => ({
    mockGetWorkspaceById: vi.fn(),
    mockGetUserEntityPermissions: vi.fn(),
    mockGetWorkspaceEnvKeyAdminAccess: vi.fn(),
  }))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceById: mockGetWorkspaceById,
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

const mockGetPersonalAndWorkspaceEnv = environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv

vi.mock('@/lib/credentials/environment', () => ({
  getWorkspaceEnvKeyAdminAccess: mockGetWorkspaceEnvKeyAdminAccess,
  createWorkspaceEnvCredentials: vi.fn(),
  deleteWorkspaceEnvCredentials: vi.fn(),
}))

import { GET } from '@/app/api/workspaces/[id]/environment/route'

const mockGetSession = authMockFns.mockGetSession

const WORKSPACE_ID = 'ws-1'

function buildParams() {
  return { params: Promise.resolve({ id: WORKSPACE_ID }) }
}

async function callGet() {
  const request = createMockRequest('GET')
  const response = await GET(request, buildParams())
  return { status: response.status, body: await response.json() }
}

describe('GET /api/workspaces/[id]/environment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'u-1' } })
    mockGetWorkspaceById.mockResolvedValue({ id: WORKSPACE_ID })
    mockGetPersonalAndWorkspaceEnv.mockResolvedValue({
      workspaceDecrypted: { OPENAI_API_KEY: 'sk-secret', DATABASE_URL: 'postgres://secret' },
      personalDecrypted: { PERSONAL: { value: 'p' } },
      conflicts: [],
    })
  })

  it('returns 401 when the caller has no workspace permission', async () => {
    mockGetUserEntityPermissions.mockResolvedValue(null)

    const { status, body } = await callGet()

    expect(status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(mockGetPersonalAndWorkspaceEnv).not.toHaveBeenCalled()
  })

  it('masks workspace secret values for a read-only member', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set(['OPENAI_API_KEY', 'DATABASE_URL']),
    })

    const { status, body } = await callGet()

    expect(status).toBe(200)
    expect(Object.keys(body.data.workspace).sort()).toEqual(['DATABASE_URL', 'OPENAI_API_KEY'])
    expect(body.data.workspace.OPENAI_API_KEY).toBe('')
    expect(body.data.workspace.DATABASE_URL).toBe('')
  })

  it('reveals only the workspace values the caller is a credential admin of', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set(['OPENAI_API_KEY']),
      knownKeys: new Set(['OPENAI_API_KEY', 'DATABASE_URL']),
    })

    const { body } = await callGet()

    expect(body.data.workspace.OPENAI_API_KEY).toBe('sk-secret')
    expect(body.data.workspace.DATABASE_URL).toBe('')
  })

  it('reveals legacy keys (no per-secret ACL) only to workspace admins', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set<string>(),
    })

    const { body } = await callGet()

    expect(body.data.workspace.OPENAI_API_KEY).toBe('sk-secret')
    expect(body.data.workspace.DATABASE_URL).toBe('postgres://secret')
  })

  it('does not reveal legacy keys to a non-admin member', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set<string>(),
    })

    const { body } = await callGet()

    expect(body.data.workspace.OPENAI_API_KEY).toBe('')
    expect(body.data.workspace.DATABASE_URL).toBe('')
  })

  it('always returns personal values untouched', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set(['OPENAI_API_KEY', 'DATABASE_URL']),
    })

    const { body } = await callGet()

    expect(body.data.personal).toEqual({ PERSONAL: { value: 'p' } })
  })
})
