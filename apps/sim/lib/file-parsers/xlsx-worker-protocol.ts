import { FileParserError, type FileParserErrorCode } from '@/lib/file-parsers/errors'
import { ArchiveIntegrityError, ZipBombError } from '@/lib/file-parsers/ooxml-limits'
import type { FileParseOptions, FileParseResult } from '@/lib/file-parsers/types'

/**
 * Wire format between the XLSX parse worker and the main thread.
 *
 * Errors cannot cross `postMessage` with their class intact (structured clone
 * turns every error into a plain `Error`), and callers branch on the class and
 * `code` (`getFileParserErrorCode`), so each error the in-process parser can
 * throw is encoded by kind and rebuilt as the same class on the main side.
 */

type XlsxWorkerParseOptions = Omit<FileParseOptions, 'signal'>

export interface XlsxWorkerParseRequest {
  type: 'parse'
  data: Uint8Array
  options: XlsxWorkerParseOptions
}

interface SerializedCause {
  name: string
  message: string
}

export type SerializedXlsxWorkerError =
  | { kind: 'file-parser'; code: FileParserErrorCode; message: string; cause?: SerializedCause }
  | { kind: 'zip-bomb'; message: string }
  | { kind: 'archive-integrity'; message: string }
  | { kind: 'error'; name: string; message: string }

export type XlsxWorkerMessage =
  | { type: 'ready' }
  | { type: 'result'; result: FileParseResult }
  | { type: 'error'; error: SerializedXlsxWorkerError }

function serializeCause(cause: unknown): SerializedCause {
  if (cause instanceof Error) return { name: cause.name, message: cause.message }
  return { name: 'Error', message: String(cause) }
}

export function serializeXlsxWorkerError(error: unknown): SerializedXlsxWorkerError {
  if (error instanceof FileParserError) {
    return {
      kind: 'file-parser',
      code: error.code,
      message: error.message,
      ...(error.cause !== undefined && { cause: serializeCause(error.cause) }),
    }
  }
  if (error instanceof ZipBombError) return { kind: 'zip-bomb', message: error.message }
  if (error instanceof ArchiveIntegrityError) {
    return { kind: 'archive-integrity', message: error.message }
  }
  if (error instanceof Error) return { kind: 'error', name: error.name, message: error.message }
  return { kind: 'error', name: 'Error', message: String(error) }
}

export function deserializeXlsxWorkerError(error: SerializedXlsxWorkerError): Error {
  switch (error.kind) {
    case 'file-parser': {
      let cause: Error | undefined
      if (error.cause) {
        cause = new Error(error.cause.message)
        cause.name = error.cause.name
      }
      return new FileParserError(error.code, error.message, cause)
    }
    case 'zip-bomb':
      return new ZipBombError(error.message)
    case 'archive-integrity':
      return new ArchiveIntegrityError(error.message)
    default: {
      const rebuilt = new Error(error.message)
      rebuilt.name = error.name
      return rebuilt
    }
  }
}
