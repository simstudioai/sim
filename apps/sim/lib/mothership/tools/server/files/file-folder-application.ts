import { executeCopilotFileUseCase } from '@/lib/mothership/application/execute-file-use-case'
import type { CopilotFileDelegationContext } from '@/lib/mothership/auth/file-delegation'
import { findWorkspaceFileFolderIdByPath } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { createWorkspaceFileFolderOperation } from '@/lib/workspace-files/application/workspace-file-folders'

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
