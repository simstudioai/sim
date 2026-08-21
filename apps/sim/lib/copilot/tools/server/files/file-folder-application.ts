import { executeCopilotFileUseCase } from '@/lib/copilot/application/execute-file-use-case'
import type { CopilotFileDelegationContext } from '@/lib/copilot/auth/file-delegation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { findWorkspaceFileFolderIdByPath } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { createWorkspaceFileFolderOperation } from '@/lib/workspace-files/application/workspace-file-folders'

/**
 * Returns the execution workspace only. Model-provided workspace ids may assert the same value,
 * but can never select a different workspace or trigger a default-workspace fallback.
 */
export function requireCopilotWorkspace(
  context: CopilotFileDelegationContext,
  assertedWorkspaceId?: string
): string {
  if (!context.workspaceId) throw new Error('Copilot execution workspace is required')
  if (assertedWorkspaceId && assertedWorkspaceId !== context.workspaceId) {
    throw new OrchestrationError(
      'validation',
      'Workspace ID does not match the Copilot execution workspace'
    )
  }
  return context.workspaceId
}

/** Creates missing parent folders through the shared folder application operation. */
export async function ensureCopilotFileFolderPath(
  context: CopilotFileDelegationContext,
  workspaceId: string,
  pathSegments: string[]
): Promise<string | null> {
  let parentId: string | null = null
  for (const [index, name] of pathSegments.entries()) {
    const existing = await findWorkspaceFileFolderIdByPath(
      workspaceId,
      pathSegments.slice(0, index + 1)
    )
    if (existing) {
      parentId = existing
      continue
    }
    const result: Awaited<ReturnType<typeof createWorkspaceFileFolderOperation.execute>> =
      await executeCopilotFileUseCase(context, createWorkspaceFileFolderOperation, {
        workspaceId,
        name,
        parentId,
      })
    parentId = result.folder.id
  }
  return parentId
}
