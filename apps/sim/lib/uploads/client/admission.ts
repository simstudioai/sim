import {
  MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE,
  MAX_WORKSPACE_FORMDATA_FILE_SIZE,
} from '@/lib/uploads/shared/types'

export const MULTI_FILE_UPLOAD_MAX_FILES = 20
const MULTI_FILE_UPLOAD_MAX_TOTAL_FILE_EQUIVALENTS = 5
export const MULTI_FILE_UPLOAD_MAX_FILE_BYTES = Math.min(
  MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE,
  MAX_WORKSPACE_FORMDATA_FILE_SIZE
)
export const MULTI_FILE_UPLOAD_MAX_TOTAL_BYTES =
  MULTI_FILE_UPLOAD_MAX_TOTAL_FILE_EQUIVALENTS * MULTI_FILE_UPLOAD_MAX_FILE_BYTES

export type MultiFileUploadAdmissionErrorCode =
  | 'UPLOAD_FILE_COUNT_EXCEEDED'
  | 'UPLOAD_FILE_SIZE_EXCEEDED'
  | 'UPLOAD_TOTAL_SIZE_EXCEEDED'

export class MultiFileUploadAdmissionError extends Error {
  constructor(
    message: string,
    readonly code: MultiFileUploadAdmissionErrorCode
  ) {
    super(message)
    this.name = 'MultiFileUploadAdmissionError'
  }
}

interface UploadAdmissionFile {
  readonly name?: string
  readonly size: number
}

interface MultiFileUploadAdmissionOptions {
  existingFiles?: ArrayLike<UploadAdmissionFile>
  maxFileBytes?: number
  maxTotalBytes?: number
}

/**
 * Bounds one user upload action before previews, UI rows, or upload sessions are allocated.
 * Knowledge uploads use the shared 100 MiB / 500 MiB defaults. Direct-to-storage consumers may
 * provide their larger server-side limit while retaining the same count and aggregate bounds.
 */
export function assertMultiFileUploadAdmission(
  files: ArrayLike<UploadAdmissionFile>,
  options: MultiFileUploadAdmissionOptions = {}
): void {
  const existingFiles = options.existingFiles
  const maxFileBytes = options.maxFileBytes ?? MULTI_FILE_UPLOAD_MAX_FILE_BYTES
  const maxTotalBytes =
    options.maxTotalBytes ?? MULTI_FILE_UPLOAD_MAX_TOTAL_FILE_EQUIVALENTS * maxFileBytes
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) {
    throw new Error('Invalid per-file upload limit')
  }
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < maxFileBytes) {
    throw new Error('Invalid aggregate upload limit')
  }
  const existingCount = existingFiles?.length ?? 0
  const totalCount = existingCount + files.length
  if (totalCount > MULTI_FILE_UPLOAD_MAX_FILES) {
    throw new MultiFileUploadAdmissionError(
      `Select up to ${MULTI_FILE_UPLOAD_MAX_FILES} files at a time.`,
      'UPLOAD_FILE_COUNT_EXCEEDED'
    )
  }

  let totalBytes = 0
  const groups = existingFiles ? [existingFiles, files] : [files]
  for (const group of groups) {
    for (let index = 0; index < group.length; index++) {
      const file = group[index]
      if (!file || !Number.isSafeInteger(file.size) || file.size < 0) {
        throw new Error('Invalid file size in upload selection')
      }
      if (file.size > maxFileBytes) {
        const label = file.name ? `"${file.name}"` : 'A selected file'
        throw new MultiFileUploadAdmissionError(
          `${label} is too large. Each file must be ${formatBinaryBytes(maxFileBytes)} or smaller.`,
          'UPLOAD_FILE_SIZE_EXCEEDED'
        )
      }
      totalBytes += file.size
    }
  }

  if (totalBytes > maxTotalBytes) {
    throw new MultiFileUploadAdmissionError(
      `Select files totaling ${formatBinaryBytes(maxTotalBytes)} or less.`,
      'UPLOAD_TOTAL_SIZE_EXCEEDED'
    )
  }
}

function formatBinaryBytes(bytes: number): string {
  const gibibyte = 1024 ** 3
  if (bytes % gibibyte === 0) return `${bytes / gibibyte} GiB`
  const mebibyte = 1024 ** 2
  if (bytes % mebibyte === 0) return `${bytes / mebibyte} MiB`
  return `${bytes} bytes`
}
