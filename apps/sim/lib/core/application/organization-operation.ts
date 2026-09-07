import type { Principal } from '@sim/auth/principal'
import type { ApplicationOperation } from '@/lib/core/application/operation'
import { assertOperationCapability } from '@/lib/core/application/operation'

export type OrganizationPrincipal = Extract<
  Principal,
  { kind: 'session' | 'personal_api_key' | 'organization_delegated' }
>

export interface OrganizationOperation extends ApplicationOperation {
  readonly minimumRole: 'member' | 'admin'
  readonly principalKinds: readonly OrganizationPrincipal['kind'][]
  readonly delegationAudience?: string
}

/** Organization authority never borrows a workspace grant or a workspace API key. */
export function defineOrganizationOperation<const O extends OrganizationOperation>(
  operation: O
): O {
  if (
    !operation.principalKinds.length ||
    new Set(operation.principalKinds).size !== operation.principalKinds.length
  ) {
    throw new Error(`Operation ${operation.id} requires distinct allowed principal kinds`)
  }
  if (
    operation.principalKinds.includes('organization_delegated') !==
    Boolean(operation.delegationAudience)
  ) {
    throw new Error(
      `Operation ${operation.id} requires an explicit organization delegation audience`
    )
  }
  assertOperationCapability(operation)
  Object.freeze(operation.principalKinds)
  return Object.freeze(operation)
}
