import type {
  DelegatedPrincipal,
  Principal,
  SessionPrincipal,
  WorkflowExecutionDelegatedPrincipal,
} from '@sim/auth/principal'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { ContractJsonResponse } from '@/lib/api/contracts'
import {
  methodMatchesContract,
  requireJsonRouteDefinition,
} from '@/lib/api/server/routes/definition'
import { responseWithRequestId, withRequestId } from '@/lib/api/server/routes/request-id'
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
import {
  asOrchestrationError,
  messageForOrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
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

interface InternalSessionOrExecutorAuthOptions {
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

/**
 * The single internal error envelope: `{ error, requestId? }`.
 *
 * Routes previously chose between a bare `{ error }` and a `{ success: false,
 * error }` variant. That split approximated pre-builder behavior, where the
 * shape depended on which branch failed — guard clauses returned `{ error }`
 * while a route's terminal `try/catch` returned `{ success: false, error }`.
 * A per-route policy cannot express a per-branch rule, so the two variants
 * disagreed on the same status across families. The bare shape wins because it
 * is what {@link messageFromErrorBody} on the client reads and what the
 * majority of migrated routes already emitted.
 *
 * `success: false` is not carried on error bodies: `requestJson` throws an
 * `ApiClientError` for any non-2xx response, so no typed client ever observes
 * the discriminator. `success: true` on *success* bodies is a separate
 * contract and is unaffected.
 */
export const internalOrchestrationErrorPolicy: InternalErrorPolicy = {
  project(error) {
    const classified = asOrchestrationError(error)
    if (!classified) return null
    return internalErrorResponse(statusForOrchestrationError(classified.code), {
      error: messageForOrchestrationError(
        { error: classified.message, errorCode: classified.code },
        'Internal server error'
      ),
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

export interface InternalJsonResponseFinalization {
  bodyFields?: Readonly<Record<string, unknown>>
  headers?: HeadersInit
}

type InternalJsonParseOptions = Pick<
  ParseRequestOptions,
  'maxBodyBytes' | 'validationErrorResponse'
>

/**
 * What a presenter may render from, beyond the use case's result.
 *
 * A surface that serves more than one caller kind can owe them different wire
 * shapes for the same domain result — the internal table row routes answer a
 * session in stable column ids and a workflow execution in column names. That is
 * presentation, not domain, so it belongs in the adapter rather than the use
 * case. {@link InternalJsonRouteOptions.responseHeaders} and
 * {@link InternalJsonRouteOptions.finalizeResponse} already receive this pair;
 * this closes the same gap for `present`.
 */
export interface InternalJsonPresenterContext<I, P extends Principal> {
  principal: P
  input: I
}

type InternalJsonPresentFn<C extends JsonApiRouteContract, I, R, P extends Principal> = (
  result: NoInfer<R>,
  context: InternalJsonPresenterContext<NoInfer<I>, NoInfer<P>>
) => ContractJsonResponse<C> | Promise<ContractJsonResponse<C>>

/** The presenter is optional exactly when the result already is the response body. */
type InternalJsonPresenter<C extends JsonApiRouteContract, I, R, P extends Principal> = [
  R,
] extends [ContractJsonResponse<C>]
  ? { present?: InternalJsonPresentFn<C, I, R, P> }
  : { present: InternalJsonPresentFn<C, I, R, P> }

type InternalJsonRouteOptions<
  C extends JsonApiRouteContract,
  O extends ApplicationOperation,
  I,
  R,
  P extends Principal,
> = {
  contract: C
  operation: O
  mapInput(input: ParsedRequest<C>, context: { principal: P; request: NextRequest }): I | Promise<I>
  useCase: OperationUseCase<NoInfer<O>, I, R>
  auth: InternalAuthPolicy<P>
  rateLimit: InternalRateLimitPolicy
  errorPolicy: InternalErrorPolicy
  parseOptions?: InternalJsonParseOptions
  beforeParse?(args: {
    request: NextRequest
    principal: P
    params: Record<string, string | string[] | undefined>
  }): void | Promise<void>
  onSuccess?(args: { principal: P; input: NoInfer<I>; result: NoInfer<R> }): void | Promise<void>
  statusForResult?(result: NoInfer<R>): number
  responseHeaders?(args: { principal: P; input: NoInfer<I>; result: NoInfer<R> }): HeadersInit
  finalizeResponse?(args: {
    request: NextRequest
    principal: P
    input: NoInfer<I>
    result: NoInfer<R>
    body: ContractJsonResponse<C>
  }): InternalJsonResponseFinalization | Promise<InternalJsonResponseFinalization>
} & InternalJsonPresenter<C, I, R, P>

function createJsonErrorResponse(descriptor: JsonErrorResponseDescriptor): NextResponse {
  return NextResponse.json(withRequestId(descriptor.body), {
    status: descriptor.status,
    headers: descriptor.headers,
  })
}

function appendFinalizedBodyFields(
  body: unknown,
  bodyFields?: Readonly<Record<string, unknown>>
): unknown {
  if (!bodyFields || Object.keys(bodyFields).length === 0) return body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Internal JSON response metadata requires an object response body')
  }
  for (const key of Object.keys(bodyFields)) {
    if (Object.hasOwn(body, key)) {
      throw new Error(`Internal JSON response metadata cannot replace contract field "${key}"`)
    }
  }
  return { ...body, ...bodyFields }
}

function appendFinalizedHeaders(base: HeadersInit | undefined, additions?: HeadersInit): Headers {
  const headers = new Headers(base)
  if (!additions) return headers
  new Headers(additions).forEach((value, key) => {
    if (headers.has(key)) {
      throw new Error(`Internal JSON response finalizer cannot replace header "${key}"`)
    }
    headers.set(key, value)
  })
  return headers
}

export function defineInternalJsonRoute<
  C extends JsonApiRouteContract,
  O extends ApplicationOperation,
  I,
  R,
  P extends Principal,
>(options: InternalJsonRouteOptions<C, O, I, R, P>): JsonNextRouteHandler {
  const { successStatus, successStatuses } = requireJsonRouteDefinition(
    options.contract,
    options.operation,
    options.useCase.operation
  )
  const wrapped = withRouteHandler<JsonRouteContext | undefined>(
    async (request, context) => {
      if (!methodMatchesContract(request.method, options.contract.method)) {
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
          return createJsonErrorResponse(internalErrorResponse(401, { error: error.message }))
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
      if (!parsed.success) return responseWithRequestId(parsed.response)

      try {
        const input = await options.mapInput(parsed.data, { principal, request })
        const result = await options.useCase.execute({
          principal,
          input,
          request,
        })
        await options.onSuccess?.({ principal, input, result })
        const body = options.present ? await options.present(result, { principal, input }) : result
        const responseSchema = options.contract.response
        if (responseSchema.mode !== 'json') {
          throw new Error('Internal JSON route response mode changed after initialization')
        }
        const validatedBody = responseSchema.schema.parse(body) as ContractJsonResponse<C>
        const responseStatus = options.statusForResult?.(result) ?? successStatus
        if (!successStatuses.includes(responseStatus)) {
          throw new Error(
            `Internal JSON route produced undeclared success status ${responseStatus}; expected ${successStatuses.join(', ')}`
          )
        }
        const headers = options.responseHeaders?.({ principal, input, result })
        const finalization = options.finalizeResponse
          ? await options.finalizeResponse({
              request,
              principal,
              input,
              result,
              body: validatedBody,
            })
          : undefined
        return NextResponse.json(
          appendFinalizedBodyFields(validatedBody, finalization?.bodyFields),
          {
            status: responseStatus,
            headers: appendFinalizedHeaders(headers, finalization?.headers),
          }
        )
      } catch (error) {
        const response = options.errorPolicy.project(error)
        if (response) return createJsonErrorResponse(response)
        throw error
      }
    },
    {
      clientAbortResponse: ({ requestId }) =>
        createJsonErrorResponse(
          internalErrorResponse(499, { error: 'Client cancelled request', requestId })
        ),
      typedErrorResponse: ({ error, status, requestId }) =>
        NextResponse.json({ error: error.message, requestId }, { status }),
      unhandledErrorResponse: () =>
        createJsonErrorResponse(
          options.errorPolicy.unhandled?.() ??
            internalErrorResponse(500, { error: 'Internal server error' })
        ),
    }
  )

  return async (request, context) => wrapped(request, context)
}
