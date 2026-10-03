export { principalAuditSource } from '@/lib/core/application/audit-source'
export {
  type AuthorizedWorkspaceResourceUseCaseContext,
  type AuthorizedWorkspaceUseCaseContext,
  type AuthorizedWorkspaceUseCaseDefinition,
  type AuthorizedWorkspaceUseCaseResultContext,
  type AuthorizingUseCase,
  defineAuthorizedWorkspaceUseCase,
  recordProjectedUseCaseAuditEntries,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application/authorized-workspace-use-case'
export {
  FORBIDDEN_DETAIL_CODES,
  type ForbiddenDetailCode,
  ForbiddenOperationError,
  forbiddenErrorDetails,
} from '@/lib/core/application/forbidden'
export {
  InsufficientScopeError,
  OAuthAccessTokenExpiredError,
  requireOAuthOperationScope,
} from '@/lib/core/application/oauth-authorization'
export {
  type ApplicationOperation,
  assertOperationCapability,
  assertOperationOAuthPolicy,
  assertOperationPrincipal,
  defineOperation,
  type OAuthOperationPolicy,
  type OperationDeclarableCapability,
  type OperationUseCase,
  type PrincipalKind,
  type PrincipalScopedOperation,
  type PrincipalWideCapability,
  type UndelegatedPrincipalKind,
} from '@/lib/core/application/operation'
export type {
  WorkspaceAuthorizationContext,
  WorkspaceAuthorizationOptions,
  WorkspaceDelegationPolicy,
} from '@/lib/core/application/workspace-authorization'
export {
  authorizeWorkspaceOperation,
  capabilityGovernedPrincipalUserId,
  DelegatedServiceAuthorizationError,
  DelegatedWorkspaceAuthorizationError,
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  PersonalApiKeysDisabledError,
  PrincipalKindAuthorizationError,
  requireAllowedWorkspacePrincipal,
  requireCurrentHumanRole,
  requirePersonalApiKeysAllowed,
  requireUserCredentialCapabilities,
  WorkspaceApiKeyAuthorizationError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application/workspace-authorization'
export {
  defineWorkspaceOperation,
  type PrincipalForOperation,
  type WorkspaceOperation,
} from '@/lib/core/application/workspace-operation'
export { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'
