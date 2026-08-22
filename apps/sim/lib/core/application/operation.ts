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
  /**
   * Runs everything {@link execute} does up to and including resource
   * authorization, then stops — allowed-principal check, canonical load,
   * asserted-scope comparison, current workspace access check, resource access
   * check — but not the business transaction, the audit projection, or the
   * after-success effects.
   *
   * It exists for one caller: a surface that must answer *"would this principal
   * be allowed?"* without causing what the answer would cause. `HEAD` on a route
   * whose `GET` is not safe is that surface — see the `headSafe` option on the
   * v2 route builders for why answering it any earlier leaks an existence
   * oracle.
   *
   * Optional because most use cases have no such caller; the v2 builders reject
   * a `headSafe: false` route that omits it at definition time.
   */
  authorize?(args: {
    principal: Principal
    input: I
    request?: OrchestrationRequestContext
  }): Promise<void>
}
