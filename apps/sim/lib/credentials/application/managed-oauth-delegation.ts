import {
  type BoundWorkflowExecutionPrincipal,
  requirePrincipalExecutionMetadata,
  type WorkflowExecutionPrincipal,
} from '@sim/auth/principal'
import {
  InvalidInternalDelegationTokenError,
  verifyInternalDelegationToken,
} from '@/lib/auth/internal'
import {
  bindInternalExecutorDelegation,
  bindRuntimeWorkflowExecutionPrincipal,
  InvalidInternalDelegationBindingError,
} from '@/lib/auth/internal-delegation'

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
): Promise<BoundWorkflowExecutionPrincipal> {
  if (!authorization.startsWith('Bearer ')) throw new InvalidManagedOAuthDelegationError()
  if (!credentialId.trim()) throw new InvalidManagedOAuthDelegationError()

  try {
    const claims = await verifyInternalDelegationToken(authorization.slice('Bearer '.length))
    return await bindInternalExecutorDelegation(claims)
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

/** Revalidates the in-process runtime principal before managed credential use. */
export async function bindExecutorManagedOAuthDelegation(
  principal: WorkflowExecutionPrincipal,
  credentialId: string
): Promise<BoundWorkflowExecutionPrincipal> {
  if (!credentialId.trim()) throw new InvalidManagedOAuthDelegationError()
  const executionMetadata = requirePrincipalExecutionMetadata(principal)

  try {
    return await bindRuntimeWorkflowExecutionPrincipal({ ...principal, executionMetadata })
  } catch (error) {
    if (error instanceof InvalidInternalDelegationBindingError) {
      throw new InvalidManagedOAuthDelegationError()
    }
    throw error
  }
}
