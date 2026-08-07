import type { Principal, SessionPrincipal } from '@sim/auth/principal'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireJsonRouteDefinition } from '@/lib/api/server/routes/definition'
import type {
  JsonApiRouteContract,
  JsonNextRouteHandler,
  JsonRouteContext,
  JsonRouteDefinition,
} from '@/lib/api/server/routes/types'
import { parseRequest } from '@/lib/api/server/validation'
import { getSession } from '@/lib/auth'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { WorkspaceOperation } from '@/lib/workspace-files/application/operations'

class InternalUnauthenticatedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'InternalUnauthenticatedError'
  }
}

export const internalSessionAuth = {
  async authenticate(): Promise<SessionPrincipal> {
    const session = await getSession()
    if (!session?.user?.id) throw new InternalUnauthenticatedError()
    const sessionId = session.session?.id
    if (!sessionId) throw new Error('Authenticated session is missing its session ID')
    return { kind: 'session', userId: session.user.id, sessionId }
  },
} as const

interface InternalRateLimitPolicy {
  readonly kind: 'none'
  readonly reason: string
  enforce(request: NextRequest, principal: Principal): Promise<void>
}

export const internalRateLimits = {
  none({ reason }: { reason: string }): InternalRateLimitPolicy {
    if (!reason.trim()) throw new Error('A rate-limit exemption reason is required')
    return {
      kind: 'none',
      reason,
      async enforce() {},
    }
  },
} as const

export interface InternalErrorPolicy {
  render(error: unknown): NextResponse | null
}

export const internalFileErrorPolicy: InternalErrorPolicy = {
  render(error) {
    const classified = asOrchestrationError(error)
    if (!classified) return null
    return NextResponse.json(
      { success: false, error: classified.message },
      { status: statusForOrchestrationError(classified.code) }
    )
  },
}

interface InternalJsonRouteOptions<
  C extends JsonApiRouteContract,
  O extends WorkspaceOperation,
  I,
  R,
> extends JsonRouteDefinition<C, O, I, R> {
  auth: typeof internalSessionAuth
  rateLimit: InternalRateLimitPolicy
  errorPolicy: InternalErrorPolicy
  onSuccess?(args: { principal: SessionPrincipal; input: I; result: R }): void | Promise<void>
}

export function defineInternalJsonRoute<
  C extends JsonApiRouteContract,
  O extends WorkspaceOperation,
  I,
  R,
>(options: InternalJsonRouteOptions<C, O, I, R>): JsonNextRouteHandler {
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
        const result = await options.useCase.execute({
          principal,
          input,
          request,
        })
        await options.onSuccess?.({ principal, input, result })
        const body = await options.present(result)
        const responseSchema = options.contract.response
        if (responseSchema.mode !== 'json') {
          throw new Error('Internal JSON route response mode changed after initialization')
        }
        const validatedBody = responseSchema.schema.parse(body)
        return NextResponse.json(validatedBody, { status: successStatus })
      } catch (error) {
        const response = options.errorPolicy.render(error)
        if (response) return response
        throw error
      }
    },
    {
      unhandledErrorResponse: () =>
        NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 }),
    }
  )

  return async (request, context) => wrapped(request, context)
}
