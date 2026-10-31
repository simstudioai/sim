import type { Principal } from '@sim/auth/principal'
import {
  type AuthorizedWorkspaceUseCaseDefinition,
  authorizeWorkspaceOperation,
  defineAuthorizedWorkspaceUseCase,
  type WorkspaceOperation,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { loadActiveWorkspaceContext } from '@/lib/uploads/contexts/workspace'
import {
  type WorkspaceFileAuthorizationContext,
  workspaceFileDelegationPolicy,
} from '@/lib/workspace-files/application/authorization'
import { UnresolvedWorkspaceFileVfsPathError } from '@/lib/workspace-files/application/unresolved-vfs-path'

type AuthorizedWorkspaceFileUseCaseDefinition<
  O extends WorkspaceOperation,
  I,
  C extends WorkspaceFileAuthorizationContext,
  R,
> = Omit<AuthorizedWorkspaceUseCaseDefinition<O, I, C, R>, 'authorizationOptions'>

const authorizationOptions = { delegation: workspaceFileDelegationPolicy }

/**
 * Lets a path's unresolved answer out only to a caller the operation admits to the asserted
 * workspace; anyone else gets the refusal a resolved file would have given them. The context names
 * no file, so a delegation scoped to one file is refused here exactly as it is for any other file.
 */
async function admitUnresolvedPath(
  principal: Principal,
  operation: WorkspaceOperation,
  unresolved: UnresolvedWorkspaceFileVfsPathError
): Promise<never> {
  const workspace = await loadActiveWorkspaceContext(unresolved.workspaceId)
  if (!workspace) throw new OrchestrationError('not_found', 'File not found')
  await authorizeWorkspaceOperation(principal, operation, workspace, authorizationOptions)
  throw unresolved
}

export function defineAuthorizedWorkspaceFileUseCase<
  const O extends WorkspaceOperation,
  I,
  C extends WorkspaceFileAuthorizationContext,
  R,
>(definition: AuthorizedWorkspaceFileUseCaseDefinition<O, I, C, R>) {
  return defineAuthorizedWorkspaceUseCase({
    ...definition,
    async resolveContext(args) {
      try {
        return await definition.resolveContext(args)
      } catch (error) {
        if (!(error instanceof UnresolvedWorkspaceFileVfsPathError)) throw error
        return admitUnresolvedPath(args.principal, definition.operation, error)
      }
    },
    authorizationOptions,
  })
}
