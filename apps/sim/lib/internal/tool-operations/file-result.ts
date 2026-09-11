import type { UserFile } from '@/executor/types'

/** Binary output kept in process until the executor persists it. */
export interface InternalToolFile {
  buffer: Buffer
  name: string
  mimeType: string
}

/** The presenter receives stored descriptors, never inline file bytes. */
export interface InternalToolFileResult {
  kind: 'file-output'
  files: readonly InternalToolFile[]
  present: (files: readonly UserFile[]) => unknown
  init?: ResponseInit
}

export function createInternalToolFilesResult(
  files: readonly InternalToolFile[],
  present: InternalToolFileResult['present'],
  init?: ResponseInit
): InternalToolFileResult {
  return { kind: 'file-output', files, present, ...(init ? { init } : {}) }
}

export function createInternalToolFileResult(
  file: InternalToolFile,
  present: (file: UserFile) => unknown,
  init?: ResponseInit
): InternalToolFileResult {
  return createInternalToolFilesResult([file], (files) => present(files[0]!), init)
}

export function isInternalToolFileResult(value: unknown): value is InternalToolFileResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'file-output' &&
    'files' in value &&
    Array.isArray(value.files) &&
    'present' in value &&
    typeof value.present === 'function'
  )
}
