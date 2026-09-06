import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  isOpaqueWorkspaceFileEgressSafe,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveRenderedWorkspaceArtifact } from '@/lib/workspace-files/application/resolve-rendered-workspace-artifact'
import { resolveReferencedWorkspaceFileContext } from '@/lib/workspace-files/application/resolve-workspace-file-reference'

interface ReadWorkspaceFileArtifactInput {
  workspaceId: string
  reference: string
  maxBytes: number
}

/** Authorizes a visual model observation, including file access and opaque-media provenance. */
export const readWorkspaceFileArtifact = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  resolveContext: ({ input }: { input: ReadWorkspaceFileArtifactInput }) =>
    resolveReferencedWorkspaceFileContext(input, { includeChatUploads: true }),
  async execute({ input, context, principal }) {
    const file = context.file
    const safe = await isOpaqueWorkspaceFileEgressSafe(context.workspaceId, {
      fileId: file.id,
      key: file.key,
      context: file.storageContext ?? 'workspace',
      ...(file.contentUpdatedAt ? { contentUpdatedAt: file.contentUpdatedAt } : {}),
    })
    if (!safe) throw new OrchestrationError('forbidden', MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE)
    const artifact = await resolveRenderedWorkspaceArtifact(context.file, principal, {
      maxBytes: input.maxBytes,
    })
    return { file: context.file, ...artifact }
  },
})
