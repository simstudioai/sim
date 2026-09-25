/**
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
import { createRouteContext } from '@sim/testing/helpers/http'
import {
  credentialsEnvironmentMock,
  credentialsEnvironmentMockFns,
} from '@sim/testing/mocks/credentials-environment.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/credentials/environment', () => credentialsEnvironmentMock)

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { GET, PUT } from '@/app/api/workspaces/[id]/environment/route'

const { mockGetWorkspaceEnvKeyAdminAccess, mockGetPersonalEnvKeyRawAccess } =
  credentialsEnvironmentMockFns

const USER_ID = 'user-1'
const WORKSPACE_ID = 'ws-1'

const mockGetSession = authMockFns.mockGetSession
const { mockGetWorkspaceById, mockGetUserEntityPermissions } = permissionsMockFns
const mockGetPersonalAndWorkspaceEnv = environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv

function params() {
  return createRouteContext({ id: WORKSPACE_ID })
}

function readEnvironment() {
  return GET(createMockRequest('GET'), params())
}

function writeEnvironment() {
  return PUT(createMockRequest('PUT', { variables: { OPENAI_API_KEY: 'sk-rotated' } }), params())
}

/** The sentence and detail code every capability refusal in the app uses. */
const SECRETS_REFUSAL = {
  error: "Managing secrets is not available under your organization's permission group",
  details: { code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' },
}

describe('secrets.manage gate on the raw workspace environment route', () => {
  beforeEach(() => {
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
  })
})
