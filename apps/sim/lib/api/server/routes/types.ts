import type { Principal } from '@sim/auth/principal'
import type { NextRequest } from 'next/server'
import type {
  AnyApiRouteContract,
  ContractJsonResponse,
  JsonResponseMode,
} from '@/lib/api/contracts'
import type { ParsedRequest } from '@/lib/api/server/validation'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import type { WorkspaceOperation } from '@/lib/workspace-files/application/operations'

export interface JsonRouteContext {
  params?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>
}

export interface OperationUseCase<O extends WorkspaceOperation, I, R> {
  readonly operation: O
  execute(args: {
    principal: Principal
    input: I
    request?: OrchestrationRequestContext
  }): Promise<R>
}

export type JsonApiRouteContract = AnyApiRouteContract & {
  response: JsonResponseMode
}

export interface JsonRouteDefinition<
  C extends JsonApiRouteContract,
  O extends WorkspaceOperation,
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
