import { getErrorMessage } from '@sim/utils/errors'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isSupportedFileType, parseBuffer } from '@/lib/file-parsers'
import {
  fetchWorkspaceFileBuffer,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import {
  getBoundWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  formatFileSize,
  getFileExtension,
  MAX_TEXT_EXTRACTION_BYTES,
  needsRenderedArtifact,
} from '@/lib/uploads/utils/file-utils'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveRenderedWorkspaceArtifact } from '@/lib/workspace-files/application/resolve-rendered-workspace-artifact'
import {
  type ReferencedWorkspaceFileContext,
  resolveReferencedWorkspaceFileContext,
} from '@/lib/workspace-files/application/resolve-workspace-file-reference'

export interface ReadWorkspaceFileTextInput {
  /** Workspace the reference is resolved in. */
  workspaceId: string
  /** File id, or its VFS path: `files/<folder>/<name>`, or `uploads/<name>` for a chat upload. */
  reference: string
  /** Internal Mothership upload namespace, absent from public request contracts. */
  chatId?: string
  maxBytes?: number
  /** Private classification for runtime consumers, omitted from ordinary API reads. */
  includeSecretProvenance?: boolean
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
  secretProvenance?: WorkspaceFileSecretProvenance
}

/**
 * Reads an ordinary uploaded file's bytes.
 *
 * The stored size is authoritative for these, so an oversized file is refused
 * before any bytes are fetched. It is NOT authoritative for a generation source,
 * which is why that path is bounded by the artifact ceiling instead.
 */
async function readSourceBuffer(file: WorkspaceFileRecord, maxBytes: number): Promise<Buffer> {
  if (file.size > maxBytes) {
    /**
     * Sizes render with `includeBytes` because a caller-supplied `maxBytes` is
     * routinely under 1 KB, and the default formatting collapses every sub-1 KB
     * value to "0 Bytes" — naming neither the real size nor the limit to raise.
     */
    throw new OrchestrationError(
      'payload_too_large',
      `"${file.name}" is ${formatFileSize(file.size, { includeBytes: true })}, above the ${formatFileSize(maxBytes, { includeBytes: true })} text-extraction limit; download the raw bytes instead of extracting text`
    )
  }
  return fetchWorkspaceFileBuffer(file, { maxBytes })
}

async function executeReadWorkspaceFileText({
  input,
  context,
  principal,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.readContent,
  ReadWorkspaceFileTextInput,
  ReferencedWorkspaceFileContext
>): Promise<ReadWorkspaceFileTextResult> {
  const { file } = context

  const extension = getFileExtension(file.name)
  if (!isSupportedFileType(extension)) {
    throw new OrchestrationError(
      'validation',
      `Text extraction is not supported for "${file.name}"; download the raw bytes instead of extracting text`
    )
  }

  const maxBytes = Math.min(input.maxBytes ?? MAX_TEXT_EXTRACTION_BYTES, MAX_TEXT_EXTRACTION_BYTES)

  /**
   * A generated document stores its generation SOURCE under a document-shaped
   * name, so parsing `file.key` by extension alone feeds a PDF parser
   * JavaScript — a 500 on `.pdf`, and on `.docx` a "successful" extraction of
   * the generator script reported as undegraded content. The compiled artifact
   * is what the name promises, so it is what gets parsed. Matches the download
   * path, which resolves the same artifact for the same reason.
   */
  const content = needsRenderedArtifact(file.type, file.name)
    ? (
        await resolveRenderedWorkspaceArtifact(file, principal, {
          maxBytes,
          tooLargeMessage: (limit) =>
            `"${file.name}" renders to more than ${limit}, above the text-extraction limit; download the raw bytes instead of extracting text`,
        })
      ).buffer
    : await readSourceBuffer(file, maxBytes)
  const parsed = await parseFileText(content, extension, file.name)
  const metadata = parsed.metadata ?? {}
  const secretProvenance = input.includeSecretProvenance
    ? await getBoundWorkspaceFileSecretProvenance(context.workspaceId, {
        fileId: file.id,
        key: file.key,
        context: file.storageContext ?? 'workspace',
        contentUpdatedAt: file.contentUpdatedAt ?? undefined,
      })
    : undefined

  return {
    file,
    text: parsed.content,
    truncated: metadata.truncated === true,
    degraded: metadata.degraded === true,
    degradedReason: metadata.degraded === true ? (metadata.warning ?? null) : null,
    byteCount: content.byteLength,
    ...(secretProvenance ? { secretProvenance } : {}),
  }
}

/**
 * Turns stored bytes into text without ever answering `500`.
 *
 * `parseBuffer` signals every failure — an empty buffer, an unknown extension,
 * a parser that rejects the bytes — as a bare `Error`, which no v2 error policy
 * classifies, so calling it directly made a zero-byte upload or a mislabelled
 * archive an unhandled `500` on a well-formed request. That is the defect class
 * the conventions doc ranks highest.
 *
 * Empty bytes are not a failure: a zero-length file has no text, and answering
 * `''` is both true and what the caller asked for. Anything else becomes a
 * `conflict`, matching {@link resolveRenderedWorkspaceArtifact} — the request is
 * well formed, it is the stored bytes that cannot become the representation
 * being asked for, and the caller needs to know that retrying will not help.
 */
async function parseFileText(content: Buffer, extension: string, fileName: string) {
  if (content.byteLength === 0) {
    return { content: '', metadata: {} }
  }
  try {
    return await parseBuffer(content, extension)
  } catch (error) {
    throw new OrchestrationError(
      'conflict',
      `"${fileName}" could not be read as text: ${getErrorMessage(error, 'the stored bytes could not be parsed')}`
    )
  }
}

/**
 * Extracts a workspace file's text.
 *
 * Runs on `files.read_content` unchanged: extracting text reads exactly the
 * bytes that operation already authorizes, and turning them into text grants
 * no further reach. No audit is projected, matching the existing content read.
 *
 * The file is addressed by reference rather than id so a chat upload — which no
 * listing shows — is readable by the `uploads/<name>` path its upload notice
 * names, and any file by the `files/…` path `glob` prints.
 */
export const readWorkspaceFileText = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  resolveContext: ({ principal, input }) =>
    resolveReferencedWorkspaceFileContext(principal, input, { includeChatUploads: true }),
  execute: executeReadWorkspaceFileText,
})
