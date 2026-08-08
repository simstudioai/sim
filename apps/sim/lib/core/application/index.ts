export type {
  ApplicationOperation,
  OperationUseCase,
} from '@/lib/core/application/operation'
export type {
  WorkspaceAuthorizationContext,
  WorkspaceAuthorizationOptions,
  WorkspaceDelegationPolicy,
} from '@/lib/core/application/workspace-authorization'
export { authorizeWorkspaceOperation } from '@/lib/core/application/workspace-authorization'
export {
  defineWorkspaceOperation,
  type WorkspaceOperation,
} from '@/lib/core/application/workspace-operation'
