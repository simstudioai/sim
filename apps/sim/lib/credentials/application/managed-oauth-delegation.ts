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
import { createExecutorPrincipalFromDelegationOrigin } from '@/lib/internal/principals/executor'
import type { ExecutorDelegationOrigin } from '@/executor/types'

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

/**
 * In-process sibling of {@link authenticateManagedOAuthDelegation}: binds the
 * executor's own delegation origin to one managed credential without minting and
 * re-verifying a delegation JWT — see {@link createExecutorPrincipalFromDelegationOrigin}
 * for why that loses nothing.
 */
export async function bindExecutorManagedOAuthDelegation(
  origin: ExecutorDelegationOrigin,
  credentialId: string
): Promise<WorkflowExecutionDelegatedPrincipal> {
  if (!origin.currentWorkflow) {
    throw new Error('Managed credential delegation is missing current workflow authority')
  }

  try {
    return await createExecutorPrincipalFromDelegationOrigin(
      origin,
      MANAGED_OAUTH_DELEGATION_AUDIENCE,
      { credentialId }
    )
  } catch (error) {
    if (error instanceof InvalidInternalDelegationBindingError) {
      throw new InvalidManagedOAuthDelegationError()
    }
    throw error
  }
}
