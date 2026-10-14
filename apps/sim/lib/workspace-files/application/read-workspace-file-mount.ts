import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type { SandboxFile } from '@/lib/execution/remote-sandbox/types'
import {
  MAX_INLINE_MOUNT_FILE_BYTES,
  pushSandboxFileMount,
  type SandboxMountBudget,
} from '@/lib/function-execution/sandbox-mounts'
import {
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/file-manager'
import { isGeneratedDocumentSourceType } from '@/lib/uploads/utils/file'
import {
  requireAdmittedContributors,
  requireAdmittedWorkspaceFile,
} from '@/lib/workspace-files/application/admit-file-content'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fetchAuthorizedServableWorkspaceFileBuffer } from '@/lib/workspace-files/application/fetch-servable-workspace-file-buffer'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/file-context'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export interface ReadWorkspaceFileMountInput {
  fileId: string
  assertedWorkspaceId: string
  mountPath: string
  budget: SandboxMountBudget
  signal?: AbortSignal
}

export interface ReadWorkspaceFileMountResult {
  mount: SandboxFile
  budget: SandboxMountBudget
}

/** Prepares one private runtime mount from one authorized canonical file version. */
export const readWorkspaceFileMount = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.download,
  resolveContext: ({ input }: { input: ReadWorkspaceFileMountInput }) => {
    input.signal?.throwIfAborted()
    return resolveActiveWorkspaceFileContext({ ...input, includeChatUploads: true })
  },
  async execute({ input, context, principal }): Promise<ReadWorkspaceFileMountResult> {
    input.signal?.throwIfAborted()
    const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
      throwOnError: true,
      includeChatUploads: true,
    })
    if (!file) throw new OrchestrationError('not_found', 'File not found')
    input.signal?.throwIfAborted()
    /**
     * Classified before any byte is read, bound to the storage key the mount reads: a key is never
     * rewritten in place, so the bytes mounted below are the bytes this classification describes.
     */
    await requireAdmittedWorkspaceFile(principal, context.workspaceId, file, 'complete')
    input.signal?.throwIfAborted()
    const mounts: SandboxFile[] = []
    const budget = { ...input.budget }
    const rendersFromSource = isGeneratedDocumentSourceType(file.type)
    await pushSandboxFileMount(
      mounts,
      {
        mountPath: input.mountPath,
        key: file.key,
        storageContext: file.storageContext ?? 'workspace',
        declaredSize: file.size,
        rendersFromSource,
        readInline: async (maxBytes) => {
          input.signal?.throwIfAborted()
          let buffer: Buffer
          if (rendersFromSource) {
            const rendered = await fetchAuthorizedServableWorkspaceFileBuffer(file, principal, {
              maxBytes,
              signal: input.signal,
            }).catch((error) => {
              if (!isPayloadSizeLimitError(error)) throw error
              throw new Error(
                `Input file "${input.mountPath}" renders to more than the ${MAX_INLINE_MOUNT_FILE_BYTES / 1024 / 1024}MB per-file mount limit, or than the mount budget left. Mount fewer or smaller files.`
              )
            })
            await requireAdmittedContributors(
              principal,
              context.workspaceId,
              rendered.contributingFiles,
              'complete'
            )
            buffer = rendered.buffer
          } else {
            buffer = await fetchWorkspaceFileBuffer(file, { maxBytes })
          }
          input.signal?.throwIfAborted()
          return {
            content: buffer.toString('base64'),
            encoding: 'base64',
            byteLength: buffer.length,
          }
        },
      },
      budget
    )
    input.signal?.throwIfAborted()
    const mount = mounts[0]
    if (!mount) throw new Error('File mount preparation returned no bytes or URL')
    return { mount, budget }
  },
})
