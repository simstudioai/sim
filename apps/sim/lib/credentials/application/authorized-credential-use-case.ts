import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import {
  type AuthorizedWorkspaceUseCaseDefinition,
  defineAuthorizedWorkspaceUseCase,
  ForbiddenOperationError,
  type WorkspaceAuthorizationContext,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getCredentialActorContext } from '@/lib/credentials/access'
import type { CredentialAdminOperation } from '@/lib/credentials/application/operations'
import type { CredentialRow } from '@/lib/credentials/queries'

export interface CredentialAuthorizationContext extends WorkspaceAuthorizationContext {
  credential: CredentialRow
}

type AuthorizedCredentialUseCaseDefinition<
  O extends CredentialAdminOperation,
  I,
  C extends CredentialAuthorizationContext,
  R,
> = Omit<
  AuthorizedWorkspaceUseCaseDefinition<O, I, C, R>,
  'authorizationOptions' | 'authorizeResource'
>

export function defineAuthorizedCredentialUseCase<
  const O extends CredentialAdminOperation,
  I,
  C extends CredentialAuthorizationContext,
  R,
>(definition: AuthorizedCredentialUseCaseDefinition<O, I, C, R>) {
  return defineAuthorizedWorkspaceUseCase({
    ...definition,
    authorizationOptions: {},
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
      switch (definition.operation.minimumCredentialRole) {
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
