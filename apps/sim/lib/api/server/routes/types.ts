import type { NextRequest } from 'next/server'
import type {
  AnyApiRouteContract,
  BinaryResponseMode,
  ContractJsonResponse,
  JsonResponseMode,
} from '@/lib/api/contracts'
import type { ParsedRequest } from '@/lib/api/server/validation'
import type { ApplicationOperation, OperationUseCase } from '@/lib/core/application'

export interface JsonRouteContext {
  params?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>
}

export type JsonApiRouteContract = AnyApiRouteContract & {
  response: JsonResponseMode
}

export type BinaryApiRouteContract = AnyApiRouteContract & {
  response: BinaryResponseMode
}

export interface BinaryResponseDescriptor {
  body: BodyInit
  contentType: string
  contentDisposition?: string
  contentLength?: number
  headers?: HeadersInit
}

export interface JsonErrorResponseDescriptor {
  body: unknown
  status: number
  headers?: HeadersInit
}

export interface JsonRouteDefinition<
  C extends JsonApiRouteContract,
  O extends ApplicationOperation,
  I,
  R,
> {
  contract: C
  operation: O
  mapInput(input: ParsedRequest<C>): I
  useCase: OperationUseCase<NoInfer<O>, I, R>
  /**
   * Renders the surface body. The parsed request is passed alongside the result
   * so a presenter can read the request's own params without the use case
   * having to carry them back out.
   *
   * That second argument exists for pagination: a `nextCursor` is stamped with
   * the sort and filters the page was read under, and those live in the query,
   * not in the domain result. Threading them through the use case instead would
   * make an application service carry an HTTP cursor-encoding concern purely so
   * the presenter can see it again.
   */
  present(
    result: R,
    request: ParsedRequest<C>
  ): ContractJsonResponse<C> | Promise<ContractJsonResponse<C>>
}

export type JsonNextRouteHandler = (
  request: NextRequest,
  context?: JsonRouteContext
) => Promise<Response>

export interface BinaryRouteDefinition<
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
