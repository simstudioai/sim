import {
  type AuthorizedWorkspaceUseCaseDefinition,
  defineAuthorizedWorkspaceUseCase,
  type WorkspaceOperation,
} from '@/lib/core/application'
import {
  type WorkspaceFileAuthorizationContext,
  workspaceFileDelegationPolicy,
} from '@/lib/workspace-files/application/authorization'

type AuthorizedWorkspaceFileUseCaseDefinition<
  O extends WorkspaceOperation,
  I,
  C extends WorkspaceFileAuthorizationContext,
  R,
> = Omit<AuthorizedWorkspaceUseCaseDefinition<O, I, C, R>, 'authorizationOptions'>

export function defineAuthorizedWorkspaceFileUseCase<
  const O extends WorkspaceOperation,
  I,
  C extends WorkspaceFileAuthorizationContext,
  R,
>(definition: AuthorizedWorkspaceFileUseCaseDefinition<O, I, C, R>) {
  return defineAuthorizedWorkspaceUseCase({
    ...definition,
    authorizationOptions: { delegation: workspaceFileDelegationPolicy },
  })
}
