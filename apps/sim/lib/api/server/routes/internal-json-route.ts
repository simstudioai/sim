import type { DelegatedPrincipal, Principal, SessionPrincipal } from '@sim/auth/principal'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireJsonRouteDefinition } from '@/lib/api/server/routes/definition'
import type {
  JsonApiRouteContract,
  JsonNextRouteHandler,
  JsonRouteContext,
  JsonRouteDefinition,
} from '@/lib/api/server/routes/types'
import { type ParseRequestOptions, parseRequest } from '@/lib/api/server/validation'
import { getSession } from '@/lib/auth'
import { verifyInternalToken } from '@/lib/auth/internal'
import type { ApplicationOperation } from '@/lib/core/application'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export class InternalUnauthenticatedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
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

export function createInternalSessionOrServiceAuth<P extends DelegatedPrincipal>(
  bindDelegation: (args: {
    subjectUserId: string
    params: Record<string, string | string[] | undefined>
  }) => P
): InternalAuthPolicy<SessionPrincipal | P> {
  return {
    async authenticate(request, params) {
      if (request.headers.has('x-api-key')) {
        throw new InternalUnauthenticatedError('Authentication required')
      }

      const authorization = request.headers.get('authorization')
      if (!authorization?.startsWith('Bearer ')) return internalSessionAuth.authenticate()

      const verification = await verifyInternalToken(authorization.slice('Bearer '.length))
      if (!verification.valid || !verification.userId) {
        throw new InternalUnauthenticatedError('Authentication required')
      }
      return bindDelegation({ subjectUserId: verification.userId, params })
    },
  }
}

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
  unhandled?(): NextResponse
}

export const internalOrchestrationErrorPolicy: InternalErrorPolicy = {
  render(error) {
    const classified = asOrchestrationError(error)
    if (!classified) return null
    return NextResponse.json(
      { success: false, error: classified.message },
      { status: statusForOrchestrationError(classified.code) }
    )
  },
}

export const internalPlainOrchestrationErrorPolicy: InternalErrorPolicy = {
  render(error) {
    const classified = asOrchestrationError(error)
    if (!classified) return null
    return NextResponse.json(
      { error: classified.message },
      { status: statusForOrchestrationError(classified.code) }
    )
  },
  unhandled() {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  },
}

export interface InternalAuthPolicy<P extends Principal> {
  authenticate(
    request: NextRequest,
    params: Record<string, string | string[] | undefined>
  ): Promise<P>
}

interface InternalJsonRouteOptions<
  C extends JsonApiRouteContract,
  O extends ApplicationOperation,
  I,
  R,
  P extends Principal,
> extends JsonRouteDefinition<C, O, I, R> {
  auth: InternalAuthPolicy<P>
  rateLimit: InternalRateLimitPolicy
  errorPolicy: InternalErrorPolicy
  parseOptions?: Omit<ParseRequestOptions, 'validationErrorResponse'>
  beforeParse?(args: {
    request: NextRequest
    principal: P
    params: Record<string, string | string[] | undefined>
  }): void | Promise<void>
  onSuccess?(args: { principal: P; input: I; result: R }): void | Promise<void>
  responseHeaders?(args: { principal: P; input: I; result: R }): HeadersInit
}

export function defineInternalJsonRoute<
  C extends JsonApiRouteContract,
  O extends ApplicationOperation,
  I,
  R,
  P extends Principal,
>(options: InternalJsonRouteOptions<C, O, I, R, P>): JsonNextRouteHandler {
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

      const rawParams = context?.params ? await context.params : {}
      let principal: P
      try {
        principal = await options.auth.authenticate(request, rawParams)
      } catch (error) {
        if (error instanceof InternalUnauthenticatedError) {
          return NextResponse.json({ error: error.message }, { status: 401 })
        }
        throw error
      }

      await options.rateLimit.enforce(request, principal)
      if (options.beforeParse) {
        try {
          await options.beforeParse({ request, principal, params: rawParams })
        } catch (error) {
          const response = options.errorPolicy.render(error)
          if (response) return response
          throw error
        }
      }
      const parsed = await parseRequest(
        options.contract,
        request,
        context ?? {},
        options.parseOptions
      )
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
        return NextResponse.json(validatedBody, {
          status: successStatus,
          headers: options.responseHeaders?.({ principal, input, result }),
        })
      } catch (error) {
        const response = options.errorPolicy.render(error)
        if (response) return response
        throw error
      }
    },
    {
      unhandledErrorResponse: () =>
        options.errorPolicy.unhandled?.() ??
        NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 }),
    }
  )

  return async (request, context) => wrapped(request, context)
}
