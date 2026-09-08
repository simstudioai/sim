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
 * A mutable billing gate that must stop this attempt without consuming the
 * document's unattended retry budget. A plan upgrade or credit top-up can make
 * the same bytes processable, so this is intentionally not a permanent input
 * failure and must not be retried immediately by Trigger.dev.
 */
export class UsageLimitDocumentProcessingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageLimitDocumentProcessingError'
  }
}

export function isUsageLimitDocumentProcessingError(
  error: unknown
): error is UsageLimitDocumentProcessingError {
  return error instanceof UsageLimitDocumentProcessingError
}

/**
 * Maximum vectors and embedding records retained before the atomic index swap.
 *
 * At the supported maximum width, each vector contains 3,072 JavaScript numbers. The old 100,000-chunk
 * ceiling could retain well over a gigabyte before response JSON, array
 * overhead, chunk text, provenance, and insert records. Five thousand bounds
 * raw vector values to roughly 117 MiB while preserving the atomic replacement
 * behavior instead of silently truncating indexed content.
 */
export const MAX_DOCUMENT_CHUNKS = 5_000

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
  'doc',
  'docx',
  'docm',
  'dotx',
  'xls',
  'xlsx',
  'xlsm',
  'xlsb',
  'xltx',
  'ppt',
  'pptx',
  'pptm',
  'potx',
  'odt',
  'ods',
  'odp',
])

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

  if (error instanceof ArchiveIntegrityError) {
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

  if (error instanceof ZipBombError) {
    return {
      disposition: 'permanent',
      code: 'archive_safety_limit',
      userMessage:
        'This file expands beyond the safe processing limit and was not indexed. Reduce its size or split it into smaller files, then retry.',
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
