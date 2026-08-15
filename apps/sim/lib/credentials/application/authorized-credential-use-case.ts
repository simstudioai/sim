import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import {
  type AuthorizedWorkspaceUseCaseDefinition,
  defineAuthorizedWorkspaceUseCase,
  ForbiddenOperationError,
  type WorkspaceAuthorizationContext,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { CredentialActorContext } from '@/lib/credentials/access'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { credentialDelegationPolicy } from '@/lib/credentials/application/authorization'
import type { CredentialOperation } from '@/lib/credentials/application/operations'
import type { CredentialRow } from '@/lib/credentials/queries'

export interface CredentialAuthorizationContext extends WorkspaceAuthorizationContext {
  credential: CredentialRow
  credentialAccess?: CredentialActorContext
}

export class CredentialAccessRequiredError extends OrchestrationError {
  constructor() {
    super('forbidden', 'Credential access required')
    this.name = 'CredentialAccessRequiredError'
  }
}

export function requireCredentialAccess(
  context: CredentialAuthorizationContext
): CredentialActorContext {
  if (!context.credentialAccess) {
    throw new Error('Credential use case executed without resource authorization')
  }
  return context.credentialAccess
}

type AuthorizedCredentialUseCaseDefinition<
  O extends CredentialOperation,
  I,
  C extends CredentialAuthorizationContext,
  R,
> = Omit<
  AuthorizedWorkspaceUseCaseDefinition<O, I, C, R>,
  'authorizationOptions' | 'authorizeResource'
>

export function defineAuthorizedCredentialUseCase<
  const O extends CredentialOperation,
  I,
  C extends CredentialAuthorizationContext,
  R,
>(definition: AuthorizedCredentialUseCaseDefinition<O, I, C, R>) {
  return defineAuthorizedWorkspaceUseCase({
    ...definition,
    authorizationOptions: { delegation: credentialDelegationPolicy },
    async authorizeResource({ principal, context }) {
      const actor = await getCredentialActorContext(
        context.credential.id,
        requirePrincipalSubjectUserId(principal)
      )
      if (
        !actor.credential ||
        actor.credential.workspaceId !== context.workspaceId ||
        !actor.hasWorkspaceAccess
      ) {
        throw new OrchestrationError('not_found', 'Credential not found')
      }
      context.credentialAccess = actor
      switch (definition.operation.minimumCredentialRole) {
        case 'member':
          if (!actor.member && !actor.isAdmin) {
            throw new CredentialAccessRequiredError()
          }
          return
        case 'admin':
          if (!actor.isAdmin) {
            throw new ForbiddenOperationError(
              'CREDENTIAL_ADMIN_ACCESS_REQUIRED',
              'Credential admin permission required'
            )
          }
          return
        default:
          throw new Error(
            `Unsupported credential role: ${definition.operation.minimumCredentialRole}`
          )
      }
    },
  })
}
