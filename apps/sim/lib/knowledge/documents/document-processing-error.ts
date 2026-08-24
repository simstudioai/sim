import { getErrorMessage } from '@sim/utils/errors'
import { isFileParserError } from '@/lib/file-parsers/errors'
import { ArchiveIntegrityError, ZipBombError } from '@/lib/file-parsers/ooxml-limits'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'

export const DOCUMENT_PROCESSING_FAILURE_CODES = [
  'archive_safety_limit',
  'encrypted_file',
  'no_extractable_text',
  'unreadable_office_file',
  'unsupported_file_type',
  'invalid_file',
  'document_complexity_limit',
  'transient_processing_failure',
] as const

export type DocumentProcessingFailureCode = (typeof DOCUMENT_PROCESSING_FAILURE_CODES)[number]

export type DocumentProcessingFailure =
  | {
      readonly disposition: 'permanent'
      readonly code: Exclude<DocumentProcessingFailureCode, 'transient_processing_failure'>
      readonly userMessage: string
    }
  | {
      readonly disposition: 'transient'
      readonly code: 'transient_processing_failure'
      readonly userMessage: string
    }

/**
 * A deterministic failure caused by the document bytes or format.
 *
 * The row remains `failed` and can still be retried explicitly after its
 * content is replaced or repaired. The distinction is only about unattended
 * retries: rerunning the same bytes cannot change this outcome.
 */
export class PermanentDocumentProcessingError extends Error {
  readonly code: Exclude<DocumentProcessingFailureCode, 'transient_processing_failure'>

  constructor(
    code: Exclude<DocumentProcessingFailureCode, 'transient_processing_failure'>,
    userMessage: string,
    cause?: unknown
  ) {
    super(userMessage, cause === undefined ? undefined : { cause })
    this.name = 'PermanentDocumentProcessingError'
    this.code = code
  }
}

/**
 * Maximum vectors and embedding records retained before the atomic index swap.
 *
 * Each vector is an array of JavaScript numbers. At 3,072 dimensions, the old
 * 100,000-chunk ceiling could retain multiple gigabytes before accounting for
 * response JSON, chunk text, provenance, and insert records. Five thousand
 * bounds raw vector values to roughly 120 MiB while remaining far above an
 * ordinary document. Larger inputs need to be split to preserve the atomic
 * replacement behavior without silently truncating indexed content.
 */
export const MAX_DOCUMENT_CHUNKS = 5_000

/** Rejects an indexing pass before embedding vectors are allocated. */
export function assertDocumentChunkCountWithinLimit(chunkCount: number): void {
  if (chunkCount <= MAX_DOCUMENT_CHUNKS) return
  throw new PermanentDocumentProcessingError(
    'document_complexity_limit',
    `This document produced ${chunkCount.toLocaleString()} index chunks, exceeding the safe limit of ${MAX_DOCUMENT_CHUNKS.toLocaleString()}. Split it into smaller files or increase its knowledge-base chunk size, then retry.`
  )
}

export function isPermanentDocumentProcessingError(
  error: unknown
): error is PermanentDocumentProcessingError {
  return error instanceof PermanentDocumentProcessingError
}

const OFFICE_REPAIR_EXTENSIONS = new Set([
  'docx',
  'docm',
  'dotx',
  'xlsx',
  'xlsm',
  'xlsb',
  'xltx',
  'pptx',
  'pptm',
  'potx',
  'odt',
  'ods',
  'odp',
])

const ARCHIVE_SAFETY_PATTERN =
  /zipbomb|archive (?:entry|total)|compression ratio|too large to (?:parse|preview) safely/i
const ARCHIVE_INTEGRITY_PATTERN =
  /central directory|overlapping zip entries|archive contents do not match declared sizes|unverifiable zip-shaped archive/i
const ENCRYPTED_FILE_PATTERN =
  /password[- ]protected|encrypted (?:file|workbook|document)|password is required/i
const NO_TEXT_PATTERN = /no text could be extracted/i
const UNSUPPORTED_FILE_PATTERN = /unsupported file type|does not support buffer parsing/i
const INVALID_FILE_PATTERN = /empty buffer provided|invalid data uri format/i
const OFFICE_PARSE_PATTERN =
  /failed to parse (?:docx|xlsx|powerpoint|opendocument)|invalid (?:docx|xlsx|zip)|unsupported zip|corrupt(?:ed)? (?:office|document|workbook|archive)/i

function errorEvidence(error: unknown): string {
  const evidence: string[] = []
  const seen = new Set<unknown>()
  const pending: unknown[] = [error]

  while (pending.length > 0 && evidence.length < 16) {
    const current = pending.shift()
    if (current === undefined || current === null || seen.has(current)) continue
    seen.add(current)
    if (current instanceof Error) {
      evidence.push(current.name, current.message)
      if (current.cause !== undefined) pending.push(current.cause)
      if (current instanceof AggregateError) pending.push(...current.errors.slice(0, 8))
    } else {
      evidence.push(getErrorMessage(current))
    }
  }

  return evidence.join(' ')
}

function officeFormatName(filename: string): string {
  const extension = getFileExtension(filename)
  return extension ? extension.toUpperCase() : 'Office'
}

