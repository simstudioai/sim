import { getErrorMessage } from '@sim/utils/errors'
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
  needsRenderedArtifact,
} from '@/lib/uploads/utils/file-utils'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveRenderedWorkspaceArtifact } from '@/lib/workspace-files/application/resolve-rendered-workspace-artifact'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'
import { countLines, detectLineEnding } from '@/lib/workspace-files/edit-content'

export interface ReadWorkspaceFileTextInput {
  fileId: string
  assertedWorkspaceId?: string
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
   * True when no real extraction happened and `text` is best-effort scraped
   * bytes or a placeholder rather than the document's content. Surfaced rather
   * than converted into an error because the legacy `doc`/`ppt` parsers
   * deliberately never throw, and that behavior is characterization-tested.
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
  ActiveWorkspaceFileContext
>): Promise<ReadWorkspaceFileTextResult> {
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, { throwOnError: true })
  if (!file) throw new OrchestrationError('not_found', 'File not found')

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

  const truncated = metadata.truncated === true
  const { text, lineRange } = sliceTextLines(parsed.content, input.offset, input.limit, truncated)

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
 * Narrows extracted text to a line window.
 *
 * `totalLines` travels with it because without it a caller cannot tell a file
 * that ended from a window that stopped early, and would either stop reading
 * too soon or keep asking for lines that do not exist. Lines are counted the
 * way {@link countLines} counts them, so the numbers here name the same lines
 * that search reports and that an insert will accept.
 *
 * `totalLinesExact` is false when the parser stopped early: the count then
 * describes only the part that was extracted, and reporting it as the file's
 * end would tell a caller it had read everything. The separate flag is what
 * keeps `totalLines` useful in the ordinary case without lying in this one.
 *
 * The window is rejoined with the line ending the text already used, so a
 * ranged read of a CRLF file stays usable verbatim as exact search text for an edit.
 */
function sliceTextLines(
  text: string,
  offset: number | undefined,
  limit: number | undefined,
  truncatedExtraction: boolean
): {
  text: string
  lineRange?: {
    offset: number
    lineCount: number
    totalLines: number
    totalLinesExact: boolean
  }
} {
  if (offset === undefined && limit === undefined) return { text }

  const totalLines = countLines(text)
  const eol = detectLineEnding(text)
  const lines = text.split(/\r\n|\n/).slice(0, totalLines)
  const start = Math.max((offset ?? 1) - 1, 0)
  const window = lines.slice(start, limit === undefined ? undefined : start + limit)

  return {
    text: window.join(eol),
    lineRange: {
      offset: start + 1,
      lineCount: window.length,
      totalLines,
      totalLinesExact: !truncatedExtraction,
    },
  }
}

/**
 * Extracts a workspace file's text.
 *
 * Runs on `files.read_content` unchanged: extracting text reads exactly the
 * bytes that operation already authorizes, and turning them into text grants
 * no further reach. No audit is projected, matching the existing content read.
 */
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

export const readWorkspaceFileText = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  resolveContext: ({ input }) => resolveActiveWorkspaceFileContext(input),
  execute: executeReadWorkspaceFileText,
})
