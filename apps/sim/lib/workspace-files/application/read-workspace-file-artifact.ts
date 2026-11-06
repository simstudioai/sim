import type { Principal } from '@sim/auth/principal'
import {
  requireAdmittedContributors,
  requireAdmittedWorkspaceFile,
} from '@/lib/workspace-files/application/admit-file-content'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveRenderedWorkspaceArtifact } from '@/lib/workspace-files/application/resolve-rendered-workspace-artifact'
import { resolveReferencedWorkspaceFileContext } from '@/lib/workspace-files/application/resolve-workspace-file-reference'

interface ReadWorkspaceFileArtifactInput {
  workspaceId: string
  reference: string
  chatId?: string
  maxBytes: number
}

/** Authorizes a visual model observation, including file access and opaque-media provenance. */
export const readWorkspaceFileArtifact = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadWorkspaceFileArtifactInput
  }) =>
    resolveReferencedWorkspaceFileContext(principal, input, {
      includeChatUploads: true,
      includeOwnedFiles: true,
    }),
  async execute({ input, context, principal }) {
    await requireAdmittedWorkspaceFile(principal, context.workspaceId, context.file, 'opaque')
    const artifact = await resolveRenderedWorkspaceArtifact(context.file, principal, {
      maxBytes: input.maxBytes,
    })
    /** An image of a document shows every file it embedded, none of which redaction can reach. */
    await requireAdmittedContributors(
      principal,
      context.workspaceId,
      artifact.contributingFiles,
      'opaque'
    )
    return { file: context.file, buffer: artifact.buffer, contentType: artifact.contentType }
  },
})
