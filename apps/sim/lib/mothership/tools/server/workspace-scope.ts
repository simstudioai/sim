import { OrchestrationError } from '@/lib/core/orchestration/types'

interface CopilotWorkspaceScopeContext {
  workspaceId?: string
}

/**
 * Returns the execution workspace only. Model-provided workspace ids may assert the same value,
 * but can never select a different workspace or trigger a default-workspace fallback.
 */
export function requireCopilotWorkspace(
  context: CopilotWorkspaceScopeContext | undefined,
  assertedWorkspaceId?: string
): string {
  if (!context?.workspaceId) {
    throw new OrchestrationError('validation', 'Copilot execution workspace is required')
  }
  if (assertedWorkspaceId && assertedWorkspaceId !== context.workspaceId) {
    throw new OrchestrationError(
      'validation',
      'Workspace ID does not match the Copilot execution workspace'
    )
  }
  return context.workspaceId
}