/**
 * Classifies only failures whose retry behavior is known from stable parser
 * evidence. Unknown exceptions stay transient so code, storage, database, and
 * provider outages are never silently dead-lettered as bad user input.
 */
export function classifyDocumentProcessingFailure(
  error: unknown,
  filename: string
): DocumentProcessingFailure {
  if (isPermanentDocumentProcessingError(error)) {
    return {
      disposition: 'permanent',
      code: error.code,
      userMessage: error.message,
    }
  }

  const extension = getFileExtension(filename)

  if (isFileParserError(error)) {
    switch (error.code) {
      case 'empty_input':
        return {
          disposition: 'permanent',
          code: 'invalid_file',
          userMessage: 'This file is empty or invalid. Replace it with a valid file and retry.',
        }
      case 'unsupported_type':
        return {
          disposition: 'permanent',
          code: 'unsupported_file_type',
          userMessage: 'This file type is not supported for indexing. Convert it and retry.',
        }
      case 'encrypted_file':
        return {
          disposition: 'permanent',
          code: 'encrypted_file',
          userMessage:
            'This file is encrypted or password-protected. Remove the protection and retry.',
        }
      case 'no_extractable_text':
        return {
          disposition: 'permanent',
          code: 'no_extractable_text',
          userMessage: error.message,
        }
      case 'invalid_format':
        return OFFICE_REPAIR_EXTENSIONS.has(extension)
          ? {
              disposition: 'permanent',
              code: 'unreadable_office_file',
              userMessage: `This ${officeFormatName(filename)} file could not be read. Open and re-save it as a valid ${officeFormatName(filename)} file, then retry.`,
            }
          : {
              disposition: 'permanent',
              code: 'invalid_file',
              userMessage:
                'This file is invalid or unreadable. Replace it with a valid file and retry.',
            }
      case 'complexity_limit':
        return {
          disposition: 'permanent',
          code: 'document_complexity_limit',
          userMessage:
            'This document exceeds safe processing complexity limits. Simplify it or split it into smaller files, then retry.',
        }
      case 'runtime_failure':
        return {
          disposition: 'transient',
          code: 'transient_processing_failure',
          userMessage: error.message,
        }
      default: {
        const exhaustiveCode: never = error.code
        return exhaustiveCode
      }
    }
  }

  const evidence = errorEvidence(error)

  if (error instanceof ArchiveIntegrityError || ARCHIVE_INTEGRITY_PATTERN.test(evidence)) {
    return OFFICE_REPAIR_EXTENSIONS.has(extension)
      ? {
          disposition: 'permanent',
          code: 'unreadable_office_file',
          userMessage: `This ${officeFormatName(filename)} file could not be read. Open and re-save it as a valid ${officeFormatName(filename)} file, then retry.`,
        }
      : {
          disposition: 'permanent',
          code: 'invalid_file',
          userMessage:
            'This archive is invalid or unreadable. Replace it with a valid file and retry.',
        }
  }

  if (error instanceof ZipBombError || ARCHIVE_SAFETY_PATTERN.test(evidence)) {
    return {
      disposition: 'permanent',
      code: 'archive_safety_limit',
      userMessage:
        'This file expands beyond the safe processing limit and was not indexed. Reduce its size or split it into smaller files, then retry.',
    }
  }

  if (ENCRYPTED_FILE_PATTERN.test(evidence)) {
    return {
      disposition: 'permanent',
      code: 'encrypted_file',
      userMessage: 'This file is encrypted or password-protected. Remove the protection and retry.',
    }
  }

  if (UNSUPPORTED_FILE_PATTERN.test(evidence)) {
    return {
      disposition: 'permanent',
      code: 'unsupported_file_type',
      userMessage: `This file type is not supported for indexing. Convert it to a supported format and retry.`,
    }
  }

  if (INVALID_FILE_PATTERN.test(evidence)) {
    return {
      disposition: 'permanent',
      code: 'invalid_file',
      userMessage: 'This file is empty or invalid. Replace it with a valid file and retry.',
    }
  }

  if (NO_TEXT_PATTERN.test(evidence)) {
    return {
      disposition: 'permanent',
      code: 'no_extractable_text',
      userMessage: getErrorMessage(error),
    }
  }

  if (OFFICE_REPAIR_EXTENSIONS.has(extension) && OFFICE_PARSE_PATTERN.test(evidence)) {
    return {
      disposition: 'permanent',
      code: 'unreadable_office_file',
      userMessage: `This ${officeFormatName(filename)} file could not be read. Open and re-save it as a valid ${officeFormatName(filename)} file, then retry.`,
    }
  }

  return {
    disposition: 'transient',
    code: 'transient_processing_failure',
    userMessage: getErrorMessage(error, 'Document processing failed. Please retry.'),
  }
}

/**
 * Preserves a typed permanent error or converts stable parser evidence into
 * one. Transient exceptions are returned unchanged by callers.
 */
export function toPermanentDocumentProcessingError(
  error: unknown,
  filename: string
): PermanentDocumentProcessingError | null {
  if (isPermanentDocumentProcessingError(error)) return error

  const failure = classifyDocumentProcessingFailure(error, filename)
  return failure.disposition === 'permanent'
    ? new PermanentDocumentProcessingError(failure.code, failure.userMessage, error)
    : null
}
