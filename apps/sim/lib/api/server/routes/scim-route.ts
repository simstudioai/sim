import type { ScimConnectionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import type { AnyApiRouteContract, ContractJsonResponse } from '@/lib/api/contracts/types'
import { type ParsedRequest, parseRequest } from '@/lib/api/server/validation'
import type { ApplicationOperation, OperationUseCase } from '@/lib/core/application/operation'
import { enforceIpRateLimit, RateLimiter } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { ScimConnectionAuthenticator } from '@/ee/scim/lib/authenticate'
import { scimBaseUrl } from '@/ee/scim/lib/base-url'
import { isScimDeploymentEnabled } from '@/ee/scim/lib/entitlement'
import {
  SCIM_ACCEPTED_MEDIA_TYPES,
  SCIM_MAX_BODY_BYTES,
  SCIM_MEDIA_TYPE,
  SCIM_RATE_LIMIT,
} from '@/ee/scim/lib/protocol/constants'
import {
  ScimError,
  type ScimErrorBody,
  type ScimType,
  scimErrorBody,
  toScimError,
} from '@/ee/scim/lib/protocol/errors'
import type { ScimRequestLogEntry } from '@/ee/scim/lib/request-log'

const logger = createLogger('ScimRoute')
const rateLimiter = new RateLimiter()

/**
 * The route builder for the SCIM 2.0 surface.
 *
 * SCIM cannot use `defineInternalJsonRoute`, and the differences are all
 * protocol rather than preference: the caller is a bearer credential with no
 * user and no workspace, the error envelope is RFC 7644's rather than Sim's
 * `{ error }`, responses must carry `application/scim+json`, `DELETE` and group
 * `PATCH` answer `204` with no body, and a wrong media type is a `415` before
 * anything is parsed. This is the documented protocol exception the API rules
 * allow, and it applies `withRouteHandler` exactly as the internal builder does
 * so request ids, logging, and abort handling stay identical.
 */

export interface ScimPresenterContext {
  baseUrl: string
}

interface ScimRouteOptions<C extends AnyApiRouteContract, O extends ApplicationOperation, I, R> {
  contract: C
  operation: O
  useCase: OperationUseCase<NoInfer<O>, I, R>
  mapInput(
    parsed: ParsedRequest<C>,
    context: { principal: ScimConnectionPrincipal; request: NextRequest }
  ): I
  /** Omitted for `204` routes, which have no body to render. */
  present?(result: NoInfer<R>, context: ScimPresenterContext): ContractJsonResponse<C>
  /** Extra response headers, such as `Location` on a create. */
  headers?(result: NoInfer<R>, context: ScimPresenterContext): Record<string, string>
}

export interface ScimRouteContext {
  params?: Promise<Record<string, string | string[] | undefined>>
}

export type ScimNextRouteHandler = (
  request: NextRequest,
  context: ScimRouteContext | undefined
) => Promise<NextResponse | Response> | NextResponse | Response

/** Dependencies the builder needs, injected so the module stays testable. */
interface ScimRouteDependencies {
  authenticate: ScimConnectionAuthenticator
  recordRequest(entry: ScimRequestLogEntry): void
}

function scimResponse(body: unknown, status: number, headers?: Record<string, string>): Response {
  return NextResponse.json(body, {
    status,
    headers: {
      'content-type': `${SCIM_MEDIA_TYPE}; charset=utf-8`,
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

function scimErrorResponse(error: ScimError): Response {
  return scimResponse(error.body, error.status, error.headers)
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH'])

/**
 * Requires a SCIM or JSON content type on a body-bearing request.
 *
 * `DELETE` is excluded because Okta sends it with no body and no content type,
 * and Entra sends one with `text/plain`.
 */
function assertAcceptableMediaType(request: NextRequest): void {
  if (!MUTATING_METHODS.has(request.method)) return
  const header = request.headers.get('content-type')
  if (!header) throw new ScimError(415, undefined, 'A content type is required')
  const mediaType = header.split(';')[0]?.trim().toLowerCase()
  if (!SCIM_ACCEPTED_MEDIA_TYPES.some((accepted) => accepted === mediaType)) {
    throw new ScimError(
      415,
      undefined,
      `SCIM requests must use ${SCIM_MEDIA_TYPE} or application/json`
    )
  }
}

/**
 * Consumes one token from the connection's bucket.
 *
 * Keyed by connection rather than by credential, so rotating a token cannot be
 * used to double the allowance, and never by IP: a provisioning service calls
 * from a large shared range, where an IP bucket would either be useless or would
 * throttle unrelated tenants together.
 */
async function enforceConnectionRateLimit(principal: ScimConnectionPrincipal): Promise<void> {
  const { allowed, resetAt } = await rateLimiter.checkRateLimitDirect(
    `route:scim:connection:${principal.connectionId}`,
    SCIM_RATE_LIMIT
  )
  if (allowed) return
  const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000))
  throw new ScimError(429, undefined, 'Rate limit exceeded', {
    'Retry-After': String(retryAfter),
    'X-RateLimit-Reset': resetAt.toISOString(),
  })
}

export function createScimRouteBuilder(dependencies: ScimRouteDependencies) {
  return function defineScimRoute<
    C extends AnyApiRouteContract,
    O extends ApplicationOperation,
    I,
    R,
  >(options: ScimRouteOptions<C, O, I, R>): ScimNextRouteHandler {
    if (options.operation.id !== options.useCase.operation.id) {
      throw new Error(
        `Route operation ${options.operation.id} does not match use case ${options.useCase.operation.id}`
      )
    }
    const isEmptyResponse = options.contract.response.mode === 'empty'
    const present = options.present
    if (!isEmptyResponse && !present) {
      throw new Error(`${options.contract.method} ${options.contract.path} requires a presenter`)
    }
    const declaredStatus = options.contract.response.status
    const successStatus =
      declaredStatus === undefined
        ? 200
        : Array.isArray(declaredStatus)
          ? declaredStatus[0]
          : declaredStatus

    return withRouteHandler<ScimRouteContext | undefined>(
      async (request, context) => {
        const startedAt = Date.now()
        let principal: ScimConnectionPrincipal | undefined
        let status = 500
        let scimType: ScimType | undefined
        let detail: string | undefined

        try {
          if (!isScimDeploymentEnabled()) throw new ScimError(404, undefined, 'Not found')
          if (request.method !== options.contract.method) {
            throw new ScimError(405, undefined, `${request.method} is not supported here`)
          }
          assertAcceptableMediaType(request)

          /**
           * Scope is enforced by the use-case wrapper from the operation's own
           * declaration, so the route cannot disagree with it. The builder only
           * authenticates and admits.
           */
          principal = await dependencies.authenticate(request)
          await enforceConnectionRateLimit(principal)

          const parsed = await parseRequest(options.contract, request, context ?? {}, {
            maxBodyBytes: SCIM_MAX_BODY_BYTES,
            validationErrorResponse: (error) =>
              NextResponse.json(
                scimErrorBody(400, 'invalidValue', error.issues[0]?.message ?? 'Invalid request'),
                { status: 400 }
              ),
            invalidJsonResponse: () =>
              NextResponse.json(
                scimErrorBody(400, 'invalidSyntax', 'Request body is not valid JSON'),
                { status: 400 }
              ),
            payloadTooLargeResponse: () =>
              NextResponse.json(scimErrorBody(413, undefined, 'Request body is too large'), {
                status: 413,
              }),
            /**
             * Entra sends `excludedAttributes=` with an empty value on some list
             * calls; treating that as a client error would fail an ordinary sync.
             */
            rejectBlankQueryValues: false,
          })
          if (!parsed.success) {
            const failure = (await parsed.response.json()) as ScimErrorBody
            status = parsed.response.status
            scimType = failure.scimType
            detail = failure.detail
            return scimResponse(failure, status)
          }

          const baseUrl = scimBaseUrl()
          const input = options.mapInput(parsed.data, { principal, request })
          const result = await options.useCase.execute({ principal, input, request })

          if (isEmptyResponse) {
            status = successStatus
            return new Response(null, {
              status,
              headers: { 'cache-control': 'no-store' },
            })
          }

          if (!present) throw new Error('unreachable: presenter checked at definition')
          const presented = present(result, { baseUrl })
          const validated =
            options.contract.response.mode === 'json'
              ? options.contract.response.schema.parse(presented)
              : presented
          status = successStatus
          return scimResponse(validated, status, options.headers?.(result, { baseUrl }))
        } catch (error) {
          const scim = toScimError(error)
          status = scim.status
          scimType = scim.scimType
          detail = scim.message
          /**
           * Authenticated traffic is admitted per connection. A caller that failed
           * to authenticate has no connection, so token guessing is bounded per
           * source address instead.
           */
          if (scim.status === 401 && !principal) {
            const limited = await enforceIpRateLimit('scim-auth', request)
            if (limited) {
              status = 429
              return scimResponse(
                scimErrorBody(429, undefined, 'Too many failed authentication attempts'),
                429,
                { 'Retry-After': '60' }
              )
            }
          }
          if (scim.status >= 500) {
            logger.error('SCIM request failed', {
              connectionId: principal?.connectionId,
              path: options.contract.path,
              error,
            })
          }
          return scimErrorResponse(scim)
        } finally {
          if (principal) {
            dependencies.recordRequest({
              principal,
              method: request.method,
              path: options.contract.path,
              status,
              ...(scimType ? { scimType } : {}),
              ...(detail ? { detail } : {}),
              userAgent: request.headers.get('user-agent'),
              durationMs: Date.now() - startedAt,
            })
          }
        }
      },
      {
        /**
         * The terminal envelopes have to speak SCIM too. A provider that receives
         * Sim's `{ error }` shape on an unhandled fault logs an unparsable
         * response, which is materially harder to diagnose than a typed one.
         */
        typedErrorResponse: ({ error, status }) =>
          scimResponse(scimErrorBody(status, undefined, error.message), status),
        unhandledErrorResponse: () =>
          scimResponse(scimErrorBody(500, undefined, 'Internal server error'), 500),
        clientAbortResponse: () => new Response(null, { status: 499 }),
      }
    )
  }
}

/**
 * A discovery route: unauthenticated, static, and identical for every tenant.
 *
 * RFC 7644 requires these to be reachable so a provider can negotiate before it
 * holds a credential, and they disclose only what this server implements.
 */
export function defineScimDiscoveryRoute(
  build: (baseUrl: string, params: Record<string, string | string[] | undefined>) => unknown
): ScimNextRouteHandler {
  return withRouteHandler<ScimRouteContext | undefined>(
    async (request, context) => {
      try {
        if (!isScimDeploymentEnabled()) throw new ScimError(404, undefined, 'Not found')
        if (request.method !== 'GET') {
          throw new ScimError(405, undefined, `${request.method} is not supported here`)
        }
        /** Unauthenticated, so the only admission control available is by address. */
        const limited = await enforceIpRateLimit('scim-discovery', request)
        if (limited) {
          throw new ScimError(429, undefined, 'Rate limit exceeded', {
            'Retry-After': limited.headers.get('Retry-After') ?? '60',
          })
        }
        const params = context?.params ? await context.params : {}
        return scimResponse(build(scimBaseUrl(), params), 200)
      } catch (error) {
        return scimErrorResponse(toScimError(error))
      }
    },
    {
      typedErrorResponse: ({ error, status }) =>
        scimResponse(scimErrorBody(status, undefined, error.message), status),
      unhandledErrorResponse: () =>
        scimResponse(scimErrorBody(500, undefined, 'Internal server error'), 500),
    }
  )
}
