import {
  type AuthorizedWorkspaceUseCaseDefinition,
  defineAuthorizedWorkspaceUseCase,
  type WorkspaceOperation,
} from '@/lib/core/application'
import {
  type TableAuthorizationContext,
  tableDelegationPolicy,
} from '@/lib/table/application/authorization'

type AuthorizedTableUseCaseDefinition<
  O extends WorkspaceOperation,
  I,
  C extends TableAuthorizationContext,
  R,
> = Omit<AuthorizedWorkspaceUseCaseDefinition<O, I, C, R>, 'authorizationOptions'>

export function defineAuthorizedTableUseCase<
  const O extends WorkspaceOperation,
  I,
  C extends TableAuthorizationContext,
  R,
>(definition: AuthorizedTableUseCaseDefinition<O, I, C, R>) {
  return defineAuthorizedWorkspaceUseCase({
    ...definition,
    authorizationOptions: { delegation: tableDelegationPolicy },
  })
}
