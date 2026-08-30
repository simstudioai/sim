import type { OperationUseCase } from '@/lib/core/application'
import { createCopilotApplicationAdapter } from '@/lib/mothership/application/application-adapter'
import { COPILOT_APPLICATION_DELEGATION_TTL_MS } from '@/lib/mothership/auth/application-delegation'
import {
  type CopilotFileDelegationContext,
  resolveCopilotFilePrincipal,
} from '@/lib/mothership/auth/file-delegation'
import { workspaceFileDelegationPolicy } from '@/lib/workspace-files/application/authorization'
import { type FileOperation, fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveWorkspaceFileReference } from '@/lib/workspace-files/application/resolve-workspace-file-reference'

interface ExecuteCopilotFileUseCaseOptions {
  fileId?: string
}

const executeFileUseCase = createCopilotApplicationAdapter<
  FileOperation,
  ExecuteCopilotFileUseCaseOptions
>({
  domain: 'file',
  delegation: {
    audience: workspaceFileDelegationPolicy.audience,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
  operations: fileOperations,
  projectResourceScope: ({ fileId }) => (fileId ? { fileId } : {}),
})

/** Normalizes trusted Copilot authentication before entering a file application use case. */
export function executeCopilotFileUseCase<O extends FileOperation, I, R>(
  context: CopilotFileDelegationContext | undefined,
  useCase: OperationUseCase<O, I, R>,
  input: I,
  options: ExecuteCopilotFileUseCaseOptions = {}
): Promise<R> {
  return executeFileUseCase(context, useCase, input, options)
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
