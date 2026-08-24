import { getErrorMessage } from '@sim/utils/errors'
import { ArchiveIntegrityError, ZipBombError } from '@/lib/file-parsers/ooxml-limits'

export const FILE_PARSER_ERROR_CODES = [
  'empty_input',
  'unsupported_type',
  'encrypted_file',
  'no_extractable_text',
  'invalid_format',
  'complexity_limit',
  'runtime_failure',
] as const

export type FileParserErrorCode = (typeof FILE_PARSER_ERROR_CODES)[number]

/** A typed failure reported at the untrusted-file parsing boundary. */
export class FileParserError extends Error {
  readonly code: FileParserErrorCode

  constructor(code: FileParserErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'FileParserError'
    this.code = code
  }
}

export function isFileParserError(error: unknown): error is FileParserError {
  return error instanceof FileParserError
}

/**
 * Wraps an untyped parser-library exception without erasing a typed inner cause.
 * Archive safety failures remain {@link ZipBombError} so every caller can enforce
 * the guard without knowing which parser happened to receive the archive.
 */
export function toFileParserError(
  error: unknown,
  code: FileParserErrorCode,
  message: string
): FileParserError | ZipBombError | ArchiveIntegrityError {
  if (
    error instanceof ZipBombError ||
    error instanceof ArchiveIntegrityError ||
    isFileParserError(error)
  ) {
    return error
  }
  return new FileParserError(code, `${message}: ${getErrorMessage(error)}`, error)
}

/**
 * SheetJS exposes encrypted-workbook failures only through its exception text.
 * Localizing that adapter-specific check here converts it to a stable code before
 * it crosses the parser boundary; domain code never needs to match vendor text.
 */
export function isEncryptedOfficeParserError(error: unknown): boolean {
  return /password[- ]protected|password is required|encrypted (?:file|workbook|document)/i.test(
    getErrorMessage(error)
  )
}
