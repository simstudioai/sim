import { AuditAction, AuditResourceType } from '@sim/audit'
import { PASTE_LIMITS, utf8ByteLength } from '@sim/utils/paste'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { extractEmbeddedFileRefs } from '@/lib/uploads/server/embedded-image-refs'
import { createMarkdownExport, MarkdownExportSizeError } from '@/lib/uploads/server/markdown-export'
import { storedFileId } from '@/lib/uploads/utils/embedded-image-ref'
import { isMarkdownFile } from '@/lib/uploads/utils/file-utils'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { downloadWorkspaceFileRecord } from '@/lib/workspace-files/application/read-workspace-file-record'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

export interface ExportWorkspaceFileSnapshotInput {
  fileId: string
  assertedWorkspaceId: string
  content: string
}

/** Exports the visible snapshot without writing or advancing the collaborative document. */
export const exportWorkspaceFileSnapshot = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.download,
  resolveContext: ({ input }: { input: ExportWorkspaceFileSnapshotInput }) =>
    resolveActiveWorkspaceFileContext(input),
  async execute({ principal, input, context }) {
    const file = await getWorkspaceFile(context.workspaceId, context.fileId, { throwOnError: true })
    if (!file) throw new OrchestrationError('not_found', 'File not found')
    if (!isMarkdownFile(file) && file.type !== 'text/x-markdown') {
      throw new OrchestrationError('validation', 'Only Markdown files support snapshot export')
    }
    if (
      utf8ByteLength(input.content, PASTE_LIMITS.RICH_MARKDOWN_BYTES) >
      PASTE_LIMITS.RICH_MARKDOWN_BYTES
    ) {
      throw new OrchestrationError('validation', 'Markdown snapshot is too large')
    }

    const { ids } = extractEmbeddedFileRefs(input.content)
    const targets = await mapWithConcurrency(ids, MATERIALIZE_CONCURRENCY, async (imageId) => {
      try {
        const { file: asset } = await downloadWorkspaceFileRecord.execute({
          principal,
          input: { fileId: storedFileId(imageId), assertedWorkspaceId: context.workspaceId },
        })
        return {
          imageId,
          key: asset.key,
          context: asset.storageContext ?? 'workspace',
          originalName: asset.name,
          size: asset.size,
        }
      } catch (error) {
        const code = asOrchestrationError(error)?.code
        if (code === 'not_found' || code === 'forbidden') return null
        throw error
      }
    })

    try {
      const exported = await createMarkdownExport({
        content: Buffer.from(input.content),
        fileName: file.name,
        assets: targets.filter((target) => target !== null),
      })
      return { file, ...exported }
    } catch (error) {
      if (!(error instanceof MarkdownExportSizeError)) throw error
      throw new OrchestrationError('validation', error.message)
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.FILE_DOWNLOADED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.file.id,
    resourceName: result.file.name,
    description: `Exported file "${result.file.name}"`,
    metadata: {
      fileId: result.file.id,
      fileName: result.file.name,
      bytes: result.buffer.length,
      format: result.format,
      assetCount: result.assetCount,
    },
  }),
})
