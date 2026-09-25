/**
 * Pins the rate-limit headers every v1 endpoint publishes. `X-RateLimit-Limit`
 * and `X-RateLimit-Remaining` must describe the same quantity — the token
 * bucket's capacity and the tokens left in it — or a client computing
 * `used = limit - remaining` gets a negative number.
 */

import {
  createMockRequest,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetPermissionGroupScopeMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRateLimitHeaders } from '@/lib/api/server/rate-limit-context'

const {
  mockAuthenticateV1Request,
  mockGetSubscription,
  mockCheckRateLimit,
  mockGetRateLimit,
  mockGetUserEntityPermissions,
  mockGetWorkspaceBillingSettings,
  mockGetWorkspaceBilledAccountUserId,
  mockIsCapabilityWithheldForUser,
} = vi.hoisted(() => ({
  mockAuthenticateV1Request: vi.fn(),
  mockGetSubscription: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGetRateLimit: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceBillingSettings: vi.fn(),
  mockGetWorkspaceBilledAccountUserId: vi.fn(),
  mockIsCapabilityWithheldForUser: vi.fn(),
}))

vi.mock('@/app/api/v1/auth', () => ({
  authenticateV1Request: mockAuthenticateV1Request,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetSubscription,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: mockGetRateLimit,
  RateLimiter: class {
    checkRateLimitWithSubscription = mockCheckRateLimit
  },
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

vi.mock('@/lib/permission-groups/user-scope.server', () => ({
  isCapabilityWithheldForUser: mockIsCapabilityWithheldForUser,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBillingSettings: mockGetWorkspaceBillingSettings,
  getWorkspaceBilledAccountUserId: mockGetWorkspaceBilledAccountUserId,
}))

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import {
  authenticateRequest,
  checkOrganizationPersonalKeyRefusal,
  checkRateLimit,
  checkWorkspaceScope,
  createRateLimitResponse,
  requireWorkspaceRequestActor,
} from '@/app/api/v1/middleware'

/** Mirrors `createBucketConfig`: capacity is the per-minute rate x burst multiplier. */
const TEAM_BUCKET = { maxTokens: 400, refillRate: 200, refillIntervalMs: 60_000 }

function request() {
  return createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/v1/workflows')
}

describe('checkRateLimit', () => {
  beforeEach(() => {
    mockAuthenticateV1Request.mockResolvedValue({
      authenticated: true,
      userId: 'user-1',
      keyType: 'personal',
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
    })
    mockGetSubscription.mockResolvedValue({ plan: 'team' })
    mockGetRateLimit.mockReturnValue(TEAM_BUCKET)
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 399,
      resetAt: new Date('2026-07-28T18:28:48.354Z'),
    })
  })

  it('reports the bucket capacity as the limit, not the refill rate', async () => {
    const result = await checkRateLimit(request(), 'workflows')

    expect(result.limit).toBe(TEAM_BUCKET.maxTokens)
    expect(result.limit).not.toBe(TEAM_BUCKET.refillRate)
  })

  it('reports a zero limit when authentication fails, since no bucket was consulted', async () => {
    mockAuthenticateV1Request.mockResolvedValue({
      authenticated: false,
      error: 'API key required',
    })

    const result = await checkRateLimit(request(), 'workflows')

    expect(result.allowed).toBe(false)
    expect(result.limit).toBe(0)
    expect(result.error).toBe('API key required')
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })
})

describe('authenticateRequest', () => {
  beforeEach(() => {
    mockAuthenticateV1Request.mockResolvedValue({
      authenticated: true,
      keyType: 'personal',
    })
    mockGetSubscription.mockResolvedValue({ plan: 'team' })
    mockGetRateLimit.mockReturnValue(TEAM_BUCKET)
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 399,
      resetAt: new Date('2026-07-28T18:28:48.354Z'),
    })
  })

  it('fails fast when an allowed result has no user ID', async () => {
    await expect(authenticateRequest(request(), 'workflows')).rejects.toThrow(
      'Allowed public API request is missing a user ID'
    )
  })
})

