export {
  type AuthorizedWorkspaceUseCaseContext,
  type AuthorizedWorkspaceUseCaseDefinition,
  type AuthorizedWorkspaceUseCaseResultContext,
  defineAuthorizedWorkspaceUseCase,
  recordProjectedUseCaseAuditEntries,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application/authorized-workspace-use-case'
export type {
  ApplicationOperation,
  OperationUseCase,
} from '@/lib/core/application/operation'
export type {
  WorkspaceAuthorizationContext,
  WorkspaceAuthorizationOptions,
  WorkspaceDelegationPolicy,
} from '@/lib/core/application/workspace-authorization'
export {
  authorizeWorkspaceOperation,
  DelegatedServiceAuthorizationError,
  DelegatedWorkspaceAuthorizationError,
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  PersonalApiKeysDisabledError,
  PrincipalKindAuthorizationError,
  requireAllowedWorkspacePrincipal,
  WorkspaceApiKeyAuthorizationError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application/workspace-authorization'
export {
  defineWorkspaceOperation,
  type PrincipalForOperation,
  type PrincipalKind,
  type WorkspaceOperation,
} from '@/lib/core/application/workspace-operation'
