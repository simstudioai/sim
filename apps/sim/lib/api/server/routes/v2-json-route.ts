import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { recordRateLimitSnapshot } from '@/lib/api/server/rate-limit-context'
import {
  methodMatchesContract,
  requireJsonRouteDefinition,
} from '@/lib/api/server/routes/definition'
import type {
  JsonApiRouteContract,
  JsonNextRouteHandler,
  JsonRouteContext,
  JsonRouteDefinition,
} from '@/lib/api/server/routes/types'
import {
  authenticateV2ApiKey,
  type V2ApiKeyAuthContext,
  V2ApiKeyUnauthenticatedError,
} from '@/lib/api/server/routes/v2-api-key-auth'
import { type ParseRequestOptions, parseRequest } from '@/lib/api/server/validation'
import type { ApplicationOperation, OperationUseCase } from '@/lib/core/application'
import { getRateLimit, RateLimiter, type SubscriptionPlan } from '@/lib/core/rate-limiter'
import { getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CaughtOrchestrationError,
  v2Error,
  v2HeadNoEffect,
  v2HttpError,
  v2RateLimitError,
  v2ValidationError,
} from '@/app/api/v2/lib/response'

const rateLimiter = new RateLimiter()
const V2_PREAUTH_IP_LIMIT = {
  maxTokens: 600,
  refillRate: 300,
  refillIntervalMs: 60_000,
} as const

export class V2RouteInfrastructureError extends Error {
  constructor(stage: 'authentication' | 'rollout_gate' | 'rate_limit', cause: unknown) {
    super(`V2 ${stage} infrastructure failed`, { cause })
    this.name = 'V2RouteInfrastructureError'
  }
}

export const v2ApiKeyAuth = {
  authenticate(request: NextRequest) {
    return authenticateV2ApiKey(request.headers.get('x-api-key'))
  },
} as const

export interface V2RateLimitPolicy {
  readonly kind: 'public_api'
  enforce(
    request: NextRequest,
    auth: V2ApiKeyAuthContext,
    operation: ApplicationOperation
  ): Promise<NextResponse | null>
}

export const v2RateLimits = {
  publicApi: {
    kind: 'public_api',
    async enforce(request, auth, operation) {
      const plan = (auth.rateLimitSubscription?.plan ?? 'free') as SubscriptionPlan
      const config = getRateLimit(plan, 'api-endpoint')
      const buckets = await Promise.all(
        auth.rateLimitSubjectIds.map(async (subjectId) => {
          try {
            return await rateLimiter.checkRateLimitDirectOrThrow(
              `v2:${operation.id}:${subjectId}`,
              config
            )
          } catch (error) {
            throw new V2RouteInfrastructureError('rate_limit', error)
          }
        })
      )
      const rateLimit = buckets.reduce((mostRestrictive, candidate) => {
        if (!candidate.allowed && mostRestrictive.allowed) return candidate
        if (candidate.allowed === mostRestrictive.allowed) {
          if (candidate.remaining < mostRestrictive.remaining) return candidate
          if (
            candidate.remaining === mostRestrictive.remaining &&
            candidate.resetAt > mostRestrictive.resetAt
          ) {
            return candidate
          }
        }
        return mostRestrictive
      })
      const snapshot = {
        allowed: rateLimit.allowed,
        limit: config.maxTokens,
        remaining: rateLimit.remaining,
        resetAt: rateLimit.resetAt,
        retryAfterMs: rateLimit.retryAfterMs,
        keyType: auth.keyType,
      }
      recordRateLimitSnapshot(request, snapshot)
      return rateLimit.allowed ? null : v2RateLimitError(snapshot)
    },
  } satisfies V2RateLimitPolicy,
} as const

/**
 * Default `413` for every v2 JSON route. `parseRequest` otherwise falls back to its
 * framework-level body, a bare `{ "error": string }` that carries no `error.code`, is not
 * the v2 error envelope, and omits the `Cache-Control: private, no-store` every other v2
 * response sets. Declared here so a route only has to set `parseOptions.maxBodyBytes` to
 * get a correct 413; a route that supplies its own `payloadTooLargeResponse` still wins.
 */
export const v2PayloadTooLargeResponse = () =>
  v2Error('PAYLOAD_TOO_LARGE', 'Request body is too large')

