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
  present(result: R): ContractJsonResponse<C> | Promise<ContractJsonResponse<C>>
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
