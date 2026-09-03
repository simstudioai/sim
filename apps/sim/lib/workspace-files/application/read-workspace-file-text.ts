import type { Principal } from '@sim/auth/principal'
import { getErrorMessage } from '@sim/utils/errors'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { isSupportedFileType } from '@/lib/file-parsers'
import { getFileParserErrorCode } from '@/lib/file-parsers/errors'
import {
  fetchWorkspaceFileBuffer,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import {
  formatFileSize,
  getFileExtension,
  MAX_TEXT_EXTRACTION_BYTES,
  needsRenderedArtifact,
} from '@/lib/uploads/utils/file-utils'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveRenderedWorkspaceArtifact } from '@/lib/workspace-files/application/resolve-rendered-workspace-artifact'
import { parseWorkspaceFileText } from '@/lib/workspace-files/text-extraction'
import { sliceFileTextLines } from '@/lib/workspace-files/text-lines'
import {
  type ReferencedWorkspaceFileContext,
  resolveReferencedWorkspaceFileContext,
} from '@/lib/workspace-files/application/resolve-workspace-file-reference'

export interface ReadWorkspaceFileTextInput {
  /** Workspace the reference is resolved in. */
  workspaceId: string
  /** File id, or its VFS path: `files/<folder>/<name>`, or `uploads/<name>` for a chat upload. */
  reference: string
  maxBytes?: number
  /** First line to return, 1-based. Absent starts at the first line. */
  offset?: number
  /** How many lines to return from `offset`. Absent reads to the end. */
  limit?: number
}

export interface ReadWorkspaceFileTextResult {
  file: WorkspaceFileRecord
  text: string
  /** True when a parser limit stopped extraction before the input was exhausted. */
  truncated: boolean
  /**
   * True when no real extraction happened and `text` is a placeholder rather
   * than the document's content — today only an all-blank workbook. Legacy
   * formats raise typed parser errors instead of degrading.
   */
  degraded: boolean
  degradedReason: string | null
  byteCount: number
  /** Present when `offset` or `limit` narrowed `text` to a window. */
  lineRange?: {
    offset: number
    lineCount: number
    totalLines: number
    /** False when extraction was truncated, so `totalLines` is not the file's end. */
    totalLinesExact: boolean
  }
}

/**
 * Reads an ordinary uploaded file's bytes.
 *
 * The stored size is authoritative for these, so an oversized file is refused
 * before any bytes are fetched. It is NOT authoritative for a generation source,
 * which is why that path is bounded by the artifact ceiling instead.
 */
async function readSourceBuffer(
  file: WorkspaceFileRecord,
  maxBytes: number,
  signal?: AbortSignal
): Promise<Buffer> {
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
  return fetchWorkspaceFileBuffer(file, { maxBytes, signal })
}

async function executeReadWorkspaceFileText({
  input,
  context,
  principal,
  request,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.readContent,
  ReadWorkspaceFileTextInput,
  ReferencedWorkspaceFileContext
>): Promise<ReadWorkspaceFileTextResult> {
  const signal = request?.signal
  signal?.throwIfAborted()
  return extractWorkspaceFileRecordText(context.file, input, principal, signal)
}

/**
 * Extracts the text of the bytes a record points at. Version reads pass a record whose key, size,
 * and type describe a previous version, so both surfaces extract through one path.
 */
export async function extractWorkspaceFileRecordText(
  file: WorkspaceFileRecord,
  input: Pick<ReadWorkspaceFileTextInput, 'maxBytes' | 'offset' | 'limit'>,
  principal: Principal,
  signal?: AbortSignal
): Promise<ReadWorkspaceFileTextResult> {
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
          signal,
          tooLargeMessage: (limit) =>
            `"${file.name}" renders to more than ${limit}, above the text-extraction limit; download the raw bytes instead of extracting text`,
        })
      ).buffer
    : await readSourceBuffer(file, maxBytes, signal)
  const parsed = await parseFileText(content, extension, file.name, signal)
  const metadata = parsed.metadata ?? {}

  const truncated = metadata.truncated === true
  const { text, lineRange } = sliceFileTextLines(
    parsed.content,
    input.offset,
    input.limit,
    truncated
  )

  return {
    file,
    text,
    truncated,
    degraded: metadata.degraded === true,
    degradedReason: metadata.degraded === true ? (metadata.warning ?? null) : null,
    byteCount: content.byteLength,
    ...(lineRange ? { lineRange } : {}),
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
async function parseFileText(
  content: Buffer,
  extension: string,
  fileName: string,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  if (content.byteLength === 0) {
    return { content: '', metadata: {} }
  }
  try {
    return await parseWorkspaceFileText(content, extension, {
      maxTextBytes: MAX_TEXT_EXTRACTION_BYTES,
      signal,
    })
  } catch (error) {
    signal?.throwIfAborted()
    if (isPayloadSizeLimitError(error) || getFileParserErrorCode(error) === 'complexity_limit') {
      throw new OrchestrationError(
        'payload_too_large',
        `"${fileName}" exceeds complete text extraction limits`
      )
    }
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
  resolveContext: ({ input }) =>
    resolveReferencedWorkspaceFileContext(input, { includeChatUploads: true }),
  execute: executeReadWorkspaceFileText,
})
