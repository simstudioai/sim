export const MAX_DESKTOP_IMPORT_FILE_BYTES = 64 * 1024 * 1024

/**
 * The header a background import presents its claim's execution token in. A header, not the
 * query, so the token stays out of load balancer, CDN and trace URLs.
 */
export const DESKTOP_IMPORT_TOKEN_HEADER = 'x-sim-execution-token'

/**
 * Whether a single file or folder name can be stored as a workspace file name: something left
 * after trimming, not a dot segment, and no path separator.
 */
export function isStorableImportName(name: string): boolean {
  const trimmed = name.trim()
  return (
    trimmed !== '' &&
    trimmed !== '.' &&
    trimmed !== '..' &&
    !trimmed.includes('/') &&
    !trimmed.includes('\\')
  )
}

/** Native desktop file operations require local consent and canonical pending chat calls. */
export type DesktopLocalFileRequest =
  | { operation: 'read' | 'manifest'; toolCallId: string }
  | {
      operation: 'chunk'
      toolCallId: string
      relativePath: string
      offset: number
      revision: string
    }

export interface DesktopLocalFileEntry {
  relativePath: string
  kind: 'file' | 'directory'
  size: number
  revision: string
}

export interface DesktopLocalFileManifest {
  kind: 'manifest'
  name: string
  targetWorkspaceId: string
  folderId?: string
  entries: DesktopLocalFileEntry[]
}

export interface DesktopLocalFileRead {
  kind: 'read'
  path: string
  representation: 'text' | 'directory' | 'visual' | 'binary'
  text?: string
  offset?: number
  nextOffset?: number
  truncated?: boolean
  entries?: Array<{ name: string; kind: 'file' | 'directory' | 'symlink' | 'other' }>
  note?: string
  observations?: Array<{
    name: string
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'application/pdf'
    data: string
    pageCount?: number
  }>
}

export type DesktopLocalFileResponse =
  | {
      ok: true
      data:
        | DesktopLocalFileRead
        | DesktopLocalFileManifest
        | { kind: 'chunk'; bytes: Uint8Array; eof: boolean }
    }
  | { ok: false; error: string; code?: 'ALREADY_STARTED' }
