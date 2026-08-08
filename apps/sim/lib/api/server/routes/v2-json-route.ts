import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { recordRateLimitSnapshot } from '@/lib/api/server/rate-limit-context'
import { requireJsonRouteDefinition } from '@/lib/api/server/routes/definition'
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
import { getRateLimit, RateLimiter, type SubscriptionPlan } from '@/lib/core/rate-limiter'
import { getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { WorkspaceOperation } from '@/lib/workspace-files/application/operations'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CaughtOrchestrationError,
  v2Error,
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
    operation: WorkspaceOperation
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

export interface V2ErrorPolicy {
  render(error: unknown): NextResponse | null
}

export const v2FileErrorPolicies = {
  default: {
    render(error) {
      return v2CaughtOrchestrationError(error)
    },
  } satisfies V2ErrorPolicy,
  concealResourceAuthorization: {
    render(error) {
      const response = v2CaughtOrchestrationError(error)
      if (!response) return null
      if (response.status === 403) return v2Error('NOT_FOUND', 'File not found')
      return response
    },
  } satisfies V2ErrorPolicy,
} as const

export async function admitV2Request(
  request: NextRequest,
  operation: WorkspaceOperation,
  authPolicy: typeof v2ApiKeyAuth,
  rateLimitPolicy: V2RateLimitPolicy
): Promise<
  { success: true; auth: V2ApiKeyAuthContext } | { success: false; response: NextResponse }
> {
  const ip = getClientIp(request)
  const abuseLimit = await rateLimiter.checkRateLimitDirect(
    `v2:preauth:ip:${ip}`,
    V2_PREAUTH_IP_LIMIT,
    { failClosed: true }
  )
  if (!abuseLimit.allowed) {
    return {
      success: false,
      response: v2RateLimitError({ ...abuseLimit, limit: V2_PREAUTH_IP_LIMIT.maxTokens }),
    }
  }

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

interface V2JsonRouteOptions<C extends JsonApiRouteContract, O extends WorkspaceOperation, I, R>
  extends JsonRouteDefinition<C, O, I, R> {
  auth: typeof v2ApiKeyAuth
  rateLimit: V2RateLimitPolicy
  errorPolicy: V2ErrorPolicy
  parseOptions?: Omit<ParseRequestOptions, 'validationErrorResponse'>
  beforeParse?(args: {
    request: NextRequest
    principal: V2ApiKeyAuthContext['principal']
    params: Record<string, string | string[] | undefined>
  }): void | Promise<void>
}

export function defineV2JsonRoute<
  C extends JsonApiRouteContract,
  O extends WorkspaceOperation,
  I,
  R,
>(options: V2JsonRouteOptions<C, O, I, R>): JsonNextRouteHandler {
  const { successStatus } = requireJsonRouteDefinition(
    options.contract,
    options.operation,
    options.useCase.operation
  )

  const wrapped = withRouteHandler<JsonRouteContext | undefined>(
    async (request, context) => {
      if (request.method !== options.contract.method) {
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
        ...options.parseOptions,
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      try {
        const result = await options.useCase.execute({
          principal: auth.principal,
          input: options.mapInput(parsed.data),
          request,
        })
        const body = await options.present(result)
        const responseSchema = options.contract.response
        if (responseSchema.mode !== 'json') {
          throw new Error('V2 JSON route response mode changed after initialization')
        }
        const validatedBody = responseSchema.schema.parse(body)
        return NextResponse.json(validatedBody, {
          status: successStatus,
          headers: { 'Cache-Control': 'private, no-store' },
        })
      } catch (error) {
        const response = options.errorPolicy.render(error)
        if (response) return response
        throw error
      }
    },
    {
      unhandledErrorResponse: ({ error }) =>
        error instanceof V2RouteInfrastructureError
          ? v2Error('SERVICE_UNAVAILABLE', 'Service temporarily unavailable')
          : v2Error('INTERNAL_ERROR', 'Internal server error'),
    }
  )

  return async (request, context) => wrapped(request, context)
}
