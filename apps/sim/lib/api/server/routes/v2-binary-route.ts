import type { NextRequest } from 'next/server'
import {
  methodMatchesContract,
  requireBinaryRouteDefinition,
} from '@/lib/api/server/routes/definition'
import type {
  BinaryApiRouteContract,
  BinaryRouteDefinition,
  JsonNextRouteHandler,
  JsonRouteContext,
} from '@/lib/api/server/routes/types'
import {
  admitV2Request,
  V2_PARSE_DEFAULTS,
  type V2ErrorPolicy,
  type V2RateLimitPolicy,
  V2RouteInfrastructureError,
  type v2ApiKeyAuth,
} from '@/lib/api/server/routes/v2-json-route'
import { parseRequest } from '@/lib/api/server/validation'
import type { ApplicationOperation } from '@/lib/core/application'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { v2Error, v2HeadNoEffect, v2HttpError, v2ValidationError } from '@/app/api/v2/lib/response'

interface V2BinaryRouteOptions<
  C extends BinaryApiRouteContract,
  O extends ApplicationOperation,
  I,
  R,
> extends BinaryRouteDefinition<C, O, I, R> {
  auth: typeof v2ApiKeyAuth
  rateLimit: V2RateLimitPolicy
  errorPolicy: V2ErrorPolicy
  /**
   * Whether this route's `GET` is safe enough for Next's `HEAD`→`GET` aliasing
   * to run it. Defaults to `true`, which is correct for a read.
   *
   * Set `false` when the `GET` opens an outbound connection or writes a row.
   * Such a route still authenticates and rate-limits a `HEAD`, then answers a
   * bodiless 200 without executing the use case — see {@link v2HeadNoEffect}.
   *
   * A binary `GET` is a download, and a download is the archetypal read that
   * records that it happened, so this matters here at least as much as on the
   * JSON builder it mirrors.
   */
  headSafe?: boolean
}

export function defineV2BinaryRoute<
  C extends BinaryApiRouteContract,
  O extends ApplicationOperation,
  I,
  R,
>(options: V2BinaryRouteOptions<C, O, I, R>): JsonNextRouteHandler {
  const { successStatus } = requireBinaryRouteDefinition(
    options.contract,
    options.operation,
    options.useCase.operation
  )

  const wrapped = withRouteHandler<JsonRouteContext | undefined>(
    async (request: NextRequest, context) => {
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

      if (request.method === 'HEAD' && options.headSafe === false) {
        return v2HeadNoEffect()
      }

      const parsed = await parseRequest(options.contract, request, context ?? {}, {
        ...V2_PARSE_DEFAULTS,
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      try {
        const result = await options.useCase.execute({
          principal: admission.auth.principal,
          input: options.mapInput(parsed.data),
          request,
        })
        const descriptor = await options.present(result)
        const headers = new Headers(descriptor.headers)
        headers.set('Content-Type', descriptor.contentType)
        headers.set('Cache-Control', 'private, no-store')
        if (descriptor.contentDisposition) {
          headers.set('Content-Disposition', descriptor.contentDisposition)
        }
        if (descriptor.contentLength !== undefined) {
          headers.set('Content-Length', String(descriptor.contentLength))
        }
        return new Response(descriptor.body, { status: successStatus, headers })
      } catch (error) {
        const response = options.errorPolicy.render(error)
        if (response) return response
        throw error
      }
    },
    {
      typedErrorResponse: ({ error }) => v2HttpError(error),
      unhandledErrorResponse: ({ error }) =>
        error instanceof V2RouteInfrastructureError
          ? v2Error('SERVICE_UNAVAILABLE', 'Service temporarily unavailable')
          : v2Error('INTERNAL_ERROR', 'Internal server error'),
    }
  )

  return async (request, context) => wrapped(request, context)
}
