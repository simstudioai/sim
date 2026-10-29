/**
 * The file kinds the paged file list filters by. A file can be several at once — a `.json`
 * is a document whatever its stored type — so a filter naming more than one matches a file
 * that is any of them.
 *
 * - `document`: the extension is a supported document format (`SUPPORTED_DOCUMENT_EXTENSIONS`).
 * - `image` / `audio` / `video`: the file's effective MIME type (`resolveEffectiveMimeType`:
 *   the stored type, or the extension's when the stored one names no format) is that kind.
 */
export const WORKSPACE_FILE_KINDS = ['document', 'image', 'audio', 'video'] as const

export type WorkspaceFileKind = (typeof WORKSPACE_FILE_KINDS)[number]

export function isWorkspaceFileKind(value: string): value is WorkspaceFileKind {
  return (WORKSPACE_FILE_KINDS as readonly string[]).includes(value)
}

export const WORKSPACE_FILE_SIZE_BUCKETS = ['small', 'medium', 'large'] as const

export type WorkspaceFileSizeBucket = (typeof WORKSPACE_FILE_SIZE_BUCKETS)[number]

export function isWorkspaceFileSizeBucket(value: string): value is WorkspaceFileSizeBucket {
  return (WORKSPACE_FILE_SIZE_BUCKETS as readonly string[]).includes(value)
}

const MIB = 1_048_576

/**
 * Each size bucket's byte range, both bounds inclusive (`max: null` is unbounded): under 1 MiB,
 * 1 to 10 MiB, and over 10 MiB, as the filter's labels read.
 */
export const WORKSPACE_FILE_SIZE_BUCKET_RANGES: Readonly<
  Record<WorkspaceFileSizeBucket, { min: number; max: number | null }>
> = {
  small: { min: 0, max: MIB - 1 },
  medium: { min: MIB, max: 10 * MIB },
  large: { min: 10 * MIB + 1, max: null },
}
