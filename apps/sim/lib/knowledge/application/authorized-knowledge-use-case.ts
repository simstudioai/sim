import {
  type AuthorizedWorkspaceUseCaseDefinition,
  defineAuthorizedWorkspaceUseCase,
  type WorkspaceOperation,
} from '@/lib/core/application'
import {
  type KnowledgeAuthorizationContext,
  knowledgeDelegationPolicy,
} from '@/lib/knowledge/application/authorization'

type AuthorizedKnowledgeUseCaseDefinition<
  O extends WorkspaceOperation,
  I,
  C extends KnowledgeAuthorizationContext,
  R,
> = Omit<AuthorizedWorkspaceUseCaseDefinition<O, I, C, R>, 'authorizationOptions'>

export function defineAuthorizedKnowledgeUseCase<
  const O extends WorkspaceOperation,
  I,
  C extends KnowledgeAuthorizationContext,
  R,
>(definition: AuthorizedKnowledgeUseCaseDefinition<O, I, C, R>) {
  return defineAuthorizedWorkspaceUseCase({
    ...definition,
    authorizationOptions: { delegation: knowledgeDelegationPolicy },
  })
}
