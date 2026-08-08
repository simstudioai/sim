import {
  type CopilotFileDelegationContext,
  resolveCopilotFilePrincipal,
} from '@/lib/copilot/auth/file-delegation'
import type { OperationUseCase } from '@/lib/core/application'
import { type FileOperation, fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveWorkspaceFileReference } from '@/lib/workspace-files/application/resolve-workspace-file-reference'

const registeredFileOperationIds = new Set<string>(
  Object.values(fileOperations).map((operation) => operation.id)
)

interface ExecuteCopilotFileUseCaseOptions {
  fileId?: string
}

/** Normalizes trusted Copilot authentication before entering a file application use case. */
export function executeCopilotFileUseCase<O extends FileOperation, I, R>(
  context: CopilotFileDelegationContext | undefined,
  useCase: OperationUseCase<O, I, R>,
  input: I,
  options: ExecuteCopilotFileUseCaseOptions = {}
): Promise<R> {
  if (!registeredFileOperationIds.has(useCase.operation.id)) {
    throw new Error(`Unregistered Copilot file operation: ${useCase.operation.id}`)
  }

  return useCase.execute({
    principal: resolveCopilotFilePrincipal(context, options.fileId),
    input,
  })
}

/** Resolves a model-supplied VFS reference under a trusted Copilot delegation. */
export function resolveCopilotWorkspaceFileReference(
  context: CopilotFileDelegationContext | undefined,
  operation: FileOperation,
  input: { workspaceId: string; reference: string }
) {
  return resolveWorkspaceFileReference({
    principal: resolveCopilotFilePrincipal(context),
    operation,
    ...input,
  })
}
