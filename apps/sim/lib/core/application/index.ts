export { principalAuditSource } from '@/lib/core/application/audit-source'
export {
  type AuthorizedWorkspaceResourceUseCaseContext,
  type AuthorizedWorkspaceUseCaseContext,
  type AuthorizedWorkspaceUseCaseDefinition,
  type AuthorizedWorkspaceUseCaseResultContext,
  defineAuthorizedWorkspaceUseCase,
  recordProjectedUseCaseAuditEntries,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application/authorized-workspace-use-case'
export {
  FORBIDDEN_DETAIL_CODE_DESCRIPTIONS,
  FORBIDDEN_DETAIL_CODES,
  type ForbiddenDetailCode,
  ForbiddenOperationError,
  forbiddenErrorDetails,
} from '@/lib/core/application/forbidden'
export {
  type ApplicationOperation,
  assertOperationPrincipal,
  defineOperation,
  type OperationUseCase,
  type PrincipalKind,
  type PrincipalScopedOperation,
  type UndelegatedPrincipalKind,
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
  type WorkspaceOperation,
} from '@/lib/core/application/workspace-operation'
export { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'
