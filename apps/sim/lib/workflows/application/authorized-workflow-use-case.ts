import {
  type AuthorizedWorkspaceUseCaseDefinition,
  defineAuthorizedWorkspaceUseCase,
  type WorkspaceOperation,
} from '@/lib/core/application'
import {
  type WorkflowAuthorizationContext,
  workflowDelegationPolicy,
} from '@/lib/workflows/application/authorization'

type AuthorizedWorkflowUseCaseDefinition<
  O extends WorkspaceOperation,
  I,
  C extends WorkflowAuthorizationContext,
  R,
> = Omit<AuthorizedWorkspaceUseCaseDefinition<O, I, C, R>, 'authorizationOptions'>

export function defineAuthorizedWorkflowUseCase<
  const O extends WorkspaceOperation,
  I,
  C extends WorkflowAuthorizationContext,
  R,
>(definition: AuthorizedWorkflowUseCaseDefinition<O, I, C, R>) {
  return defineAuthorizedWorkspaceUseCase({
    ...definition,
    authorizationOptions: { delegation: workflowDelegationPolicy },
  })
}
