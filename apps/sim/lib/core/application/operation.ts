import type { Principal } from '@sim/auth/principal'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'

export interface ApplicationOperation<Id extends string = string> {
  readonly id: Id
}

export interface OperationUseCase<O extends ApplicationOperation, I, R> {
  readonly operation: O
  execute(args: {
    principal: Principal
    input: I
    request?: OrchestrationRequestContext
  }): Promise<R>
}
