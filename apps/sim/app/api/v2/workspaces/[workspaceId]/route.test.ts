/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  listMembers: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/workspaces/application/get-public-workspace', () => ({
  getPublicWorkspace: {
    operation: { id: 'workspaces.read_public_detail' },
    execute: mocks.getWorkspace,
  },
}))

vi.mock('@/lib/workspaces/application/list-public-workspace-members', () => ({
  listPublicWorkspaceMembers: {
    operation: { id: 'workspaces.members.list_public' },
    execute: mocks.listMembers,
  },
}))

import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET as listMembers } from '@/app/api/v2/workspaces/[workspaceId]/members/route'
import { GET as getWorkspace } from '@/app/api/v2/workspaces/[workspaceId]/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
  },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

/**
 * The two reads a workspace id is addressable through. Both must conceal the
 * same way, or the pair that still answers `403` is the oracle.
 */
const routes = [
  {
    name: 'workspace detail',
    spy: mocks.getWorkspace,
    call: () =>
      getWorkspace(new NextRequest(`http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}`), {
        params: Promise.resolve({ workspaceId: WORKSPACE_ID }),
      }),
  },
  {
    name: 'member roster',
    spy: mocks.listMembers,
    call: () =>
      listMembers(
        new NextRequest(`http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}/members`),
        { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) }
      ),
  },
] as const

describe.each(routes)('v2 $name workspace concealment', ({ spy, call }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  })

  /**
   * Asserted as equality between the two responses rather than against a
   * literal: the leak is the DIFFERENCE, so a future rewording of either leg
   * must not be able to reintroduce it while the test still passes.
   */
  it.each([
    ['a workspace key scoped elsewhere', () => new WorkspaceApiKeyScopeAuthorizationError()],
    ['a non-member personal key', () => new NoWorkspaceAccessError()],
  ])('answers an unreachable workspace exactly as an absent one for %s', async (_label, raise) => {
    spy.mockRejectedValueOnce(new OrchestrationError('not_found', 'Workspace not found'))
    const absent = await call()
    const absentBody = await absent.json()

    spy.mockRejectedValueOnce(raise())
    const unreachable = await call()

    expect(unreachable.status).toBe(absent.status)
    expect(await unreachable.json()).toEqual(absentBody)
    expect(absent.status).toBe(404)
    expect(absentBody).toEqual({
      error: { code: 'NOT_FOUND', message: 'Workspace not found' },
    })
  })

  /**
   * The negative leg. A caller already inside the workspace knows it exists, so
   * a role refusal stays an actionable `403` — concealing it too would widen the
   * policy past what it is for.
   */
  it('still refuses an in-workspace role denial with 403', async () => {
    spy.mockRejectedValueOnce(new InsufficientWorkspacePermissionsError())

    const response = await call()

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })
})