/**
 * Default `400` for a body that is absent or not valid JSON, for the same
 * reason as {@link v2PayloadTooLargeResponse}: `parseRequest`'s fallback is a
 * bare `{ "error": "Request body must be valid JSON" }` carrying no
 * `error.code`, so a client reading `error.code` off every other v2 failure
 * gets `undefined` exactly when its request was malformed.
 *
 * It is a default rather than a per-route opt-in because the opt-in *was* the
 * bug: only 8 of the 77 v2 routes remembered to pass it, so the envelope held
 * for validation errors and broke for transport-level ones. A route supplying
 * its own `invalidJsonResponse` still wins.
 */
export const v2InvalidJsonResponse = () => v2Error('BAD_REQUEST', 'Request body must be valid JSON')

/**
 * The parse failures every v2 route renders the same way.
 *
 * The builders spread this, and so must the handful of raw `withRouteHandler`
 * v2 routes that call `parseRequest` directly — they are exactly the routes a
 * builder default cannot reach, and leaving them out is what kept the bare
 * `{ "error": string }` body alive on two of the busiest v2 POSTs.
 */
export const V2_PARSE_DEFAULTS = {
  payloadTooLargeResponse: v2PayloadTooLargeResponse,
  invalidJsonResponse: v2InvalidJsonResponse,
  /**
   * `?limit=` is not `limit` omitted, and v2 already says so on the two params
   * whose schema happens to catch it: `search` and `cursor` both reject a blank
   * and tell the caller to omit the parameter. Applying the rule at the surface
   * rather than per schema is what makes it true for every param — including the
   * coerced ones, where the blank has already become `0` or a default by the
   * time a schema sees the value.
   */
  rejectBlankQueryValues: true,
  /**
   * `?workspaceId=X&workspaceId=X` is not `workspaceId=X`, and no v2 query
   * param is declared as an array — every list on this surface is one
   * comma-separated string — so a repeated param can only ever be a caller
   * mistake. Without this it reached the schema as an array and drew that
   * param's *absence* message ("Workspace ID is required") for a request that
   * plainly sent it, which is a signpost pointing away from the actual error.
   */
  rejectDuplicateQueryValues: true,
} as const

export interface V2ErrorPolicy {
  render(error: unknown): NextResponse | null
}

/**
 * Refuses at module load to build a `headSafe: false` route whose use case
 * cannot answer the authorization question on its own.
 *
 * Such a route must decide a `HEAD` without executing the use case, and the only
 * honest way to do that is to run the use case's authorization phase alone. A
 * use case that does not expose one leaves the builder with nothing but
 * admission to answer from, which is precisely the existence oracle
 * `headSafe: false` used to ship. Failing here turns the next occurrence into a
 * boot failure instead of a silent 200.
 */
export function requireHeadAuthorizableUseCase(
  contract: { method: string; path: string },
  headSafe: boolean | undefined,
  useCase: Pick<OperationUseCase<ApplicationOperation, unknown, unknown>, 'authorize'>
): void {
  if (headSafe !== false) return
  if (typeof useCase.authorize === 'function') return
  throw new Error(
    `V2 route ${contract.method} ${contract.path} declares headSafe: false but its use case has no authorize(); a HEAD would have to answer from authentication alone and would leak the resource's existence.`
  )
}

/**
 * The bodiless answer a `HEAD` gets on a route whose `GET` is not safe.
 *
 * Authorization runs first and its failures render through the route's own error
 * policy, so the status a caller sees is the status their `GET` would have
 * produced — 400, 401, 403, 404, 429 — and only an authorized caller reaches the
 * 200. What a `HEAD` never reaches is the use case's business phase, so the
 * outbound connection, the row write, and the audit event stay unfired.
 *
 * A use case with no `authorize` is refused here rather than skipped. Both
 * builders that call this already refuse such a route at module load through
 * {@link requireHeadAuthorizableUseCase}, and they are its only callers, so the
 * refusal is unreachable through them. It is not written as a comment because
 * the alternative — an optional call — degrades a missing phase into exactly the
 * bodiless 200 this function exists to stop, and it does so silently. Failing
 * closed makes an authorization that actually ran the only route to that 200.
 */
