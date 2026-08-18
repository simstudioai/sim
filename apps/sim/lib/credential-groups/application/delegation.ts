import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import {
  InvalidInternalDelegationTokenError,
  verifyInternalDelegationToken,
} from '@/lib/auth/internal'
import {
  bindInternalExecutorDelegation,
  InvalidInternalDelegationBindingError,
} from '@/lib/auth/internal-delegation'
import { CREDENTIAL_GROUP_DELEGATION_AUDIENCE } from '@/lib/credential-groups/application/authorization'

export class InvalidCredentialGroupDelegationError extends Error {
  constructor() {
    super('Credential Group execution requires valid workflow delegation')
    this.name = 'InvalidCredentialGroupDelegationError'
  }
}

/** Authenticates and binds executor claims to Credential Group application scope. */
export async function authenticateCredentialGroupDelegation(
  authorization: string,
  credentialGroupId?: string
): Promise<WorkflowExecutionDelegatedPrincipal> {
  if (!authorization.startsWith('Bearer ')) throw new InvalidCredentialGroupDelegationError()

  try {
    const claims = await verifyInternalDelegationToken(authorization.slice('Bearer '.length))
    return await bindInternalExecutorDelegation(claims, {
      audience: CREDENTIAL_GROUP_DELEGATION_AUDIENCE,
      ...(credentialGroupId ? { resourceScope: { credentialGroupId } } : {}),
    })
  } catch (error) {
    if (
      error instanceof InvalidInternalDelegationTokenError ||
      error instanceof InvalidInternalDelegationBindingError
    ) {
      throw new InvalidCredentialGroupDelegationError()
    }
    throw error
  }
}
