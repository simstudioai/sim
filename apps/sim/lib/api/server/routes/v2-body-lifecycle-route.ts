import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { ContractJsonResponse } from '@/lib/api/contracts'
import {
  methodMatchesContract,
  requireJsonRouteDefinition,
} from '@/lib/api/server/routes/definition'
import type {
  JsonApiRouteContract,
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
import {
  type ParsedRequest,
  type ParseRequestOptions,
  parseRequest,
} from '@/lib/api/server/validation'
import type { ApplicationOperation, OperationUseCase } from '@/lib/core/application'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { v2Error, v2HttpError, v2ValidationError } from '@/app/api/v2/lib/response'

interface V2BodyLifecycleAdmission<
  O extends ApplicationOperation,
  C extends JsonApiRouteContract,
  I,
  R,
> {
  mapInput(input: ParsedRequest<C>): I
  useCase: OperationUseCase<NoInfer<O>, I, R>
}

interface V2BodyLifecycleContext<C extends JsonApiRouteContract, A> {
  request: NextRequest
  principal: Awaited<ReturnType<typeof v2ApiKeyAuth.authenticate>>['principal']
  parsed: ParsedRequest<C>
  admission: A
}

interface V2BodyLifecycleInputContext<C extends JsonApiRouteContract, A, B>
  extends V2BodyLifecycleContext<C, A> {
  body: B
}

interface V2BodyLifecycleSuccessContext<C extends JsonApiRouteContract, A, B, I, R>
  extends V2BodyLifecycleInputContext<C, A, B> {
  input: I
  result: R
}

interface V2BodyLifecycleRouteOptions<
  C extends JsonApiRouteContract,
  O extends ApplicationOperation,
  AI,
  A,
  B,
  I,
  R,
> {
  contract: C
  operation: O
  auth: typeof v2ApiKeyAuth
  rateLimit: V2RateLimitPolicy
  errorPolicy: V2ErrorPolicy
  parseOptions?: Omit<ParseRequestOptions, 'validationErrorResponse'>
  admission: V2BodyLifecycleAdmission<O, C, AI, A>
  readBody(context: V2BodyLifecycleContext<C, A>): Promise<B>
  mapInput(context: V2BodyLifecycleInputContext<C, A, B>): I
  useCase: OperationUseCase<NoInfer<O>, I, R>
  present(result: R): ContractJsonResponse<C> | Promise<ContractJsonResponse<C>>
  onSuccess?(
    context: V2BodyLifecycleSuccessContext<C, A, B, NoInfer<I>, NoInfer<R>>
  ): void | Promise<void>
}

/**
 * Defines a v2 route whose body must not be read until an application use case
 * has completed cheap canonical admission. The contract intentionally omits a
 * body schema because the bounded byte-plane reader owns that non-JSON payload.
 */
export function defineV2BodyLifecycleRoute<
  C extends JsonApiRouteContract,
  O extends ApplicationOperation,
  AI,
  A,
  B,
  I,
  R,
>(options: V2BodyLifecycleRouteOptions<C, O, AI, A, B, I, R>): JsonNextRouteHandler {
  if (options.contract.body) {
    throw new Error(
      `${options.contract.method} ${options.contract.path} must omit its body schema so admission precedes body reads`
    )
  }
  const { successStatus, successStatuses } = requireJsonRouteDefinition(
    options.contract,
    options.operation,
    options.useCase.operation
  )
  requireJsonRouteDefinition(
    options.contract,
    options.operation,
    options.admission.useCase.operation
  )
  if (successStatuses.length !== 1) {
    throw new Error(
      `${options.contract.method} ${options.contract.path} body lifecycle route requires one success status`
    )
  }

  const wrapped = withRouteHandler<JsonRouteContext | undefined>(
    async (request, context) => {
      if (!methodMatchesContract(request.method, options.contract.method)) {
        throw new Error(
          `Route received ${request.method} for ${options.contract.method} contract ${options.contract.path}`
        )
      }

      const routeAdmission = await admitV2Request(
        request,
        options.operation,
        options.auth,
        options.rateLimit
      )
      if (!routeAdmission.success) return routeAdmission.response

      const parsed = await parseRequest(options.contract, request, context ?? {}, {
        ...V2_PARSE_DEFAULTS,
        ...options.parseOptions,
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { principal } = routeAdmission.auth
      try {
        const admissionInput = options.admission.mapInput(parsed.data)
        const admission = await options.admission.useCase.execute({
          principal,
          input: admissionInput,
          request,
        })
        const lifecycleContext = { request, principal, parsed: parsed.data, admission }
        const body = await options.readBody(lifecycleContext)
        const inputContext = { ...lifecycleContext, body }
        const input = options.mapInput(inputContext)
        const result = await options.useCase.execute({ principal, input, request })
        const responseBody = options.contract.response.schema.parse(await options.present(result))
        await options.onSuccess?.({ ...inputContext, input, result })
        return NextResponse.json(responseBody, {
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
      typedErrorResponse: ({ error }) => v2HttpError(error),
      unhandledErrorResponse: ({ error }) =>
        error instanceof V2RouteInfrastructureError
          ? v2Error('SERVICE_UNAVAILABLE', 'Service temporarily unavailable')
          : v2Error('INTERNAL_ERROR', 'Internal server error'),
    }
  )

  return async (request, context) => wrapped(request, context)
}
