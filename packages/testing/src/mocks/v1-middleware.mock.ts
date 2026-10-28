import { vi } from 'vitest'

interface MockV1RateLimit {
  allowed?: boolean
  userId?: string
  keyType?: string
  principal?: unknown
  error?: string
  limit?: number
  remaining?: number
  resetAt?: Date
  retryAfterMs?: number
}

interface MockWorkspaceAccessError {
  status: number
  message: string
  details?: unknown
}

function requireRateLimitUserId(rateLimit: MockV1RateLimit): string {
  if (!rateLimit.allowed) throw new Error('Cannot authorize a denied public API request')
  if (!rateLimit.userId) throw new Error('Allowed public API request is missing a user ID')
  return rateLimit.userId
}

function capabilityGovernedUserId(rateLimit: MockV1RateLimit): string | null {
  return rateLimit.keyType === 'personal' ? (rateLimit.userId ?? null) : null
}

function workspaceAccessErrorResponse(failure: MockWorkspaceAccessError): Response {
  return Response.json(
    failure.details
      ? { error: failure.message, details: failure.details }
      : { error: failure.message },
    { status: failure.status }
  )
}

function buildRateLimitHeaders(snapshot: {
  limit?: number
  remaining?: number
  resetAt: Date
}): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(snapshot.limit),
    'X-RateLimit-Remaining': String(snapshot.remaining),
    'X-RateLimit-Reset': snapshot.resetAt.toISOString(),
  }
}

function v1ValidationErrorResponse(error: { issues: unknown[] }, _fallback?: string): Response {
  return Response.json({ error: 'Validation error', details: error.issues }, { status: 400 })
}

const mockResolveWorkspaceRequestActor = vi.fn()

/**
 * Controllable mock functions for `@/app/api/v1/middleware`.
 *
 * Bare `vi.fn()`s (resolve `undefined`): `mockCheckRateLimit`, `mockAuthenticateRequest`,
 * `mockResolveCapabilityRefusal`, `mockResolveWorkspaceScope`, `mockResolveWorkspaceAccess`,
 * `mockCheckWorkspaceScope`, `mockCheckOrganizationPersonalKeyRefusal`,
 * `mockResolveWorkspaceRequestActor`, `mockValidateWorkspaceAccess` (`undefined` = access granted).
 *
 * Non-bare defaults (ports of the real helpers, rendered with `Response.json`):
 * - `mockRequireRateLimitUserId`, `mockCapabilityGovernedUserId` (`keyType === 'personal'`),
 *   `mockTableAccessPrincipal`, `mockRequireRateLimitPrincipal` — exact ports.
 * - `mockCreateRateLimitResponse` — `401 { error }` for an auth failure, else `429` with the real
 *   body, `X-RateLimit-*` and `Retry-After` headers (exact port).
 * - `mockConcealedWorkspaceAccessResponse` — `details` → the failure's status, else `404`.
 * - `mockRequireWorkspaceRequestActor` — delegates to `mockResolveWorkspaceRequestActor`;
 *   a falsy actor → `{ ok: false, response: 400 { error: 'Invalid workspace ID' } }`.
 * - `mockV1ValidationErrorResponse` — `400 { error: 'Validation error', details: error.issues }`
 *   (the shape local stubs agreed on; the real one reports the first issue's message and
 *   serialized issues).
 * - `mockV1ValidationErrorResponseFromError` — the above for an `Error` named `ZodError`, else `null`.
 *
 * @example
 * ```ts
 * import { v1MiddlewareMockFns } from '@sim/testing/mocks/v1-middleware.mock'
 *
 * v1MiddlewareMockFns.mockCheckRateLimit.mockResolvedValue({
 *   allowed: true, remaining: 10, resetAt: new Date(), userId: 'user-1', keyType: 'personal',
 * })
 * v1MiddlewareMockFns.mockValidateWorkspaceAccess.mockResolvedValue(null)
 * ```
 */
