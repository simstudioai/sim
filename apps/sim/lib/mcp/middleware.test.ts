/**
 * @vitest-environment node
 *
 * The gate lives on the middleware, so this is where it is proved. Thirteen raw
 * MCP management routes sit behind `withMcpAuth` and only the workflow-server
 * create handler ever grew a capability check of its own; asserting per route
 * would have reproduced exactly that, so these assertions are about the wrapper
 * every one of them shares.
 */
import { permissionGroupScopeMock, permissionGroupScopeMockFns } from '@sim/testing'
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  permissions: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', async () => {
  const AuthType = { SESSION: 'session', API_KEY: 'api_key', INTERNAL_JWT: 'internal_jwt' } as const
  return {
    AuthType,
    checkSessionOrInternalAuth: mocks.auth,
    capabilityGovernedAuthUserId: (auth: {
      userId?: string
      authType?: string
      apiKeyType?: string
    }) => {
      if (!auth?.userId) return null
      if (auth.authType === AuthType.SESSION) return auth.userId
      return auth.authType === AuthType.API_KEY && auth.apiKeyType === 'personal'
        ? auth.userId
        : null
    },
  }
})
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mocks.permissions,
}))
vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import { withMcpAuth } from '@/lib/mcp/middleware'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

const handler = vi.fn(async () => Response.json({ ok: true }) as never)

function request() {
  return new Request('http://localhost:3000/api/mcp/anything?workspaceId=workspace-1', {
    method: 'POST',
  }) as NextRequest
}

function call(capability: 'deploy.mcp' | 'mcp_tools.use' | 'none') {
  return withMcpAuth('write', capability)(handler)(request(), {
    params: Promise.resolve({}),
  })
}

describe('withMcpAuth permission-group gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mocks.permissions.mockResolvedValue('admin')
    resolveGroupConfigMock.mockResolvedValue(null)
  })

  it('refuses a session caller whose group withholds the declared capability', async () => {
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideDeployMcp: true,
    })

    const response = await call('deploy.mcp')

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: "MCP server deployment is not available under your organization's permission group",
    })
    expect(handler).not.toHaveBeenCalled()
  })

  /**
   * The two capabilities are separate keys, so a group withholding one must not
   * refuse a route declaring the other — that would make the gate a blanket MCP
   * switch rather than the two doors `mcpServerOperations` describes.
   */
  it('admits a route whose declared capability the group does not withhold', async () => {
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideDeployMcp: true,
    })

    const response = await call('mcp_tools.use')

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalled()
  })

  it('admits a caller no permission group governs', async () => {
    const response = await call('deploy.mcp')

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalled()
  })

  /**
   * The executor exemption. An internal JWT's `userId` is the subject the
   * executor embedded, so resolving it would hand the run actor's grants to a
   * credential that bears no person — the same rule
   * `capabilityGovernedAuthUserId` states for every other surface.
   */
  it('passes a non-user-bearing internal JWT ungated', async () => {
    mocks.auth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideDeployMcp: true,
    })

    const response = await call('deploy.mcp')

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalled()
    expect(resolveGroupConfigMock).not.toHaveBeenCalled()
  })

  it('resolves no group at all for a route declaring no capability', async () => {
    const response = await call('none')

    expect(response.status).toBe(200)
    expect(resolveGroupConfigMock).not.toHaveBeenCalled()
  })

  /**
   * A capability refusal handed to a non-member would confirm the workspace
   * exists and name which modules the organization withholds; the role failure
   * conceals both, so it has to come first.
   */
  it('answers the role failure, not the capability refusal, for a non-member', async () => {
    mocks.permissions.mockResolvedValue(null)
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideDeployMcp: true,
    })

    const response = await call('deploy.mcp')

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Insufficient permissions',
    })
    expect(resolveGroupConfigMock).not.toHaveBeenCalled()
  })
})