describe('createRateLimitResponse', () => {
  const throttled = {
    allowed: false,
    remaining: 0,
    limit: 400,
    resetAt: new Date('2026-07-28T18:28:48.354Z'),
    retryAfterMs: 30_000,
  }

  it('publishes consistent headers on a 429', () => {
    const response = createRateLimitResponse(throttled)

    expect(response.status).toBe(429)
    const limit = Number(response.headers.get('X-RateLimit-Limit'))
    const remaining = Number(response.headers.get('X-RateLimit-Remaining'))
    expect(remaining).toBeLessThanOrEqual(limit)
    expect(response.headers.get('X-RateLimit-Reset')).toBe(throttled.resetAt.toISOString())
    expect(response.headers.get('Retry-After')).toBe('30')
  })

  it('omits rate-limit headers on an auth failure, which never reached the bucket', async () => {
    const response = createRateLimitResponse({
      allowed: false,
      remaining: 0,
      limit: 0,
      resetAt: new Date(),
      error: 'API key required',
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('X-RateLimit-Limit')).toBeNull()
    expect(response.headers.get('X-RateLimit-Remaining')).toBeNull()
    expect(response.headers.get('X-RateLimit-Reset')).toBeNull()
    await expect(response.json()).resolves.toEqual({ error: 'API key required' })
  })
})

describe('rate-limit snapshot context', () => {
  beforeEach(() => {
    mockAuthenticateV1Request.mockResolvedValue({
      authenticated: true,
      userId: 'user-1',
      keyType: 'personal',
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
    })
    mockGetSubscription.mockResolvedValue({ plan: 'team' })
    mockGetRateLimit.mockReturnValue(TEAM_BUCKET)
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 399,
      resetAt: new Date('2026-07-28T18:28:48.354Z'),
    })
  })

  it('records a snapshot as a side effect of checkRateLimit', async () => {
    const req = request()

    await checkRateLimit(req, 'workflows')

    const headers = getRateLimitHeaders(req)
    expect(headers).not.toBeNull()
    expect(headers?.['X-RateLimit-Limit']).toBe(String(TEAM_BUCKET.maxTokens))
  })
})

/**
 * The table routes authorize with `checkWorkspaceScope` and then a domain
 * helper (`checkAccess`) that runs the workspace ROLE check. `checkAccess`
 * gates the module (`tables.use`), never the key kind, so `personal_api_key.use`
 * has to be asked in the wrapper — which means the wrapper has to order itself
 * behind the role, because nothing downstream will.
 *
 * The workspace column keeps answering first: it names no group, so refusing on
 * it tells a stranger only what the workspace itself is set to.
 */
