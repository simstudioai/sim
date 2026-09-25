import { vi } from 'vitest'

/** Mirrors `InternalUnauthenticatedError`: same `name`, default message `'Unauthorized'`. */
export class MockInternalUnauthenticatedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'InternalUnauthenticatedError'
  }
}

/** Mirrors `V2RouteInfrastructureError`: same `name`, message and `cause`. */
export class MockV2RouteInfrastructureError extends Error {
  constructor(stage: 'authentication' | 'rate_limit', cause: unknown) {
    super(`V2 ${stage} infrastructure failed`, { cause })
    this.name = 'V2RouteInfrastructureError'
  }
}

/**
 * The `not_found` failure {@link apiServerRoutesMock.concealCrossTenantResourceError} substitutes.
 * Shaped like the real `OrchestrationError` (`name`, `code`) but NOT an instance of it.
 */
export class MockConcealedResourceError extends Error {
  readonly code = 'not_found' as const

  constructor(message: string) {
    super(message)
    this.name = 'OrchestrationError'
  }
}

interface MockJsonErrorResponseDescriptor {
  body: unknown
  status: number
  headers?: HeadersInit
}

interface MockInternalErrorPolicy {
  project(error: unknown): MockJsonErrorResponseDescriptor | null
  unhandled?(): MockJsonErrorResponseDescriptor
}

interface MockV2ErrorPolicy {
  render(error: unknown): Response | null
}

const ORCHESTRATION_STATUS: Record<string, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  locked: 423,
  payload_too_large: 413,
  internal: 500,
}

const CROSS_TENANT_ERROR_NAMES = new Set([
  'DelegatedWorkspaceAuthorizationError',
  'NoWorkspaceAccessError',
  'WorkspaceApiKeyScopeAuthorizationError',
])

function internalErrorResponse(
  status: number,
  body: unknown,
  headers?: HeadersInit
): MockJsonErrorResponseDescriptor {
  if (!Number.isInteger(status) || status < 400 || status >= 600) {
    throw new Error(`Internal error responses require a 4xx or 5xx status, received ${status}`)
  }
  return { body, status, headers }
}

/** Walks the `cause` chain for an `Error` carrying a known orchestration `code` (duck-typed). */
function findOrchestrationError(error: unknown): (Error & { code: string }) | null {
  let current: unknown = error
  while (current instanceof Error) {
    const code = (current as Error & { code?: unknown }).code
    if (typeof code === 'string' && code in ORCHESTRATION_STATUS) {
      return current as Error & { code: string }
    }
    current = current.cause
  }
  return null
}

function isCrossTenantError(error: unknown): boolean {
  return error instanceof Error && CROSS_TENANT_ERROR_NAMES.has(error.name)
}

function concealCrossTenantResourceError(error: unknown, notFoundMessage: string): unknown {
  return isCrossTenantError(error) ? new MockConcealedResourceError(notFoundMessage) : error
}

const internalOrchestrationErrorPolicy: MockInternalErrorPolicy = {
  project(error) {
    const classified = findOrchestrationError(error)
    if (!classified) return null
    return internalErrorResponse(ORCHESTRATION_STATUS[classified.code] ?? 500, {
      error: classified.code === 'internal' ? 'Internal server error' : classified.message,
    })
  },
  unhandled() {
    return internalErrorResponse(500, { error: 'Internal server error' })
  },
}

/** The `define*Route` default: hand the definition back so a suite can inspect it as the export. */
function returnDefinition<T>(definition: T): T {
  return definition
}

const mockV2OrchestrationRender = vi.fn((_error: unknown): Response | null => null)