export async function v2HeadAuthorizationResponse(args: {
  useCase: Pick<OperationUseCase<ApplicationOperation, unknown, unknown>, 'authorize'>
  principal: V2ApiKeyAuthContext['principal']
  input: unknown
  request: NextRequest
  errorPolicy: V2ErrorPolicy
}): Promise<NextResponse> {
  const { authorize } = args.useCase
  if (typeof authorize !== 'function') {
    throw new Error(
      'HEAD on a route that is not head-safe reached a use case with no authorize(); answering 200 would leak the existence of a resource the GET never authorized.'
    )
  }
  try {
    await authorize({
      principal: args.principal,
      input: args.input,
      request: args.request,
    })
  } catch (error) {
    const response = args.errorPolicy.render(error)
    if (response) return response
    throw error
  }
  return v2HeadNoEffect()
}

export const v2OrchestrationErrorPolicy = {
  render(error) {
    return v2CaughtOrchestrationError(error)
  },
} satisfies V2ErrorPolicy

async function enforceV2PreAuthIpLimit(request: NextRequest): Promise<NextResponse | null> {
  const ip = getClientIp(request)
  const abuseLimit = await rateLimiter.checkRateLimitDirect(
    `v2:preauth:ip:${ip}`,
    V2_PREAUTH_IP_LIMIT,
    { failClosed: true }
  )
  return abuseLimit.allowed
    ? null
    : v2RateLimitError({ ...abuseLimit, limit: V2_PREAUTH_IP_LIMIT.maxTokens })
}

async function admitAuthenticatedV2Request(
  request: NextRequest,
  operation: ApplicationOperation,
  authPolicy: typeof v2ApiKeyAuth,
  rateLimitPolicy: V2RateLimitPolicy
): Promise<
  { success: true; auth: V2ApiKeyAuthContext } | { success: false; response: NextResponse }
> {
  let auth: V2ApiKeyAuthContext
  try {
    auth = await authPolicy.authenticate(request)
  } catch (error) {
    if (error instanceof V2ApiKeyUnauthenticatedError) {
      return { success: false, response: v2Error('UNAUTHORIZED', error.message) }
    }
    throw new V2RouteInfrastructureError('authentication', error)
  }

  let gate
  try {
    gate = await v2ApiGateError(auth.rolloutUserId)
  } catch (error) {
    throw new V2RouteInfrastructureError('rollout_gate', error)
  }
  if (gate) return { success: false, response: gate }

  const limited = await rateLimitPolicy.enforce(request, auth, operation)
  return limited ? { success: false, response: limited } : { success: true, auth }
}

export async function admitV2Request(
  request: NextRequest,
  operation: ApplicationOperation,
  authPolicy: typeof v2ApiKeyAuth,
  rateLimitPolicy: V2RateLimitPolicy
): Promise<
  { success: true; auth: V2ApiKeyAuthContext } | { success: false; response: NextResponse }
> {
  const preAuthResponse = await enforceV2PreAuthIpLimit(request)
  if (preAuthResponse) return { success: false, response: preAuthResponse }
  return admitAuthenticatedV2Request(request, operation, authPolicy, rateLimitPolicy)
}

export async function admitOptionalV2Request(
  request: NextRequest,
  operation: ApplicationOperation,
  authPolicy: typeof v2ApiKeyAuth,
  rateLimitPolicy: V2RateLimitPolicy
): Promise<
  { success: true; auth?: V2ApiKeyAuthContext } | { success: false; response: NextResponse }
> {
  const preAuthResponse = await enforceV2PreAuthIpLimit(request)
  if (preAuthResponse) return { success: false, response: preAuthResponse }
  if (!request.headers.has('x-api-key')) return { success: true }
  return admitAuthenticatedV2Request(request, operation, authPolicy, rateLimitPolicy)
}

