import type {
  DelegatedPrincipal,
  Principal,
  SessionPrincipal,
  WorkflowExecutionDelegatedPrincipal,
} from '@sim/auth/principal'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { ContractJsonResponse } from '@/lib/api/contracts'
import { requireJsonRouteDefinition } from '@/lib/api/server/routes/definition'
import type {
  JsonApiRouteContract,
  JsonErrorResponseDescriptor,
  JsonNextRouteHandler,
  JsonRouteContext,
} from '@/lib/api/server/routes/types'
import {
  type ParsedRequest,
  type ParseRequestOptions,
  parseRequest,
} from '@/lib/api/server/validation'
import { getSession } from '@/lib/auth'
import {
  InvalidInternalDelegationTokenError,
  verifyInternalDelegationToken,
} from '@/lib/auth/internal'
import {
  bindInternalExecutorDelegation,
  InvalidInternalDelegationBindingError,
} from '@/lib/auth/internal-delegation'
import type { ApplicationOperation, OperationUseCase } from '@/lib/core/application'
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

export interface InternalSessionOrExecutorAuthOptions {
  audience: string
  resourceScope?(
    params: Record<string, string | string[] | undefined>
  ): DelegatedPrincipal['resourceScope']
}

export function createInternalSessionOrExecutorAuth(
  options: InternalSessionOrExecutorAuthOptions
): InternalAuthPolicy<SessionPrincipal | WorkflowExecutionDelegatedPrincipal> {
  if (!options.audience.trim()) throw new Error('Internal executor auth audience must not be empty')

  return {
    async authenticate(request, params) {
      if (request.headers.has('x-api-key')) {
        throw new InternalUnauthenticatedError('Authentication required')
      }

      const authorization = request.headers.get('authorization')
      if (!authorization) return internalSessionAuth.authenticate()
      if (!authorization.startsWith('Bearer ')) {
        throw new InternalUnauthenticatedError('Authentication required')
      }

      let delegation
      try {
        delegation = await verifyInternalDelegationToken(authorization.slice('Bearer '.length))
      } catch (error) {
        if (!(error instanceof InvalidInternalDelegationTokenError)) throw error
        throw new InternalUnauthenticatedError('Authentication required')
      }

      try {
        return await bindInternalExecutorDelegation(delegation, {
          audience: options.audience,
          resourceScope: options.resourceScope?.(params),
        })
      } catch (error) {
        if (!(error instanceof InvalidInternalDelegationBindingError)) throw error
        throw new InternalUnauthenticatedError('Authentication required')
      }
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
  project(error: unknown): JsonErrorResponseDescriptor | null
  unhandled?(): JsonErrorResponseDescriptor
}

export const internalOrchestrationErrorPolicy: InternalErrorPolicy = {
  project(error) {
    const classified = asOrchestrationError(error)
    if (!classified) return null
    return internalErrorResponse(statusForOrchestrationError(classified.code), {
      success: false,
      error: classified.message,
    })
  },
}

export const internalPlainOrchestrationErrorPolicy: InternalErrorPolicy = {
  project(error) {
    const classified = asOrchestrationError(error)
    if (!classified) return null
    return internalErrorResponse(statusForOrchestrationError(classified.code), {
      error: classified.message,
    })
  },
  unhandled() {
    return internalErrorResponse(500, { error: 'Internal server error' })
  },
}

export function internalErrorResponse(
  status: number,
  body: unknown,
  headers?: HeadersInit
): JsonErrorResponseDescriptor {
  if (!Number.isInteger(status) || status < 400 || status >= 600) {
    throw new Error(`Internal error responses require a 4xx or 5xx status, received ${status}`)
  }
  return { body, status, headers }
}

export function extendInternalErrorPolicy(
  base: InternalErrorPolicy,
  project: (error: unknown) => JsonErrorResponseDescriptor | null
): InternalErrorPolicy {
  return {
    project(error) {
      return project(error) ?? base.project(error)
    },
    unhandled: base.unhandled,
  }
}

export const internalJsonPresenters = {
  withSuccess<R extends object>(result: R) {
    return { ...result, success: true as const }
  },
  successFrom<K extends string>(key: K) {
    return <R extends Record<K, boolean>>(result: R) => ({ success: result[key] })
  },
} as const

export interface InternalAuthPolicy<P extends Principal> {
  authenticate(
    request: NextRequest,
    params: Record<string, string | string[] | undefined>
  ): Promise<P>
}

type InternalJsonPresenter<C extends JsonApiRouteContract, R> = [R] extends [
  ContractJsonResponse<C>,
]
  ? {
      present?(result: NoInfer<R>): ContractJsonResponse<C> | Promise<ContractJsonResponse<C>>
    }
  : {
      present(result: NoInfer<R>): ContractJsonResponse<C> | Promise<ContractJsonResponse<C>>
    }

type InternalJsonRouteOptions<
  C extends JsonApiRouteContract,
  O extends ApplicationOperation,
  I,
  R,
  P extends Principal,
> = {
  contract: C
  operation: O
  mapInput(input: ParsedRequest<C>): I
  useCase: OperationUseCase<NoInfer<O>, I, R>
  auth: InternalAuthPolicy<P>
  rateLimit: InternalRateLimitPolicy
  errorPolicy: InternalErrorPolicy
  parseOptions?: Omit<ParseRequestOptions, 'validationErrorResponse'>
  beforeParse?(args: {
    request: NextRequest
    principal: P
    params: Record<string, string | string[] | undefined>
  }): void | Promise<void>
  onSuccess?(args: { principal: P; input: NoInfer<I>; result: NoInfer<R> }): void | Promise<void>
  responseHeaders?(args: { principal: P; input: NoInfer<I>; result: NoInfer<R> }): HeadersInit
} & InternalJsonPresenter<C, R>

function createJsonErrorResponse(descriptor: JsonErrorResponseDescriptor): NextResponse {
  return NextResponse.json(descriptor.body, {
    status: descriptor.status,
    headers: descriptor.headers,
  })
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
          const response = options.errorPolicy.project(error)
          if (response) return createJsonErrorResponse(response)
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
        const body = options.present ? await options.present(result) : result
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
        const response = options.errorPolicy.project(error)
        if (response) return createJsonErrorResponse(response)
        throw error
      }
    },
    {
      unhandledErrorResponse: () =>
        createJsonErrorResponse(
          options.errorPolicy.unhandled?.() ??
            internalErrorResponse(500, {
              success: false,
              error: 'Internal server error',
            })
        ),
    }
  )

  return async (request, context) => wrapped(request, context)
}
