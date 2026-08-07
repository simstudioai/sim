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
  mockSetVisibility,
  mockCreateWorkspaceEnvCredentials,
  mockRecordAudit,
  MockVisibilityAccessError,
} = vi.hoisted(() => ({
  mockGetPersonalEnvKeyRawAccess: vi.fn(),
  mockGetWorkspaceById: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceEnvKeyAdminAccess: vi.fn(),
  mockSetVisibility: vi.fn(),
  mockCreateWorkspaceEnvCredentials: vi.fn(),
  mockRecordAudit: vi.fn(),
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

vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: vi.fn(async (value: string) => ({ encrypted: `enc:${value}` })),
}))

vi.mock('@sim/audit', () => ({
  recordAudit: mockRecordAudit,
  AuditAction: { ENVIRONMENT_UPDATED: 'environment.updated' },
  AuditResourceType: { ENVIRONMENT: 'environment' },
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
  setWorkspaceEnvVisibility: mockSetVisibility,
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
    mockSetVisibility.mockResolvedValue({ changedKeys: [] })
  })

  async function callPut(body: unknown) {
    const request = createMockRequest('PUT', body)
    const response = await PUT(request, buildParams())
    return { status: response.status, body: await response.json() }
  }

  /**
   * A rejected request must change nothing. The value upsert, the credential
   * rows, and the visibility flip all run in ONE transaction now, so a denial
   * anywhere throws and rolls the rest back — no ordering left to get wrong.
   */
  it('returns 403 and records no audit when a visibility change is denied', async () => {
    mockSetVisibility.mockRejectedValue(new MockVisibilityAccessError(['STRIPE_KEY']))

    const { status, body } = await callPut({
      variables: { BRAND_NEW: 'v' },
      visibility: { STRIPE_KEY: 'variable' },
    })

    expect(status).toBe(403)
    expect(body.error).toContain('admin')
    // The audit record lives after the transaction, so a rejected request
    // cannot reach it — which is the observable proof nothing was committed.
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  /**
   * Both writes must be transaction-scoped. If either call moves back outside
   * the transaction it loses its `executor` and a denial in the other would
   * strand it committed — the exact failure this consolidation removed.
   */
  it('runs the credential inserts and the visibility flip inside the transaction', async () => {
    mockSetVisibility.mockResolvedValue({ changedKeys: ['SUPPORT_EMAIL'] })

    const { status } = await callPut({
      variables: { NEW_KEY: 'v' },
      visibility: { SUPPORT_EMAIL: 'variable' },
    })

    expect(status).toBe(200)
    expect(mockCreateWorkspaceEnvCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ executor: expect.anything() })
    )
    expect(mockSetVisibility).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        actingUserId: 'u-1',
        updates: { SUPPORT_EMAIL: 'variable' },
        executor: expect.anything(),
      })
    )
    // Ordering matters: the disclosure change is applied last, after the writes
    // it must not be separated from.
    expect(mockCreateWorkspaceEnvCredentials.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetVisibility.mock.invocationCallOrder[0]
    )
  })
})