/**
 * Controllable mock functions for `@/lib/api/server/routes`.
 *
 * Bare `vi.fn()`s (return `undefined`): `createScimRouteBuilder`, `admitV2Request`,
 * `admitOptionalV2Request`, `v2InvalidBodyResponse`, the three `V2_PARSE_DEFAULTS` responders, and
 * both `authenticate` fns (`internalSessionAuth`, `v2ApiKeyAuth`).
 *
 * Every `define*Route` builder returns its definition unchanged, so a route module's exported
 * `GET`/`PATCH`/… IS the definition: assert on it with `toMatchObject` or call its `mapInput` /
 * `present`. Capture into a list or return a handler with `mockImplementation` — set it inside the
 * `vi.mock` factory, since the route module is built when it is imported.
 *
 * Other non-bare defaults (faithful ports of the real pure helpers):
 * - `mockInternalErrorResponse` returns `{ body, status, headers }` and throws outside 4xx/5xx.
 * - `mockExtendInternalErrorPolicy` tries the extension, then the base policy.
 * - `mockRateLimitNone` returns `{ kind: 'none', reason, enforce }` (throws on a blank reason);
 *   `mockRateLimitUser` returns `{ kind: 'user', bucketName, enforce }` whose `enforce` resolves
 *   `null` (never limited).
 * - `mockV2PublicApiEnforce` resolves `null` (never limited).
 * - `mockCreateInternalSessionOrExecutorAuth` returns `{ authenticate: vi.fn() }`.
 * - `mockConcealCrossTenantResourceError` / the two concealment-policy factories match the real
 *   cross-tenant errors BY `name` (so the `workspace-authorization.mock` mirrors are recognized).
 * - `internalOrchestrationErrorPolicy.project` maps any `Error` (or `cause`) carrying a known
 *   orchestration `code` to its status, duck-typed rather than `instanceof OrchestrationError`.
 * - `mockV2OrchestrationRender` returns `null` (unhandled).
 */
export const apiServerRoutesMockFns = {
  mockDefineInternalBinaryRoute: vi.fn(returnDefinition),
  mockDefineInternalJsonRoute: vi.fn(returnDefinition),
  mockDefineV2BinaryRoute: vi.fn(returnDefinition),
  mockDefineV2BodyLifecycleRoute: vi.fn(returnDefinition),
  mockDefineV2JsonRoute: vi.fn(returnDefinition),
  mockCreateScimRouteBuilder: vi.fn(),
  mockDefineScimDiscoveryRoute: vi.fn(returnDefinition),
  mockAdmitOptionalV2Request: vi.fn(),
  mockAdmitV2Request: vi.fn(),
  mockV2InvalidBodyResponse: vi.fn(),
  mockCreateInternalSessionOrExecutorAuth: vi.fn((_options: unknown) => ({
    authenticate: vi.fn(),
  })),
  mockExtendInternalErrorPolicy: vi.fn(
    (
      base: MockInternalErrorPolicy,
      project: (error: unknown) => MockJsonErrorResponseDescriptor | null
    ): MockInternalErrorPolicy => ({
      project: (error) => project(error) ?? base.project(error),
      unhandled: base.unhandled,
    })
  ),
  mockInternalErrorResponse: vi.fn(internalErrorResponse),
  mockConcealCrossTenantResourceError: vi.fn(concealCrossTenantResourceError),
  mockCreateInternalResourceConcealmentPolicy: vi.fn(
    (options: {
      base: MockInternalErrorPolicy
      notFoundMessage: string
    }): MockInternalErrorPolicy => {
      if (!options.notFoundMessage.trim()) {
        throw new Error('A concealed internal resource requires a not-found message')
      }
      return {
        project: (error) =>
          options.base.project(concealCrossTenantResourceError(error, options.notFoundMessage)),
        unhandled: options.base.unhandled,
      }
    }
  ),
  mockCreateV2ResourceConcealmentPolicy: vi.fn(
    (options: {
      notFoundMessage: string
      render?: (error: unknown) => Response | null
    }): MockV2ErrorPolicy => {
      const render = options.render ?? mockV2OrchestrationRender
      return {
        render: (error) =>
          isCrossTenantError(error)
            ? Response.json(
                { error: { code: 'NOT_FOUND', message: options.notFoundMessage } },
                { status: 404 }
              )
            : render(error),
      }
    }
  ),
  mockInternalSessionAuthenticate: vi.fn(),
  mockRateLimitNone: vi.fn(({ reason }: { reason: string }) => {
    if (!reason.trim()) throw new Error('A rate-limit exemption reason is required')
    return { kind: 'none' as const, reason, async enforce(): Promise<void> {} }
  }),
  mockRateLimitUser: vi.fn(({ bucketName }: { bucketName: string; config?: unknown }) => {
    if (!bucketName.trim()) throw new Error('A user rate-limit bucket name is required')
    return {
      kind: 'user' as const,
      bucketName,
      async enforce(): Promise<Response | null> {
        return null
      },
    }
  }),
  mockV2ApiKeyAuthenticate: vi.fn(),
  mockV2PublicApiEnforce: vi.fn(
    async (_request: unknown, _auth: unknown, _operation: unknown): Promise<Response | null> => null
  ),
  mockV2OrchestrationRender,
  mockV2PayloadTooLargeResponse: vi.fn(),
  mockV2InvalidJsonResponse: vi.fn(),
  mockV2ValidationErrorResponse: vi.fn(),
}