interface V2JsonRouteOptions<C extends JsonApiRouteContract, O extends ApplicationOperation, I, R>
  extends JsonRouteDefinition<C, O, I, R> {
  auth: typeof v2ApiKeyAuth
  rateLimit: V2RateLimitPolicy
  errorPolicy: V2ErrorPolicy
  /**
   * Whether this route's `GET` is safe enough for Next's `HEAD`→`GET` aliasing
   * to run it. Defaults to `true`, which is correct for a read.
   *
   * Set `false` when the `GET` opens an outbound connection or writes a row. A
   * `HEAD` on such a route is admitted, parsed, and **authorized** exactly as
   * the `GET` would be, then answered bodiless without running the use case's
   * business phase — see {@link v2HeadNoEffect}.
   *
   * Stopping any earlier than authorization is what made this an existence
   * oracle: admission proves only that the caller holds *a* valid key, so a
   * `HEAD` answered at that point returned 200 for a resource the very same
   * caller's `GET` answered 403 or 404 for. A `headSafe: false` route therefore
   * requires a use case exposing `authorize`, checked at definition time by
   * {@link requireHeadAuthorizableUseCase}.
   */
  headSafe?: boolean
  parseOptions?: Omit<ParseRequestOptions, 'validationErrorResponse'>
  beforeParse?(args: {
    request: NextRequest
    principal: V2ApiKeyAuthContext['principal']
    params: Record<string, string | string[] | undefined>
  }): void | Promise<void>
  onSuccess?(args: {
    principal: V2ApiKeyAuthContext['principal']
    input: NoInfer<I>
    result: NoInfer<R>
  }): void | Promise<void>
  statusForResult?(result: NoInfer<R>): number
}

export function defineV2JsonRoute<
  C extends JsonApiRouteContract,
  O extends ApplicationOperation,
  I,
  R,
>(options: V2JsonRouteOptions<C, O, I, R>): JsonNextRouteHandler {
  const { successStatus, successStatuses } = requireJsonRouteDefinition(
    options.contract,
    options.operation,
    options.useCase.operation
  )
  requireHeadAuthorizableUseCase(options.contract, options.headSafe, options.useCase)

  const wrapped = withRouteHandler<JsonRouteContext | undefined>(
    async (request, context) => {
      if (!methodMatchesContract(request.method, options.contract.method)) {
        throw new Error(
          `Route received ${request.method} for ${options.contract.method} contract ${options.contract.path}`
        )
      }

      const admission = await admitV2Request(
        request,
        options.operation,
        options.auth,
        options.rateLimit
      )
      if (!admission.success) return admission.response
      const { auth } = admission

      if (options.beforeParse) {
        const rawParams = context?.params ? await context.params : {}
        try {
          await options.beforeParse({ request, principal: auth.principal, params: rawParams })
        } catch (error) {
          const response = options.errorPolicy.render(error)
          if (response) return response
          throw error
        }
      }

      const parsed = await parseRequest(options.contract, request, context ?? {}, {
        ...V2_PARSE_DEFAULTS,
        ...options.parseOptions,
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      if (request.method === 'HEAD' && options.headSafe === false) {
        let input: I
        try {
          input = options.mapInput(parsed.data)
        } catch (error) {
          const response = options.errorPolicy.render(error)
          if (response) return response
          throw error
        }
        return v2HeadAuthorizationResponse({
          useCase: options.useCase,
          principal: auth.principal,
          input,
          request,
          errorPolicy: options.errorPolicy,
        })
      }

      try {
        const input = options.mapInput(parsed.data)
        const result = await options.useCase.execute({
          principal: auth.principal,
          input,
          request,
        })
        const body = await options.present(result, parsed.data)
        const responseSchema = options.contract.response
        if (responseSchema.mode !== 'json') {
          throw new Error('V2 JSON route response mode changed after initialization')
        }
        const validatedBody = responseSchema.schema.parse(body)
        const responseStatus = options.statusForResult?.(result) ?? successStatus
        if (!successStatuses.includes(responseStatus)) {
          throw new Error(
            `V2 JSON route produced undeclared success status ${responseStatus}; expected ${successStatuses.join(', ')}`
          )
        }
        await options.onSuccess?.({ principal: auth.principal, input, result })
        return NextResponse.json(validatedBody, {
          status: responseStatus,
          headers: { 'Cache-Control': 'private, no-store' },
        })
      } catch (error) {
        const response = options.errorPolicy.render(error)
        if (response) return response
        throw error
      }
    },
    {
      clientAbortResponse: () => v2Error('CLIENT_CLOSED_REQUEST', 'Client cancelled request'),
      typedErrorResponse: ({ error }) => v2HttpError(error),
      unhandledErrorResponse: ({ error }) =>
        error instanceof V2RouteInfrastructureError
          ? v2Error('SERVICE_UNAVAILABLE', 'Service temporarily unavailable')
          : v2Error('INTERNAL_ERROR', 'Internal server error'),
    }
  )

  return async (request, context) => wrapped(request, context)
}
