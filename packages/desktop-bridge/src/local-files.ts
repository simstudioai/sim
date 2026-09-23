export const MAX_DESKTOP_IMPORT_FILE_BYTES = 64 * 1024 * 1024

/** Native desktop file operations use OS permissions and canonical pending chat calls. */
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
