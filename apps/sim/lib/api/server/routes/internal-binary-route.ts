import type { Principal, SessionPrincipal } from '@sim/auth/principal'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireBinaryRouteDefinition } from '@/lib/api/server/routes/definition'
import {
  InternalUnauthenticatedError,
  type internalSessionAuth,
} from '@/lib/api/server/routes/internal-json-route'
import type {
  BinaryApiRouteContract,
  BinaryResponseDescriptor,
  JsonNextRouteHandler,
  JsonRouteContext,
} from '@/lib/api/server/routes/types'
import type { ParsedRequest } from '@/lib/api/server/validation'
import { parseRequest } from '@/lib/api/server/validation'
import type { ApplicationOperation, OperationUseCase } from '@/lib/core/application'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

interface InternalBinaryRateLimitPolicy {
  readonly kind: 'none'
  readonly reason: string
  enforce(request: NextRequest, principal: Principal): Promise<void>
}

interface InternalBinaryErrorPolicy {
  render(error: unknown): NextResponse | null
}

interface InternalBinaryRouteDefinition<
  C extends BinaryApiRouteContract,
  O extends ApplicationOperation,
  I,
  R,
> {
  contract: C
  operation: O
  mapInput(input: ParsedRequest<C>): I
  useCase: OperationUseCase<NoInfer<O>, I, R>
  present(result: R): BinaryResponseDescriptor | Promise<BinaryResponseDescriptor>
}

interface InternalBinaryRouteOptions<
  C extends BinaryApiRouteContract,
  O extends ApplicationOperation,
  I,
  R,
> extends InternalBinaryRouteDefinition<C, O, I, R> {
  auth: typeof internalSessionAuth
  rateLimit: InternalBinaryRateLimitPolicy
  errorPolicy: InternalBinaryErrorPolicy
  onSuccess?(args: { principal: SessionPrincipal; input: I; result: R }): void | Promise<void>
}

/**
 * Defines an authenticated internal binary route, including streamed responses.
 *
 * The descriptor keeps storage and archive details out of the route handler while
 * allowing a use-case presenter to return a Web Stream without buffering it.
 */
export function defineInternalBinaryRoute<
  C extends BinaryApiRouteContract,
  O extends ApplicationOperation,
  I,
  R,
>(options: InternalBinaryRouteOptions<C, O, I, R>): JsonNextRouteHandler {
  const { successStatus } = requireBinaryRouteDefinition(
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

      let principal: SessionPrincipal
      try {
        principal = await options.auth.authenticate()
      } catch (error) {
        if (error instanceof InternalUnauthenticatedError) {
          return NextResponse.json({ error: error.message }, { status: 401 })
        }
        throw error
      }

      await options.rateLimit.enforce(request, principal)
      const parsed = await parseRequest(options.contract, request, context ?? {})
      if (!parsed.success) return parsed.response

      try {
        const input = options.mapInput(parsed.data)
        const result = await options.useCase.execute({ principal, input, request })
        const descriptor = await options.present(result)
        await options.onSuccess?.({ principal, input, result })
        const headers = new Headers(descriptor.headers)
        headers.set('Content-Type', descriptor.contentType)
        if (descriptor.contentDisposition) {
          headers.set('Content-Disposition', descriptor.contentDisposition)
        }
        if (descriptor.contentLength !== undefined) {
          headers.set('Content-Length', String(descriptor.contentLength))
        }
        return new NextResponse(descriptor.body, { status: successStatus, headers })
      } catch (error) {
        const response = options.errorPolicy.render(error)
        if (response) return response
        throw error
      }
    },
    {
      unhandledErrorResponse: () =>
        NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
    }
  )

  return async (request, context) => wrapped(request, context)
}
