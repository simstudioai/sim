import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * A `files/…` path that names no single live file in the asserted workspace. Whether it is missing
 * or names two files whose names display alike describes that workspace's contents, so
 * `defineAuthorizedWorkspaceFileUseCase` admits the caller to the workspace before letting it out.
 */
export class UnresolvedWorkspaceFileVfsPathError extends OrchestrationError {
  constructor(
    readonly workspaceId: string,
    code: 'not_found' | 'validation',
    message: string
  ) {
    super(code, message)
    this.name = 'UnresolvedWorkspaceFileVfsPathError'
  }
}
