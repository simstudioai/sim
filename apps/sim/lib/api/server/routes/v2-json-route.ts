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
  type V2CredentialType,
} from '@/lib/api/server/routes/v2-api-key-auth'
import {
  hasV2Credential,
  readV2CredentialHeaders,
} from '@/lib/api/server/routes/v2-credential-headers'
import {
  type ParsedRequest,
  type ParseRequestOptions,
  parseRequest,
} from '@/lib/api/server/validation'
import {
  type ApplicationOperation,
  InsufficientScopeError,
  OAuthAccessTokenExpiredError,
  type OperationUseCase,
  requireOAuthOperationScope,
} from '@/lib/core/application'
import { getRateLimit, RateLimiter, type SubscriptionPlan } from '@/lib/core/rate-limiter'
import { getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
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
  constructor(stage: 'authentication' | 'rate_limit', cause: unknown) {
    super(`V2 ${stage} infrastructure failed`, { cause })
    this.name = 'V2RouteInfrastructureError'
  }
}

/**
 * The v2 credential policy: an API key in `x-api-key`, or a Sim OAuth access
 * token as `Authorization: Bearer`.
 */
export const v2ApiKeyAuth = {
  authenticate(request: NextRequest) {
    return authenticateV2ApiKey(readV2CredentialHeaders(request.headers))
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
const v2PayloadTooLargeResponse = () => v2Error('PAYLOAD_TOO_LARGE', 'Request body is too large')

/**
 * Default `400` for a body that is absent or not valid JSON, for the same
 * reason as {@link v2PayloadTooLargeResponse}: `parseRequest`'s fallback is a
 * bare `{ "error": "Request body must be valid JSON" }` carrying no
 * `error.code`, so a client reading `error.code` off every other v2 failure
 * gets `undefined` exactly when its request was malformed. A default rather
 * than a per-route opt-in, because an opt-in only holds where somebody
 * remembered it. A route supplying its own `invalidJsonResponse` still wins.
 */
export const v2InvalidJsonResponse = () => v2Error('BAD_REQUEST', 'Request body must be valid JSON')

/**
 * Whether the request declared a media type that is not a JSON body at all.
 *
 * Only consulted once a body has already **failed** to parse as JSON — see
 * {@link v2InvalidBodyResponse} — so this decides how to describe a request
 * that is failing either way, never whether one is accepted.
 *
 * An absent `Content-Type` is not a mismatch. A body sent without one is
 * indistinguishable from a client that simply omits the header, and today's
 * callers include ones that do; treating absence as a refusal is the likeliest
 * way to turn a working client into a 415.
 *
 * `text/plain` is not a mismatch either, and that carve-out is load-bearing:
 * `fetch(url, { method: 'POST', body: JSON.stringify(x) })` with no explicit
 * headers sends `text/plain;charset=UTF-8`, so it is the default media type of
 * a hand-written JSON body from a browser rather than a declaration that the
 * body is not JSON.
 *
 * Anything else — `application/x-www-form-urlencoded`, `multipart/form-data`,
 * `application/xml` — is a positive statement that the body is in some other
 * format, which is exactly what 415 names.
 */
function declaresNonJsonBody(request: Request): boolean {
  const header = request.headers.get('content-type')
  if (!header) return false
  const mediaType = header.split(';', 1)[0].trim().toLowerCase()
  if (!mediaType || mediaType === 'text/plain') return false
  const subtype = mediaType.slice(mediaType.indexOf('/') + 1)
  return subtype !== 'json' && !subtype.endsWith('+json')
}

/**
 * The v2 answer to a body that could not be read as JSON: `415` when the caller
 * declared a non-JSON media type, `400` otherwise.
 *
 * `400 "Request body must be valid JSON"` is the same answer for a truncated
 * JSON body and for a form-encoded one, which leaves a caller who sent
 * `application/x-www-form-urlencoded` hunting a syntax error in a body that has
 * none. `UNSUPPORTED_MEDIA_TYPE` was already a declared `V2ErrorCode` with no
 * path that reached it; this is that path.
 *
 * Deliberately a **re-classification of an existing failure**, not a new gate.
 * It runs only after the JSON read has already failed, so no request that
 * succeeds today can start failing: `curl -d '{"a":1}'` without `-H` sends
 * form-urlencoded around a body that parses as JSON perfectly well, and that
 * caller keeps working exactly as before. A pre-parse content-type gate would
 * have broken them — and would also have to special-case the multipart bodies
 * `defineV2BodyLifecycleRoute` legitimately accepts. Only the status and
 * `error.code` of an already-4xx request change.
 */
export function v2InvalidBodyResponse(request: Request): NextResponse {
  return declaresNonJsonBody(request)
    ? v2Error('UNSUPPORTED_MEDIA_TYPE', 'Request body must be sent as application/json')
    : v2InvalidJsonResponse()
}

/**
 * The parse failures every v2 route renders the same way.
 *
 * The builders spread this, and so must the handful of raw `withRouteHandler`
 * v2 routes that call `parseRequest` directly — they are exactly the routes a
 * builder default cannot reach.
 *
 * `invalidJsonResponse` is the request-unaware 400. `parseRequest` invokes it
 * with no arguments, so the media-type-aware {@link v2InvalidBodyResponse} can
 * only be installed by a caller that still holds the request — which
 * {@link defineV2JsonRoute} does, overriding this entry. A raw route wanting the
 * same 415 passes `invalidJsonResponse: () => v2InvalidBodyResponse(request)`
 * after spreading this.
 */
export const V2_PARSE_DEFAULTS = {
  payloadTooLargeResponse: v2PayloadTooLargeResponse,
  invalidJsonResponse: v2InvalidJsonResponse,
  validationErrorResponse: v2ValidationError,
  /** See {@link blankQueryValueValidationError}. */
  rejectBlankQueryValues: true,
  /** See {@link duplicateQueryValueValidationError}. */
  rejectDuplicateQueryValues: true,
} as const

export interface V2ErrorPolicy {
  render(error: unknown): NextResponse | null
}

/**
 * Refuses at module load to build a `headSafe: false` route whose use case
 * cannot answer the authorization question on its own — see the `headSafe`
 * option below. A use case with no `authorize` leaves the builder nothing but
 * admission to answer a `HEAD` from, so the gap is a boot failure rather than a
 * silent 200.
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
 * A use case with no `authorize` throws here rather than being skipped, even
 * though {@link requireHeadAuthorizableUseCase} already refuses such a route at
 * module load: treating the phase as optional would silently degrade a missing
 * one into exactly the bodiless 200 this function exists to stop.
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
  if (!ip) {
    const resetAt = new Date(Date.now() + V2_PREAUTH_IP_LIMIT.refillIntervalMs)
    return v2RateLimitError({
      allowed: false,
      limit: V2_PREAUTH_IP_LIMIT.maxTokens,
      remaining: 0,
      resetAt,
      retryAfterMs: V2_PREAUTH_IP_LIMIT.refillIntervalMs,
    })
  }
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
      return {
        success: false,
        response: v2Error('UNAUTHORIZED', error.message, {
          authChallenge: error.challenge,
        }),
      }
    }
    throw new V2RouteInfrastructureError('authentication', error)
  }

  try {
    requireOAuthOperationScope(auth.principal, operation)
  } catch (error) {
    if (error instanceof InsufficientScopeError || error instanceof OAuthAccessTokenExpiredError) {
      const response = v2CaughtOrchestrationError(error)
      if (response) return { success: false, response }
    }
    throw error
  }

  const limited = await rateLimitPolicy.enforce(request, auth, operation)
  return limited ? { success: false, response: limited } : { success: true, auth }
}

async function admitRateLimitedV2Request(
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

/** Admission for a v2 route the builders do not cover, such as the resume leg. */
export async function admitV2Request(
  request: NextRequest,
  operation: ApplicationOperation,
  authPolicy: typeof v2ApiKeyAuth,
  rateLimitPolicy: V2RateLimitPolicy
): Promise<
  { success: true; auth: V2ApiKeyAuthContext } | { success: false; response: NextResponse }
> {
  return admitRateLimitedV2Request(request, operation, authPolicy, rateLimitPolicy)
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
  if (!hasV2Credential(request.headers)) return { success: true }
  return admitAuthenticatedV2Request(request, operation, authPolicy, rateLimitPolicy)
}

/**
 * What `mapInput` learns about the authenticated credential.
 *
 * Deliberately not the whole {@link V2ApiKeyAuthContext}: it carries the
 * principal, and a route mapping identity into use-case input would be routing
 * an authorization decision around the application boundary. These are facts
 * about the credential rather than about who holds it.
 *
 * One route reads it: `GET /api/v2/meta`, whose resource *is* the calling key.
 */
export interface V2CredentialFacts {
  readonly keyType: V2CredentialType
  readonly keyExpiresAt: Date | null
}

interface V2JsonRouteOptions<C extends JsonApiRouteContract, O extends ApplicationOperation, I, R>
  extends Omit<JsonRouteDefinition<C, O, I, R>, 'mapInput'> {
  mapInput(input: ParsedRequest<C>, credential: V2CredentialFacts): I
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
   * Stopping any earlier than authorization makes this an existence oracle:
   * admission proves only that the caller holds *a* valid key, so a `HEAD`
   * answered at that point returns 200 for a resource the very same caller's
   * `GET` answers 403 or 404 for. A `headSafe: false` route therefore
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

      const admission = await admitRateLimitedV2Request(
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
          await options.beforeParse({
            request,
            principal: auth.principal,
            params: rawParams,
          })
        } catch (error) {
          const response = options.errorPolicy.render(error)
          if (response) return response
          throw error
        }
      }

      const parsed = await parseRequest(options.contract, request, context ?? {}, {
        ...V2_PARSE_DEFAULTS,
        invalidJsonResponse: () => v2InvalidBodyResponse(request),
        ...options.parseOptions,
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const credentialFacts: V2CredentialFacts = {
        keyType: auth.keyType,
        keyExpiresAt: auth.keyExpiresAt,
      }

      if (request.method === 'HEAD' && options.headSafe === false) {
        let input: I
        try {
          input = options.mapInput(parsed.data, credentialFacts)
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
        const input = options.mapInput(parsed.data, credentialFacts)
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
