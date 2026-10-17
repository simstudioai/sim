import type { Principal } from '@sim/auth/principal'
import { getErrorMessage } from '@sim/utils/errors'
import type { AuthorizedWorkspaceUseCaseContext, ContentSourceKind } from '@/lib/core/application'
import { redactBeforeCutting } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { isSupportedFileType } from '@/lib/file-parsers'
import { getFileParserErrorCode } from '@/lib/file-parsers/errors'
import {
  fetchWorkspaceFileBuffer,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import {
  formatFileSize,
  getFileExtension,
  MAX_TEXT_EXTRACTION_BYTES,
  needsRenderedArtifact,
} from '@/lib/uploads/utils/file'
import {
  requireAdmittedContributors,
  requireAdmittedWorkspaceFile,
} from '@/lib/workspace-files/application/admit-file-content'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveRenderedWorkspaceArtifact } from '@/lib/workspace-files/application/resolve-rendered-workspace-artifact'
import {
  type ReferencedWorkspaceFileContext,
  resolveReferencedWorkspaceFileContext,
} from '@/lib/workspace-files/application/resolve-workspace-file-reference'
import { parseWorkspaceFileText } from '@/lib/workspace-files/text-extraction'
import { workspaceFileTextFormat } from '@/lib/workspace-files/text-format'
import { sliceFileTextLines } from '@/lib/workspace-files/text-lines'

export interface ReadWorkspaceFileTextInput {
  /** Workspace the reference is resolved in. */
  workspaceId: string
  /** File id, or its VFS path: `files/<folder>/<name>`, or `uploads/<name>` for a chat upload. */
  reference: string
  /** Internal Mothership upload namespace, absent from public request contracts. */
  chatId?: string
  maxBytes?: number
  /** First line to return, 1-based. Absent starts at the first line. */
  offset?: number
  /** How many lines to return from `offset`. Absent reads to the end. */
  limit?: number
  /** Internal agent reads can decode plain source files identified by their MIME type. */
  allowPlainText?: boolean
}

/** Text extracted from one file's bytes, whichever owner stores them. */
export interface ExtractedFileText {
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

export interface ReadWorkspaceFileTextResult extends ExtractedFileText {
  file: WorkspaceFileRecord
}

/** Refuses a text read of a file whose format has no extractor. */
export function textExtractionUnsupportedError(name: string): OrchestrationError {
  return new OrchestrationError(
    'validation',
    `Text extraction is not supported for "${name}"; download the raw bytes instead of extracting text`
  )
}

/**
 * Refuses a text read whose stored bytes exceed the limit. Sizes render with `includeBytes`
 * because a caller-supplied `maxBytes` is routinely under 1 KB, and the default formatting collapses
 * every sub-1 KB value to "0 Bytes" — naming neither the real size nor the limit to raise.
 */
export function textExtractionTooLargeError(
  name: string,
  size: number,
  maxBytes: number
): OrchestrationError {
  return new OrchestrationError(
    'payload_too_large',
    `"${name}" is ${formatFileSize(size, { includeBytes: true })}, above the ${formatFileSize(maxBytes, { includeBytes: true })} text-extraction limit; download the raw bytes instead of extracting text`
  )
}

/** The refusal for a generated document whose render exceeds the text-extraction limit. */
export function renderedTextTooLargeMessage(name: string, limit: string): string {
  return `"${name}" renders to more than ${limit}, above the text-extraction limit; download the raw bytes instead of extracting text`
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
  if (file.size > maxBytes) throw textExtractionTooLargeError(file.name, file.size, maxBytes)
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
  input: Pick<ReadWorkspaceFileTextInput, 'maxBytes' | 'offset' | 'limit' | 'allowPlainText'>,
  principal: Principal,
  signal?: AbortSignal,
  sourceProvenance?: WorkspaceFileSecretProvenance
): Promise<ReadWorkspaceFileTextResult> {
  await requireAdmittedWorkspaceFile(
    principal,
    file.workspaceId,
    file,
    'complete',
    sourceProvenance
  )

  const extension = input.allowPlainText
    ? (workspaceFileTextFormat(file) ?? getFileExtension(file.name))
    : getFileExtension(file.name)
  if (!isSupportedFileType(extension)) throw textExtractionUnsupportedError(file.name)

  const maxBytes = Math.min(input.maxBytes ?? MAX_TEXT_EXTRACTION_BYTES, MAX_TEXT_EXTRACTION_BYTES)

  /**
   * A generated document stores its generation SOURCE under a document-shaped
   * name, so parsing `file.key` by extension alone feeds a PDF parser
   * JavaScript — a 500 on `.pdf`, and on `.docx` a "successful" extraction of
   * the generator script reported as undegraded content. The compiled artifact
   * is what the name promises, so it is what gets parsed. Matches the download
   * path, which resolves the same artifact for the same reason.
   */
  let content: Buffer
  if (needsRenderedArtifact(file.type, file.name)) {
    const rendered = await resolveRenderedWorkspaceArtifact(file, principal, {
      maxBytes,
      signal,
      tooLargeMessage: (limit) => renderedTextTooLargeMessage(file.name, limit),
    })
    await requireAdmittedContributors(
      principal,
      file.workspaceId,
      rendered.contributingFiles,
      'complete'
    )
    content = rendered.buffer
  } else {
    content = await readSourceBuffer(file, maxBytes, signal)
  }
  return {
    file,
    ...(await extractFileTextFromBytes(content, extension, file.name, input, {
      principal,
      kind: 'workspace-file',
      signal,
    })),
  }
}

/**
 * Turns admitted bytes into text for every file owner. The caller admits the content as `complete`
 * first; a line window is cut only after redaction, so it can never split a secret the registry
 * would otherwise mask whole.
 */
export async function extractFileTextFromBytes(
  content: Buffer,
  format: string,
  fileName: string,
  window: { offset?: number; limit?: number },
  options: { principal?: Principal; kind: ContentSourceKind; signal?: AbortSignal }
): Promise<ExtractedFileText> {
  const parsed = await parseFileText(content, format, fileName, options.signal)
  const metadata = parsed.metadata ?? {}
  const truncated = metadata.truncated === true
  const ranged = window.offset !== undefined || window.limit !== undefined
  const { text, lineRange } = sliceFileTextLines(
    ranged
      ? await redactBeforeCutting(options.principal, parsed.content, options.kind)
      : parsed.content,
    window.offset,
    window.limit,
    truncated
  )
  return {
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
  resolveContext: ({ principal, input }) =>
    resolveReferencedWorkspaceFileContext(principal, input, {
      includeChatUploads: true,
      includeOwnedFiles: true,
    }),
  execute: executeReadWorkspaceFileText,
})
