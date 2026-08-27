import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import {
  InvalidInternalDelegationTokenError,
  verifyInternalDelegationToken,
} from '@/lib/auth/internal'
import {
  bindInternalExecutorDelegation,
  InvalidInternalDelegationBindingError,
} from '@/lib/auth/internal-delegation'
import { MANAGED_OAUTH_DELEGATION_AUDIENCE } from '@/lib/credentials/application/authorization'

export class InvalidManagedOAuthDelegationError extends Error {
  constructor() {
    super('Managed credential execution requires valid workflow delegation')
    this.name = 'InvalidManagedOAuthDelegationError'
  }
}

/** Authenticates and binds an executor delegation to one managed credential ID. */
export async function authenticateManagedOAuthDelegation(
  authorization: string,
  credentialId: string
): Promise<WorkflowExecutionDelegatedPrincipal> {
  if (!authorization.startsWith('Bearer ')) throw new InvalidManagedOAuthDelegationError()

  try {
    const claims = await verifyInternalDelegationToken(authorization.slice('Bearer '.length))
    return await bindInternalExecutorDelegation(claims, {
      audience: MANAGED_OAUTH_DELEGATION_AUDIENCE,
      resourceScope: { credentialId },
    })
  } catch (error) {
    if (
      error instanceof InvalidInternalDelegationTokenError ||
      error instanceof InvalidInternalDelegationBindingError
    ) {
      throw new InvalidManagedOAuthDelegationError()
    }
    throw error
  }
}