export const v1MiddlewareMockFns = {
  mockRequireRateLimitUserId: vi.fn(requireRateLimitUserId),
  mockCapabilityGovernedUserId: vi.fn(capabilityGovernedUserId),
  mockTableAccessPrincipal: vi.fn((rateLimit: MockV1RateLimit) => {
    const userId = requireRateLimitUserId(rateLimit)
    return capabilityGovernedUserId(rateLimit)
      ? { kind: 'user' as const, userId }
      : { kind: 'workspace_api_key' as const, keyCreatorUserId: userId }
  }),
  mockRequireRateLimitPrincipal: vi.fn((rateLimit: MockV1RateLimit): unknown => {
    if (!rateLimit.allowed) throw new Error('Cannot authorize a denied public API request')
    if (!rateLimit.principal) throw new Error('Allowed public API request is missing its Principal')
    return rateLimit.principal
  }),
  mockCheckRateLimit: vi.fn(),
  mockAuthenticateRequest: vi.fn(),
  mockCreateRateLimitResponse: vi.fn((result: MockV1RateLimit): Response => {
    if (result.error) {
      return Response.json({ error: result.error || 'Unauthorized' }, { status: 401 })
    }
    const resetAt = result.resetAt ?? new Date()
    const retryAfterSeconds = result.retryAfterMs
      ? Math.ceil(result.retryAfterMs / 1000)
      : Math.ceil((resetAt.getTime() - Date.now()) / 1000)
    return Response.json(
      {
        error: 'Rate limit exceeded',
        message: `API rate limit exceeded. Please retry after ${resetAt.toISOString()}`,
        retryAfter: resetAt.getTime(),
      },
      {
        status: 429,
        headers: {
          ...buildRateLimitHeaders({ ...result, resetAt }),
          'Retry-After': retryAfterSeconds.toString(),
        },
      }
    )
  }),
  mockResolveCapabilityRefusal: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockCheckWorkspaceScope: vi.fn(),
  mockCheckOrganizationPersonalKeyRefusal: vi.fn(),
  mockConcealedWorkspaceAccessResponse: vi.fn(
    (failure: MockWorkspaceAccessError, notFoundMessage: string): Response =>
      failure.details
        ? workspaceAccessErrorResponse(failure)
        : Response.json({ error: notFoundMessage }, { status: 404 })
  ),
  mockResolveWorkspaceRequestActor,
  mockRequireWorkspaceRequestActor: vi.fn(async (rateLimit: unknown, workspaceId: string) => {
    const actorUserId = await mockResolveWorkspaceRequestActor(rateLimit, workspaceId)
    return actorUserId
      ? { ok: true as const, actorUserId: actorUserId as string }
      : {
          ok: false as const,
          response: Response.json({ error: 'Invalid workspace ID' }, { status: 400 }),
        }
  }),
  mockValidateWorkspaceAccess: vi.fn(),
  mockV1ValidationErrorResponse: vi.fn(v1ValidationErrorResponse),
  mockV1ValidationErrorResponseFromError: vi.fn(
    (error: unknown, fallback?: string): Response | null =>
      error instanceof Error && error.name === 'ZodError' && 'issues' in error
        ? v1ValidationErrorResponse(error as Error & { issues: unknown[] }, fallback)
        : null
  ),
}

/**
 * Static mock module for `@/app/api/v1/middleware`. Covers every runtime export.
 *
 * For suites whose subject is the handler rather than admission, pair it with the pass-through
 * `v1-route.mock` modules instead of steering `checkRateLimit` per test.
 *
 * @example
 * ```ts
 * vi.mock('@/app/api/v1/middleware', () => v1MiddlewareMock)
 * ```
 */
export const v1MiddlewareMock = {
  requireRateLimitUserId: v1MiddlewareMockFns.mockRequireRateLimitUserId,
  capabilityGovernedUserId: v1MiddlewareMockFns.mockCapabilityGovernedUserId,
  tableAccessPrincipal: v1MiddlewareMockFns.mockTableAccessPrincipal,
  requireRateLimitPrincipal: v1MiddlewareMockFns.mockRequireRateLimitPrincipal,
  checkRateLimit: v1MiddlewareMockFns.mockCheckRateLimit,
  authenticateRequest: v1MiddlewareMockFns.mockAuthenticateRequest,
  createRateLimitResponse: v1MiddlewareMockFns.mockCreateRateLimitResponse,
  resolveCapabilityRefusal: v1MiddlewareMockFns.mockResolveCapabilityRefusal,
  resolveWorkspaceScope: v1MiddlewareMockFns.mockResolveWorkspaceScope,
  resolveWorkspaceAccess: v1MiddlewareMockFns.mockResolveWorkspaceAccess,
  checkWorkspaceScope: v1MiddlewareMockFns.mockCheckWorkspaceScope,
  checkOrganizationPersonalKeyRefusal: v1MiddlewareMockFns.mockCheckOrganizationPersonalKeyRefusal,
  concealedWorkspaceAccessResponse: v1MiddlewareMockFns.mockConcealedWorkspaceAccessResponse,
  resolveWorkspaceRequestActor: v1MiddlewareMockFns.mockResolveWorkspaceRequestActor,
  requireWorkspaceRequestActor: v1MiddlewareMockFns.mockRequireWorkspaceRequestActor,
  validateWorkspaceAccess: v1MiddlewareMockFns.mockValidateWorkspaceAccess,
  v1ValidationErrorResponse: v1MiddlewareMockFns.mockV1ValidationErrorResponse,
  v1ValidationErrorResponseFromError: v1MiddlewareMockFns.mockV1ValidationErrorResponseFromError,
}
