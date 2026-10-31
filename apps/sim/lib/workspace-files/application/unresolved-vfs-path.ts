import { OrchestrationError, type OrchestrationErrorCode } from '@/lib/core/orchestration/types'

/**
 * A `files/…` path that names no single live file in the asserted workspace, or a refusal its
 * lookup read from the workspace (two names that display alike, a folder tree too large to read).
 * Each describes that workspace's contents, so `defineAuthorizedWorkspaceFileUseCase` admits the
 * caller to the workspace before letting it out.
 */
export class UnresolvedWorkspaceFileVfsPathError extends OrchestrationError {
  constructor(
    readonly workspaceId: string,
    code: OrchestrationErrorCode,
    message: string
  ) {
    super(code, message)
    this.name = 'UnresolvedWorkspaceFileVfsPathError'
  }
}
