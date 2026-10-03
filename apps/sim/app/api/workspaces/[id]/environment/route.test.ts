import { authMockFns, createMockRequest, environmentUtilsMockFns } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import {
  credentialsEnvironmentMock,
  credentialsEnvironmentMockFns,
} from '@sim/testing/mocks/credentials-environment.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

const mockGetPersonalAndWorkspaceEnv = environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv

vi.mock('@/lib/credentials/environment', () => credentialsEnvironmentMock)

import { GET } from '@/app/api/workspaces/[id]/environment/route'

const { mockGetWorkspaceEnvKeyAdminAccess, mockGetPersonalEnvKeyRawAccess } =
  credentialsEnvironmentMockFns

const mockGetSession = authMockFns.mockGetSession
const { mockGetWorkspaceById, mockGetUserEntityPermissions } = permissionsMockFns

const WORKSPACE_ID = 'ws-1'

function buildParams() {
  return createRouteContext({ id: WORKSPACE_ID })
}

async function callGet() {
  const request = createMockRequest('GET')
  const response = await GET(request, buildParams())
  return { status: response.status, body: await response.json() }
}

describe('GET /api/workspaces/[id]/environment', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue({ user: { id: 'u-1' } })
    mockGetWorkspaceById.mockResolvedValue({ id: WORKSPACE_ID })
    mockGetPersonalAndWorkspaceEnv.mockResolvedValue({
      workspaceDecrypted: { OPENAI_API_KEY: 'sk-secret', DATABASE_URL: 'postgres://secret' },
      personalDecrypted: { PERSONAL: 'personal-secret', SHARED_PERSONAL: 'shared-secret' },
      personalOwners: { PERSONAL: 'u-1', SHARED_PERSONAL: 'owner-2' },
      conflicts: [],
      workspaceUnredactedKeys: [],
    })
    mockGetPersonalEnvKeyRawAccess.mockResolvedValue({
      ownedKeys: new Set(['PERSONAL']),
      adminKeys: new Set<string>(),
    })
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

  it('reveals an unredacted workspace value to a read-only credential member', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set(['OPENAI_API_KEY', 'DATABASE_URL']),
    })
    mockGetPersonalAndWorkspaceEnv.mockResolvedValue({
      workspaceDecrypted: { OPENAI_API_KEY: 'sk-secret', DATABASE_URL: 'postgres://secret' },
      personalDecrypted: {},
      personalOwners: {},
      conflicts: [],
      workspaceUnredactedKeys: ['OPENAI_API_KEY'],
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

  it('reveals own personal values and masks shared personal values without an admin grant', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockGetWorkspaceEnvKeyAdminAccess.mockResolvedValue({
      adminKeys: new Set<string>(),
      knownKeys: new Set(['OPENAI_API_KEY', 'DATABASE_URL']),
    })

    const { body } = await callGet()

    expect(body.data.personal).toEqual({ PERSONAL: 'personal-secret', SHARED_PERSONAL: '' })
  })
})
