/** @vitest-environment node */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/permission-groups/application/read-user-config', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/permission-groups/application/read-user-config')
  >()),
  readUserPermissionConfig: {
    operation: { id: 'permission_groups.read_user_config' },
    execute: mocks.read,
  },
}))

import { NoWorkspaceAccessError, WorkspaceApiKeyAuthorizationError } from '@/lib/core/application'
import { GET } from '@/app/api/v2/workspaces/[workspaceId]/permission-config/route'

const workspaceId = 'workspace-123'
const principal = { kind: 'personal_api_key', userId: 'caller', keyId: 'key' } as const
const result = {
  permissionGroupId: null,
  groupName: null,
  config: null,
  entitled: false,
  organizationId: 'organization-123',
  isOrgAdmin: false,
}
const call = (query = '') =>
  GET(
    new NextRequest(`http://localhost/api/v2/workspaces/${workspaceId}/permission-config${query}`),
    { params: Promise.resolve({ workspaceId }) }
  )

beforeEach(() => {
  vi.clearAllMocks()
  v2RouteMocks.authenticate.mockResolvedValue({
    principal,
    keyType: 'personal',
    rateLimitSubjectIds: ['user:caller'],
    rateLimitSubscription: null,
  })
  v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
  v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  mocks.read.mockResolvedValue(result)
})

describe('effective caller permission configuration public adapter', () => {
  it('returns the shared configuration without inventing a workspace role', async () => {
    const response = await call()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: result })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({ principal, input: { workspaceId } })
    )
  })

  it.each([
    '?userId=other-user',
    '?organizationId=other-organization',
    '?workspaceId=other-workspace',
  ])('rejects an asserted target outside its caller-only contract: %s', async (query) => {
    expect((await call(query)).status).toBe(400)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('conceals inaccessible workspace policy', async () => {
    mocks.read.mockRejectedValue(new NoWorkspaceAccessError())
    const response = await call()
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Workspace not found' },
    })
  })

  it('uses the shared workspace-key refusal code', async () => {
    mocks.read.mockRejectedValue(new WorkspaceApiKeyAuthorizationError())
    const response = await call()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: 'FORBIDDEN', details: { code: 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED' } },
    })
  })
})
