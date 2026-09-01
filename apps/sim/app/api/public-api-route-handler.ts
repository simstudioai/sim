import type { NextRequest, NextResponse } from 'next/server'
import type { AnyApiRouteContract } from '@/lib/api/contracts'
import { type ParsedRequest, type ParseRequestOptions, parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { type ApiEndpoint, type AuthorizedRequest, checkRateLimit } from '@/app/api/v1/middleware'
import { v2Error, v2RateLimitError, v2ValidationError } from '@/app/api/v2/lib/response'

interface PublicApiRouteContext {
  params?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>
}

interface PublicApiRouteHandlerArguments<C extends AnyApiRouteContract> {
  request: NextRequest
  input: ParsedRequest<C>
  auth: AuthorizedRequest
}

interface PublicApiRouteHandlerOptions<C extends AnyApiRouteContract> {
  contract: C
  rateLimitEndpoint: ApiEndpoint
  parseOptions?: ParseRequestOptions
  handler: (
    arguments_: PublicApiRouteHandlerArguments<C>
  ) => Promise<NextResponse | Response> | NextResponse | Response
}

type PublicApiNextRouteHandler = (
  request: NextRequest,
  context?: PublicApiRouteContext
) => Promise<NextResponse | Response>

/**
 * Wraps an API-key-authenticated public route with request context, rate
 * limiting, authentication, and contract parsing before invoking the route's
 * authorization and business logic. Unexpected endpoint errors are logged once
 * by the shared route handler and rendered as the canonical v2 500 envelope.
 */
export function withPublicApiRouteHandler<C extends AnyApiRouteContract>({
  contract,
  rateLimitEndpoint,
  parseOptions,
  handler,
}: PublicApiRouteHandlerOptions<C>): PublicApiNextRouteHandler {
  const wrapped = withRouteHandler<PublicApiRouteContext | undefined>(
    async (request, context) => {
      const requestId = generateRequestId()
      const rateLimit = await checkRateLimit(request, rateLimitEndpoint)
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      if (!rateLimit.userId) {
        throw new Error('Allowed public API request is missing a user ID')
      }
      const userId = rateLimit.userId

      const parsed = await parseRequest(contract, request, context ?? {}, {
        validationErrorResponse: v2ValidationError,
        ...parseOptions,
      })
      if (!parsed.success) return parsed.response

      return handler({
        request,
        input: parsed.data,
        auth: { requestId, userId, rateLimit },
      })
    },
    {
      unhandledErrorResponse: () => v2Error('INTERNAL_ERROR', 'Internal server error'),
    }
  )

  return async (request, context) => wrapped(request, context)
}