describe('checkWorkspaceScope', () => {
  const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
  const USER_ID = 'user-1'

  function personalKeyRateLimit() {
    return {
      allowed: true,
      remaining: 1,
      limit: 1,
      resetAt: new Date(),
      userId: USER_ID,
      keyType: 'personal' as const,
      principal: { kind: 'personal_api_key' as const, userId: USER_ID, keyId: 'key-1' },
    }
  }

  function withholdsPersonalKeys() {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disablePersonalApiKeys: true,
    })
  }

  beforeEach(() => {
    resetPermissionGroupScopeMock()
    mockGetWorkspaceBillingSettings.mockResolvedValue({ allowPersonalApiKeys: true })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
  })

  it('refuses a member whose group withholds personal API keys', async () => {
    withholdsPersonalKeys()

    const response = await checkWorkspaceScope(personalKeyRateLimit(), WORKSPACE_ID)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toMatchObject({
      error: expect.stringMatching(/personal API key/i),
    })
  })

  it('leaves a non-member to the downstream role check rather than naming the group', async () => {
    mockGetUserEntityPermissions.mockResolvedValue(null)
    withholdsPersonalKeys()

    const response = await checkWorkspaceScope(personalKeyRateLimit(), WORKSPACE_ID)

    expect(response).toBeNull()
    expect(permissionGroupScopeMockFns.mockResolvePermissionGroupConfig).not.toHaveBeenCalled()
  })

  it("still refuses a non-member on the workspace's own column, which names no group", async () => {
    mockGetUserEntityPermissions.mockResolvedValue(null)
    mockGetWorkspaceBillingSettings.mockResolvedValue({ allowPersonalApiKeys: false })

    const response = await checkWorkspaceScope(personalKeyRateLimit(), WORKSPACE_ID)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toMatchObject({
      error: expect.stringMatching(/personal API key/i),
    })
  })

  /**
   * The concealment ordering, one level in. The funnel asks this key only after
   * `requireCurrentHumanRole(operation.minimumRole)`, so a read-only member on a
   * write route is refused on role. Asked at `read` here, the same person was
   * told instead how their organization configured personal keys.
   */
  it('leaves a read-only member on a write route to the downstream role check', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('read')
    withholdsPersonalKeys()

    const response = await checkWorkspaceScope(personalKeyRateLimit(), WORKSPACE_ID, 'write')

    expect(response).toBeNull()
    expect(permissionGroupScopeMockFns.mockResolvePermissionGroupConfig).not.toHaveBeenCalled()
  })
})

describe('checkOrganizationPersonalKeyRefusal', () => {
  const USER_ID = 'user-1'
  const BASE = { allowed: true, remaining: 1, limit: 1, resetAt: new Date(), userId: USER_ID }

  beforeEach(() => {
    mockIsCapabilityWithheldForUser.mockResolvedValue(false)
  })

  it("refuses a personal key its user-global group withholds, with the group's detail code", async () => {
    mockIsCapabilityWithheldForUser.mockResolvedValue(true)

    const response = await checkOrganizationPersonalKeyRefusal({ ...BASE, keyType: 'personal' })

    expect(mockIsCapabilityWithheldForUser).toHaveBeenCalledWith(USER_ID, 'personal_api_key.use')
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toMatchObject({
      error: expect.stringMatching(/personal API key/i),
      details: { code: 'PERSONAL_API_KEYS_DISABLED' },
    })
  })

  it("never evaluates a workspace key against its creator's group", async () => {
    mockIsCapabilityWithheldForUser.mockResolvedValue(true)

    const response = await checkOrganizationPersonalKeyRefusal({
      ...BASE,
      keyType: 'workspace',
      workspaceId: 'workspace-a',
    })

    expect(response).toBeNull()
    expect(mockIsCapabilityWithheldForUser).not.toHaveBeenCalled()
  })
})

describe('requireWorkspaceRequestActor', () => {
  beforeEach(() => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('billed-user')
  })

  it('substitutes the billed account as the system actor for a workspace key', async () => {
    const actor = await requireWorkspaceRequestActor(
      { allowed: true, keyType: 'workspace', userId: 'key-creator' } as never,
      'workspace-1'
    )

    expect(actor).toEqual({ ok: true, actorUserId: 'billed-user' })
  })

  /**
   * An archived or deleted workspace has no billed account to stand in. That is
   * a reachable request about an unreachable workspace, not a server fault: the
   * call sites used to throw, and the routes' catch-all reported it as a 500.
   */
  it('projects an unresolvable actor onto a 400 rather than throwing', async () => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue(null)

    const actor = await requireWorkspaceRequestActor(
      { allowed: true, keyType: 'workspace', userId: 'key-creator' } as never,
      'workspace-gone'
    )

    expect(actor.ok).toBe(false)
    if (actor.ok) throw new Error('expected a refusal')
    expect(actor.response.status).toBe(400)
    await expect(actor.response.json()).resolves.toEqual({ error: 'Invalid workspace ID' })
  })
})
