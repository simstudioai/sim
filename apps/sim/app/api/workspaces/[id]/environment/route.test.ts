/**
 * Tests for the workspace environment API route.
 *
 * @vitest-environment node
 */
import { authMock, authMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPersonalAndWorkspaceEnv } = vi.hoisted(() => ({
  mockGetPersonalAndWorkspaceEnv: vi.fn(),
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/environment/utils', () => ({
  getPersonalAndWorkspaceEnv: mockGetPersonalAndWorkspaceEnv,
  invalidateEffectiveDecryptedEnvCache: vi.fn(),
}))

import { GET } from '@/app/api/workspaces/[id]/environment/route'

const WORKSPACE_ID = 'ws-1'

function createRequest() {
  return new NextRequest(`http://localhost/api/workspaces/${WORKSPACE_ID}/environment`)
}

function createContext() {
  return { params: Promise.resolve({ id: WORKSPACE_ID }) }
}

const ENV_RESULT = {
  personalEncrypted: {},
  workspaceEncrypted: { OPENAI_API_KEY: 'enc-1', DATABASE_URL: 'enc-2' },
  personalDecrypted: { MY_PERSONAL: 'personal-value' },
  workspaceDecrypted: {
    OPENAI_API_KEY: 'sk-live-secret-value',
    DATABASE_URL: 'postgres://user:password@db/prod',
  },
  conflicts: [],
  decryptionFailures: [],
}

describe('GET /api/workspaces/[id]/environment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    permissionsMockFns.mockGetWorkspaceById.mockResolvedValue({ id: WORKSPACE_ID })
    mockGetPersonalAndWorkspaceEnv.mockResolvedValue(ENV_RESULT)
  })

  it('returns decrypted workspace values to workspace admins', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')

    const res = await GET(createRequest(), createContext())
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.workspace).toEqual(ENV_RESULT.workspaceDecrypted)
    expect(body.data.personal).toEqual(ENV_RESULT.personalDecrypted)
  })

  it.each(['write', 'read'] as const)(
    'returns only variable names (empty values) to %s members',
    async (permission) => {
      permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue(permission)

      const res = await GET(createRequest(), createContext())
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.data.workspace).toEqual({ OPENAI_API_KEY: '', DATABASE_URL: '' })
      // Plaintext workspace secrets must never reach non-admins.
      expect(JSON.stringify(body.data.workspace)).not.toContain('sk-live-secret-value')
      expect(JSON.stringify(body.data.workspace)).not.toContain('postgres://')
      // The caller's own personal values are still returned.
      expect(body.data.personal).toEqual(ENV_RESULT.personalDecrypted)
    }
  )

  it('rejects users without any workspace permission', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue(null)

    const res = await GET(createRequest(), createContext())
    expect(res.status).toBe(401)
    expect(mockGetPersonalAndWorkspaceEnv).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated requests', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const res = await GET(createRequest(), createContext())
    expect(res.status).toBe(401)
  })
})