/**
 * Static mock module for `@/lib/api/server/routes`. Covers every runtime export; the policy
 * objects keep their real keys and delegate to {@link apiServerRoutesMockFns}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/api/server/routes', () => apiServerRoutesMock)
 * // PATCH is a route module export built with defineInternalJsonRoute
 * expect(PATCH).toMatchObject({ auth: apiServerRoutesMock.internalSessionAuth, rateLimit: { kind: 'none' } })
 * ```
 */
export const apiServerRoutesMock = {
  defineInternalBinaryRoute: apiServerRoutesMockFns.mockDefineInternalBinaryRoute,
  createInternalSessionOrExecutorAuth:
    apiServerRoutesMockFns.mockCreateInternalSessionOrExecutorAuth,
  defineInternalJsonRoute: apiServerRoutesMockFns.mockDefineInternalJsonRoute,
  extendInternalErrorPolicy: apiServerRoutesMockFns.mockExtendInternalErrorPolicy,
  InternalUnauthenticatedError: MockInternalUnauthenticatedError,
  internalErrorResponse: apiServerRoutesMockFns.mockInternalErrorResponse,
  internalJsonPresenters: {
    withSuccess<R extends object>(result: R) {
      return { ...result, success: true as const }
    },
    successFrom<K extends string>(key: K) {
      return <R extends Record<K, boolean>>(result: R) => ({ success: result[key] })
    },
  },
  internalOrchestrationErrorPolicy,
  internalRateLimits: {
    none: apiServerRoutesMockFns.mockRateLimitNone,
    user: apiServerRoutesMockFns.mockRateLimitUser,
  },
  internalSessionAuth: {
    authenticate: apiServerRoutesMockFns.mockInternalSessionAuthenticate,
  },
  concealCrossTenantResourceError: apiServerRoutesMockFns.mockConcealCrossTenantResourceError,
  createInternalResourceConcealmentPolicy:
    apiServerRoutesMockFns.mockCreateInternalResourceConcealmentPolicy,
  createV2ResourceConcealmentPolicy: apiServerRoutesMockFns.mockCreateV2ResourceConcealmentPolicy,
  createScimRouteBuilder: apiServerRoutesMockFns.mockCreateScimRouteBuilder,
  defineScimDiscoveryRoute: apiServerRoutesMockFns.mockDefineScimDiscoveryRoute,
  defineV2BinaryRoute: apiServerRoutesMockFns.mockDefineV2BinaryRoute,
  defineV2BodyLifecycleRoute: apiServerRoutesMockFns.mockDefineV2BodyLifecycleRoute,
  admitOptionalV2Request: apiServerRoutesMockFns.mockAdmitOptionalV2Request,
  admitV2Request: apiServerRoutesMockFns.mockAdmitV2Request,
  defineV2JsonRoute: apiServerRoutesMockFns.mockDefineV2JsonRoute,
  V2_PARSE_DEFAULTS: {
    payloadTooLargeResponse: apiServerRoutesMockFns.mockV2PayloadTooLargeResponse,
    invalidJsonResponse: apiServerRoutesMockFns.mockV2InvalidJsonResponse,
    validationErrorResponse: apiServerRoutesMockFns.mockV2ValidationErrorResponse,
    rejectBlankQueryValues: true,
    rejectDuplicateQueryValues: true,
  },
  V2RouteInfrastructureError: MockV2RouteInfrastructureError,
  v2ApiKeyAuth: {
    authenticate: apiServerRoutesMockFns.mockV2ApiKeyAuthenticate,
  },
  v2InvalidBodyResponse: apiServerRoutesMockFns.mockV2InvalidBodyResponse,
  v2OrchestrationErrorPolicy: {
    render: apiServerRoutesMockFns.mockV2OrchestrationRender,
  },
  v2RateLimits: {
    publicApi: {
      kind: 'public_api' as const,
      enforce: apiServerRoutesMockFns.mockV2PublicApiEnforce,
    },
  },
}
