/**
 * Defense-in-depth ceiling on the size of any single workspace file upload.
 * Enforced both server-side (upload-session creation) and client-side (Files tab) so
 * users get fast feedback before bytes are streamed.
 */
export const MAX_WORKSPACE_FILE_SIZE = 5 * 1024 * 1024 * 1024

const MAX_POSTGRES_INTEGER = 2_147_483_647

/**
 * Keeps the legacy int4 metadata projection writable while `size_bytes` stores the exact value.
 */
export function toLegacyWorkspaceFileSize(size: number): number {
  if (!Number.isSafeInteger(size) || size < 0)
    throw new Error(`Invalid workspace file size: ${size}`)
  return Math.min(size, MAX_POSTGRES_INTEGER)
}

/**
 * Cap on the legacy FormData upload route, which buffers the whole file in
 * worker memory. Direct-to-storage uploads use {@link MAX_WORKSPACE_FILE_SIZE}.
 */
export const MAX_WORKSPACE_FORMDATA_FILE_SIZE = 100 * 1024 * 1024

/** Maximum size accepted by the knowledge-document parsing pipeline. */
export const MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE = 100 * 1024 * 1024

export type StorageContext =
  | 'knowledge-base'
  | 'chat'
  | 'copilot'
  | 'mothership'
  | 'execution'
  | 'workspace'
  | 'table-import'
  | 'profile-pictures'
  | 'og-images'
  | 'logs'
  | 'workspace-logos'

export type MultipartCompletionPolicy = 'create-only' | 'replace' | 'reuse-existing'

export interface FileInfo {
  path: string
  key: string
  name: string
  size: number
  type: string
}

export interface StorageConfig {
  bucket?: string
  region?: string
  containerName?: string
  accountName?: string
  accountKey?: string
  connectionString?: string
}

export interface UploadFileOptions {
  file: Buffer
  fileName: string
  contentType: string
  context: StorageContext
  preserveKey?: boolean
  customKey?: string
  metadata?: Record<string, string>
  /**
   * Whether the storage service should also persist its generic metadata row.
   * Disable when a caller finalizes metadata in its own database transaction.
   */
  persistMetadata?: boolean
}

export interface DownloadFileOptions {
  key: string
  context?: StorageContext
  maxBytes?: number
}

export interface DeleteFileOptions {
  key: string
  context?: StorageContext
}

export interface StoredObjectInfo {
  size: number
  contentType?: string
  metadata?: Record<string, string>
  uploadId?: string
  version?: string
}
