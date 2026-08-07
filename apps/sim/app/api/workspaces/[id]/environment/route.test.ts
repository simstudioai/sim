/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest, environmentUtilsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetPersonalEnvKeyRawAccess,
  mockGetWorkspaceById,
  mockGetUserEntityPermissions,
  mockGetWorkspaceEnvKeyAdminAccess,
  mockAuthorizeVisibility,
  mockApplyVisibility,
  mockCreateWorkspaceEnvCredentials,
  MockVisibilityAccessError,
} = vi.hoisted(() => ({
  mockGetPersonalEnvKeyRawAccess: vi.fn(),
  mockGetWorkspaceById: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceEnvKeyAdminAccess: vi.fn(),
  mockAuthorizeVisibility: vi.fn(),
  mockApplyVisibility: vi.fn(),
  mockCreateWorkspaceEnvCredentials: vi.fn(),
  // Declared inside vi.hoisted: `vi.mock` factories hoist above module-scope
  // class declarations, so a plain `class` here is in its TDZ when the factory
  // runs and the mock module fails to initialize.
  MockVisibilityAccessError: class extends Error {
    keys: string[]
    constructor(keys: string[]) {
      super('You must be an admin of these secrets to change their visibility')
      this.name = 'WorkspaceEnvVisibilityAccessError'
      this.keys = keys
    }
  },
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceById: mockGetWorkspaceById,
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

const mockGetPersonalAndWorkspaceEnv = environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv

vi.mock('@/lib/credentials/environment', () => ({
  getPersonalEnvKeyRawAccess: mockGetPersonalEnvKeyRawAccess,
  getWorkspaceEnvKeyAdminAccess: mockGetWorkspaceEnvKeyAdminAccess,
  createWorkspaceEnvCredentials: mockCreateWorkspaceEnvCredentials,
  deleteWorkspaceEnvCredentials: vi.fn(),
  authorizeWorkspaceEnvVisibilityChange: mockAuthorizeVisibility,
  applyWorkspaceEnvVisibilityChange: mockApplyVisibility,
  WorkspaceEnvVisibilityAccessError: MockVisibilityAccessError,
}))

import { GET, PUT } from '@/app/api/workspaces/[id]/environment/route'

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
      personalDecrypted: { PERSONAL: 'personal-secret', SHARED_PERSONAL: 'shared-secret' },
      personalOwners: { PERSONAL: 'u-1', SHARED_PERSONAL: 'owner-2' },
      conflicts: [],
      workspaceVariableKeys: [],
    })
    mockGetPersonalEnvKeyRawAccess.mockResolvedValue({
      ownedKeys: new Set(['PERSONAL']),
      adminKeys: new Set<string>(),
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
      variableKeys: new Set<string>(),
    })

    const { status, body } = await callGet()

    expect(status).toBe(200)
    expect(Object.keys(body.data.workspace).sort()).toEqual(['DATABASE_URL', 'OPENAI_API_KEY'])
    expect(body.data.workspace.OPENAI_API_KEY).toBe('')
    expect(body.data.workspace.DATABASE_URL).toBe('')
  })

  it('reveals a non-secret value to a read-only member while still masking secrets', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set(['OPENAI_API_KEY', 'DATABASE_URL']),
      variableKeys: new Set(['DATABASE_URL']),
    })

    const { status, body } = await callGet()

    expect(status).toBe(200)
    // Both halves asserted together: a test that only checked the variable would
    // still pass if the exemption accidentally widened to every key.
    expect(body.data.workspace.DATABASE_URL).toBe('postgres://secret')
    expect(body.data.workspace.OPENAI_API_KEY).toBe('')
    expect(body.data.visibility).toEqual({
      OPENAI_API_KEY: 'secret',
      DATABASE_URL: 'variable',
    })
  })

  it('reports every key as a secret when nothing is marked non-secret', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set(['OPENAI_API_KEY', 'DATABASE_URL']),
      variableKeys: new Set<string>(),
    })

    const { body } = await callGet()

    expect(body.data.visibility).toEqual({
      OPENAI_API_KEY: 'secret',
      DATABASE_URL: 'secret',
    })
  })

  it('reveals only the workspace values the caller is a credential admin of', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set(['OPENAI_API_KEY']),
      knownKeys: new Set(['OPENAI_API_KEY', 'DATABASE_URL']),
      variableKeys: new Set<string>(),
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
      variableKeys: new Set<string>(),
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
      variableKeys: new Set<string>(),
    })

    const { body } = await callGet()

    expect(body.data.workspace.OPENAI_API_KEY).toBe('')
    expect(body.data.workspace.DATABASE_URL).toBe('')
  })

  it('reveals own personal values and masks shared personal values without an admin grant', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set(['OPENAI_API_KEY', 'DATABASE_URL']),
      variableKeys: new Set<string>(),
    })

    const { body } = await callGet()

    expect(body.data.personal).toEqual({ PERSONAL: 'personal-secret', SHARED_PERSONAL: '' })
  })

  it('reveals shared personal values to an active credential admin', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set(['OPENAI_API_KEY', 'DATABASE_URL']),
      variableKeys: new Set<string>(),
    })
    mockGetPersonalEnvKeyRawAccess.mockResolvedValue({
      ownedKeys: new Set(['PERSONAL']),
      adminKeys: new Set(['SHARED_PERSONAL']),
    })

    const { body } = await callGet()

    expect(body.data.personal).toEqual({
      PERSONAL: 'personal-secret',
      SHARED_PERSONAL: 'shared-secret',
    })
  })
})

describe('PUT /api/workspaces/[id]/environment — visibility ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'u-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set<string>(),
      variableKeys: new Set<string>(),
    })
    mockApplyVisibility.mockResolvedValue({ changedKeys: [] })
  })

  async function callPut(body: unknown) {
    const request = createMockRequest('PUT', body)
    const response = await PUT(request, buildParams())
    return { status: response.status, body: await response.json() }
  }

  /**
   * The ordering defect Greptile caught. A request mixing an allowed NEW key
   * with an unauthorized visibility flip used to commit the key and its
   * credential rows and only THEN return 403 — a rejected call that changed
   * workspace state and skipped its audit record.
   */
  it('writes nothing when a visibility change is denied', async () => {
    mockAuthorizeVisibility.mockRejectedValue(new MockVisibilityAccessError(['STRIPE_KEY']))

    const { status } = await callPut({
      variables: { BRAND_NEW: 'v' },
      visibility: { STRIPE_KEY: 'variable' },
    })

    expect(status).toBe(403)
    // The whole point: authorization ran before any write reached the database.
    expect(mockCreateWorkspaceEnvCredentials).not.toHaveBeenCalled()
    expect(mockApplyVisibility).not.toHaveBeenCalled()
  })

  it('authorizes before applying on the success path', async () => {
    mockAuthorizeVisibility.mockResolvedValue([
      { credentialId: 'c-1', envKey: 'SUPPORT_EMAIL', next: 'variable' },
    ])
    mockApplyVisibility.mockResolvedValue({ changedKeys: ['SUPPORT_EMAIL'] })

    const { status } = await callPut({
      variables: {},
      visibility: { SUPPORT_EMAIL: 'variable' },
    })

    expect(status).toBe(200)
    expect(mockAuthorizeVisibility).toHaveBeenCalled()
    expect(mockApplyVisibility).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: [{ credentialId: 'c-1', envKey: 'SUPPORT_EMAIL', next: 'variable' }],
      })
    )
  })
})
