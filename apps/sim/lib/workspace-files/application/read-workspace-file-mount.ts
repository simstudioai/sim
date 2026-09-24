import { createLogger } from '@sim/logger'
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
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  getBoundWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { isGeneratedDocumentSourceType } from '@/lib/uploads/utils/file-utils'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fetchAuthorizedServableWorkspaceFileBuffer } from '@/lib/workspace-files/application/fetch-servable-workspace-file-buffer'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

const logger = createLogger('WorkspaceFileMount')

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
  secretProvenance: WorkspaceFileSecretProvenance
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
          const buffer = rendersFromSource
            ? (
                await fetchAuthorizedServableWorkspaceFileBuffer(file, principal, {
                  maxBytes,
                  signal: input.signal,
                }).catch((error) => {
                  if (!isPayloadSizeLimitError(error)) throw error
                  throw new Error(
                    `Input file "${input.mountPath}" renders to more than the ${MAX_INLINE_MOUNT_FILE_BYTES / 1024 / 1024}MB per-file mount limit, or than the mount budget left. Mount fewer or smaller files.`
                  )
                })
              ).buffer
            : await fetchWorkspaceFileBuffer(file, { maxBytes })
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
    /** A changed or absent revision cannot certify the bytes already selected above. */
    const secretProvenance: WorkspaceFileSecretProvenance = file.contentUpdatedAt
      ? await getBoundWorkspaceFileSecretProvenance(context.workspaceId, {
          fileId: file.id,
          key: file.key,
          context: file.storageContext ?? 'workspace',
          contentUpdatedAt: file.contentUpdatedAt,
        }).catch((error) => {
          logger.warn('Mount classification unavailable', { fileId: file.id, error })
          return { status: 'unknown' } as const
        })
      : { status: 'unknown' }
    input.signal?.throwIfAborted()
    const mount = mounts[0]
    if (!mount) throw new Error('File mount preparation returned no bytes or URL')
    return { mount, budget, secretProvenance }
  },
})
