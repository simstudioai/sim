import type { Principal } from '@sim/auth/principal'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'

export interface ApplicationOperation<Id extends string = string> {
  readonly id: Id
}

/**
 * Every principal kind an operation can name. `credential_group_enrollment`
 * authenticates one enrollment flow, while `system` is an infrastructure-owned
 * workflow execution identity; neither performs a semantic resource operation.
 */
export type PrincipalKind = Exclude<
  Principal['kind'],
  'credential_group_enrollment' | 'system'
>

/**
 * A principal kind a non-workspace operation may name. `delegated` is excluded
 * on purpose: a delegated principal is only meaningful alongside a
 * `delegatedServices` policy and the workspace, audience, and expiry re-checks
 * that {@link defineWorkspaceOperation} exists to carry. An operation that needs
 * delegation is a workspace operation.
 */
export type UndelegatedPrincipalKind = Exclude<PrincipalKind, 'delegated'>

/**
 * An operation with no workspace scope and therefore no role, whose whole
 * authorization story is which kinds of principal may perform it.
 *
 * Rare by design — `/api/v2/meta` is the only one, because its resource *is*
 * the credential the caller has already proved it holds. It exists so such an
 * operation still declares its policy as data rather than leaving it implicit
 * in whichever surface happens to call it.
 */
export interface PrincipalScopedOperation<
  Id extends string = string,
  PrincipalKinds extends readonly UndelegatedPrincipalKind[] = readonly UndelegatedPrincipalKind[],
> extends ApplicationOperation<Id> {
  readonly principalKinds: PrincipalKinds
}

export function defineOperation<
  const Id extends string,
  const PrincipalKinds extends readonly UndelegatedPrincipalKind[],
>(
  operation: PrincipalScopedOperation<Id, PrincipalKinds>
): PrincipalScopedOperation<Id, PrincipalKinds> {
  if (operation.principalKinds.length === 0) {
    throw new Error(`Operation ${operation.id} must allow at least one principal kind`)
  }
  if (new Set(operation.principalKinds).size !== operation.principalKinds.length) {
    throw new Error(`Operation ${operation.id} declares duplicate principal kinds`)
  }
  Object.freeze(operation.principalKinds)
  Object.freeze(operation)
  return operation
}

/**
 * Narrows a principal to the kinds its operation names.
 *
 * A mismatch throws a plain invariant error, not a `forbidden` one, and the
 * distinction is deliberate: a principal-scoped operation is reachable from a
 * single authenticating surface whose adapter can only ever construct the kinds
 * the operation names, so a mismatch is a wiring bug rather than a refusal any
 * caller can provoke. Rendering it as a `403` would publish a wire status no
 * request can reach — and a codeless one, since the closed
 * `FORBIDDEN_DETAIL_CODES` vocabulary describes remedies a caller can act on.
 */
export function assertOperationPrincipal<O extends PrincipalScopedOperation>(
  principal: Principal,
  operation: O
): asserts principal is Extract<Principal, { kind: O['principalKinds'][number] }> {
  if (!operation.principalKinds.some((kind) => kind === principal.kind)) {
    throw new Error(
      `Operation ${operation.id} reached by principal kind ${principal.kind}, which its policy does not name`
    )
  }
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
