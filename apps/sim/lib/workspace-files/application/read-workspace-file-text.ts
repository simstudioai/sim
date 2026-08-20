import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isSupportedFileType, parseBuffer } from '@/lib/file-parsers'
import {
  type ActiveWorkspaceFileContext,
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import {
  formatFileSize,
  getFileExtension,
  MAX_TEXT_EXTRACTION_BYTES,
} from '@/lib/uploads/utils/file-utils'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

export interface ReadWorkspaceFileTextInput {
  fileId: string
  assertedWorkspaceId?: string
  maxBytes?: number
}

export interface ReadWorkspaceFileTextResult {
  file: WorkspaceFileRecord
  text: string
  /** True when a parser limit stopped extraction before the input was exhausted. */
  truncated: boolean
  /**
   * True when no real extraction happened and `text` is best-effort scraped
   * bytes or a placeholder rather than the document's content. Surfaced rather
   * than converted into an error because the legacy `doc`/`ppt` parsers
   * deliberately never throw, and that behavior is characterization-tested.
   */
  degraded: boolean
  degradedReason: string | null
  byteCount: number
}

async function executeReadWorkspaceFileText({
  input,
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.readContent,
  ReadWorkspaceFileTextInput,
  ActiveWorkspaceFileContext
>): Promise<ReadWorkspaceFileTextResult> {
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, { throwOnError: true })
  if (!file) throw new OrchestrationError('not_found', 'File not found')

  const extension = getFileExtension(file.name)
  if (!isSupportedFileType(extension)) {
    throw new OrchestrationError(
      'validation',
      `Text extraction is not supported for "${file.name}"; download the raw bytes with GET /api/v2/files/${file.id}`
    )
  }

  const maxBytes = Math.min(input.maxBytes ?? MAX_TEXT_EXTRACTION_BYTES, MAX_TEXT_EXTRACTION_BYTES)
  if (file.size > maxBytes) {
    throw new OrchestrationError(
      'payload_too_large',
      `"${file.name}" is ${formatFileSize(file.size)}, above the ${formatFileSize(maxBytes)} text-extraction limit; download the raw bytes with GET /api/v2/files/${file.id}`
    )
  }

  const content = await fetchWorkspaceFileBuffer(file, { maxBytes })
  const parsed = await parseBuffer(content, extension)
  const metadata = parsed.metadata ?? {}

  return {
    file,
    text: parsed.content,
    truncated: metadata.truncated === true,
    degraded: metadata.degraded === true,
    degradedReason: metadata.degraded === true ? (metadata.warning ?? null) : null,
    byteCount: content.byteLength,
  }
}

/**
 * Extracts a workspace file's text.
 *
 * Runs on `files.read_content` unchanged: extracting text reads exactly the
 * bytes that operation already authorizes, and turning them into text grants
 * no further reach. No audit is projected, matching the existing content read.
 */
export const readWorkspaceFileText = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  resolveContext: ({ input }) => resolveActiveWorkspaceFileContext(input),
  execute: executeReadWorkspaceFileText,
})
