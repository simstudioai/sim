/**
 * @vitest-environment node
 *
 * The Secrets tab reads and writes workspace environment variables through this
 * route, which is raw `withRouteHandler` and never reaches the `secrets.*`
 * operations — so the authorization funnel that applies `secrets.manage` to
 * those operations does not see it. These pin the gate the route now carries on
 * all three handlers: the read that would hand back every stored value, and the
 * write and the delete that would change them.
 */
import {
  authMockFns,
  createMockRequest,
  environmentUtilsMockFns,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetPermissionGroupScopeMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetWorkspaceById,
  mockGetUserEntityPermissions,
  mockGetWorkspaceEnvKeyAdminAccess,
  mockGetPersonalEnvKeyRawAccess,
} = vi.hoisted(() => ({
  mockGetWorkspaceById: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceEnvKeyAdminAccess: vi.fn(),
  mockGetPersonalEnvKeyRawAccess: vi.fn(),
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceById: mockGetWorkspaceById,
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/credentials/environment', () => ({
  getWorkspaceEnvKeyAdminAccess: mockGetWorkspaceEnvKeyAdminAccess,
  getPersonalEnvKeyRawAccess: mockGetPersonalEnvKeyRawAccess,
  createWorkspaceEnvCredentials: vi.fn(),
  deleteWorkspaceEnvCredentials: vi.fn(),
}))

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { DELETE, GET, PUT } from '@/app/api/workspaces/[id]/environment/route'

const USER_ID = 'user-1'
const WORKSPACE_ID = 'ws-1'

const mockGetSession = authMockFns.mockGetSession
const mockGetPersonalAndWorkspaceEnv = environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv

function params() {
  return { params: Promise.resolve({ id: WORKSPACE_ID }) }
}

function readEnvironment() {
  return GET(createMockRequest('GET'), params())
}

function writeEnvironment() {
  return PUT(createMockRequest('PUT', { variables: { OPENAI_API_KEY: 'sk-rotated' } }), params())
}

function deleteEnvironment() {
  return DELETE(createMockRequest('DELETE', { keys: ['OPENAI_API_KEY'] }), params())
}

/** The sentence and detail code every capability refusal in the app uses. */
const SECRETS_REFUSAL = {
  error: "Managing secrets is not available under your organization's permission group",
  details: { code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' },
}

describe('secrets.manage gate on the raw workspace environment route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPermissionGroupScopeMock()
    mockGetSession.mockResolvedValue({ user: { id: USER_ID } })
    mockGetWorkspaceById.mockResolvedValue({ id: WORKSPACE_ID })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockGetPersonalAndWorkspaceEnv.mockResolvedValue({
      workspaceDecrypted: { OPENAI_API_KEY: 'sk-secret' },
      personalDecrypted: {},
      personalOwners: {},
      conflicts: [],
      workspaceUnredactedKeys: [],
    })
    mockGetPersonalEnvKeyRawAccess.mockResolvedValue({
      ownedKeys: new Set<string>(),
      adminKeys: new Set<string>(),
    })
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set(['OPENAI_API_KEY']),
      knownKeys: new Set(['OPENAI_API_KEY']),
    })
  })

  describe('when the group withholds Secrets', () => {
    beforeEach(() => {
      permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        hideSecretsTab: true,
      })
    })

    it('refuses the read, and never decrypts a single value', async () => {
      const response = await readEnvironment()

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual(SECRETS_REFUSAL)
      expect(mockGetPersonalAndWorkspaceEnv).not.toHaveBeenCalled()
    })

    it('refuses the write, and never reaches the secret-admin check', async () => {
      const response = await writeEnvironment()

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual(SECRETS_REFUSAL)
      expect(mockGetWorkspaceEnvKeyAdminAccess).not.toHaveBeenCalled()
    })

    it('refuses the delete, and never reaches the secret-admin check', async () => {
      const response = await deleteEnvironment()

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual(SECRETS_REFUSAL)
      expect(mockGetWorkspaceEnvKeyAdminAccess).not.toHaveBeenCalled()
    })

    /**
     * Concealment: the role check runs first, so someone outside the workspace
     * gets the same answer they always did rather than being told how the
     * organization's permission group is configured.
     */
    it('still conceals a workspace the caller has no role in, rather than naming the capability', async () => {
      mockGetUserEntityPermissions.mockResolvedValue(null)

      const response = await readEnvironment()

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'Unauthorized' })
    })

    it('still 404s a workspace that does not exist, rather than naming the capability', async () => {
      mockGetWorkspaceById.mockResolvedValue(null)

      const response = await readEnvironment()

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Workspace not found' })
    })
  })

  describe('when no group governs the caller', () => {
    it('lets the read through', async () => {
      const response = await readEnvironment()

      expect(response.status).toBe(200)
      expect(mockGetPersonalAndWorkspaceEnv).toHaveBeenCalledTimes(1)
    })

    it('lets the write through to the secret-admin check', async () => {
      await writeEnvironment()

      expect(mockGetWorkspaceEnvKeyAdminAccess).toHaveBeenCalledTimes(1)
    })

    it('lets the delete through to the secret-admin check', async () => {
      await deleteEnvironment()

      expect(mockGetWorkspaceEnvKeyAdminAccess).toHaveBeenCalledTimes(1)
    })
  })

  describe('when a group governs the caller but permits Secrets', () => {
    beforeEach(() => {
      permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        hideIntegrationsTab: true,
      })
    })

    it('lets the read through', async () => {
      const response = await readEnvironment()

      expect(response.status).toBe(200)
      expect(mockGetPersonalAndWorkspaceEnv).toHaveBeenCalledTimes(1)
    })

    it('lets the write through to the secret-admin check', async () => {
      await writeEnvironment()

      expect(mockGetWorkspaceEnvKeyAdminAccess).toHaveBeenCalledTimes(1)
    })
  })
})
