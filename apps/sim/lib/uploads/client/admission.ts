import {
  MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE,
  MAX_WORKSPACE_FORMDATA_FILE_SIZE,
} from '@/lib/uploads/shared/types'

export const MULTI_FILE_UPLOAD_MAX_FILES = 20
export const MULTI_FILE_UPLOAD_MAX_FILE_BYTES = Math.min(
  MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE,
  MAX_WORKSPACE_FORMDATA_FILE_SIZE
)
export const MULTI_FILE_UPLOAD_MAX_TOTAL_BYTES = 5 * MULTI_FILE_UPLOAD_MAX_FILE_BYTES

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
}

/**
 * Bounds one user upload action before previews, UI rows, or upload sessions are allocated.
 * Both consumers accept 100 MiB files, so five maximum-sized files form the 500 MiB aggregate
 * budget while the count cap still bounds actions containing many small files.
 */
export function assertMultiFileUploadAdmission(
  files: ArrayLike<UploadAdmissionFile>,
  options: MultiFileUploadAdmissionOptions = {}
): void {
  const existingFiles = options.existingFiles
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
      if (file.size > MULTI_FILE_UPLOAD_MAX_FILE_BYTES) {
        const label = file.name ? `"${file.name}"` : 'A selected file'
        throw new MultiFileUploadAdmissionError(
          `${label} is too large. Each file must be 100 MiB or smaller.`,
          'UPLOAD_FILE_SIZE_EXCEEDED'
        )
      }
      totalBytes += file.size
    }
  }

  if (totalBytes > MULTI_FILE_UPLOAD_MAX_TOTAL_BYTES) {
    throw new MultiFileUploadAdmissionError(
      'Select files totaling 500 MiB or less.',
      'UPLOAD_TOTAL_SIZE_EXCEEDED'
    )
  }
}
