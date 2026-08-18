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

/**
 * Rejection wording shared by every surface that admits a knowledge document.
 *
 * The size guards were upper-bound only, so a zero-byte file passed admission
 * and was stored and registered — but the parsing pipeline refuses an empty
 * buffer outright (`parseBuffer` throws before dispatching to a parser), so the
 * document could never reach anything but `failed`. A file the pipeline is
 * guaranteed to reject is a bad request, and admission is the only place a
 * caller can be told so.
 */
export const EMPTY_KNOWLEDGE_DOCUMENT_MESSAGE = 'Knowledge document cannot be empty'

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

/**
 * The contexts stored under the `workspace/` key prefix. They share a bucket and
 * a workspace tenancy scope and differ only in which module owns the object: the
 * Files module, or a mothership chat that the file was attached to.
 *
 * The prefix cannot separate them, and it never will — `materialize_file`
 * promotes an attachment to a workspace file by flipping the row, so ownership
 * is mutable while the key is not. Anything that needs the owning module reads
 * `workspace_files.context`; the prefix answers only bucket and tenancy.
 */
export const WORKSPACE_SCOPED_CONTEXTS = ['workspace', 'mothership'] as const

export type WorkspaceScopedContext = (typeof WORKSPACE_SCOPED_CONTEXTS)[number]

export function isWorkspaceScopedContext(
  context: string | null | undefined
): context is WorkspaceScopedContext {
  return WORKSPACE_SCOPED_CONTEXTS.includes(context as WorkspaceScopedContext)
}

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
