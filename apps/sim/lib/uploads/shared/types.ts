/**
 * Defense-in-depth ceiling on the size of any single workspace file upload.
 * Enforced both server-side (upload-session creation) and client-side (Files tab) so
 * users get fast feedback before bytes are streamed.
 */
export const MAX_WORKSPACE_FILE_SIZE = 5 * 1024 * 1024 * 1024

/**
 * Returns the canonical workspace-file byte size after the `size_bytes` cutover.
 *
 * The migration backfills every existing row before the new application image is
 * promoted, and its compatibility trigger fills the column for writes from an old
 * image during rollout. A null therefore indicates migration drift, not a legacy row.
 */
export function getWorkspaceFileSize(file: { sizeBytes: number | null }): number {
  if (file.sizeBytes === null) {
    throw new Error('Workspace file is missing canonical size_bytes metadata')
  }
  if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) {
    throw new Error(`Invalid workspace file size: ${file.sizeBytes}`)
  }
  return file.sizeBytes
}

/**
 * Cap on the legacy FormData upload route, which buffers the whole file in
 * worker memory. Direct-to-storage uploads use {@link MAX_WORKSPACE_FILE_SIZE}.
 */
export const MAX_WORKSPACE_FORMDATA_FILE_SIZE = 100 * 1024 * 1024

/** Maximum size accepted by the knowledge-document parsing pipeline. */
export const MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE = 100 * 1024 * 1024

/**
 * Default ceiling for a read that holds the whole file resident as one `Buffer`.
 *
 * Workspace files are admitted at {@link MAX_WORKSPACE_FILE_SIZE} (5 GB) because they
 * are streamed straight to object storage and never sit in the app process. A tool
 * that pulls one back to hand it to a third party does not stream — it buffers, then
 * usually copies again (base64, `Blob`, multipart), so peak resident memory is a
 * multiple of the file. Sharing one ceiling keeps that multiple bounded no matter how
 * many blocks run concurrently.
 *
 * 100 MB is the value this codebase already converged on for buffered work
 * ({@link MAX_WORKSPACE_FORMDATA_FILE_SIZE}, `MAX_ARCHIVE_BYTES`, the 100 MB
 * `maxResponseBytes` on the STT URL branch, and the ClickUp/Vanta/Daytona/Linq/SFTP
 * upload routes). Use a destination's own documented limit instead whenever it is
 * lower — failing here beats a slow round trip to a provider that will reject it.
 * Genuinely large transfers belong on `downloadFileStream`, not on a bigger ceiling.
 */
export const MAX_BUFFERED_TRANSFER_BYTES = 100 * 1024 * 1024

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
  /** Internal create-only upload identity when metadata and cleanup were reserved before writing bytes. */
  createOnlyUploadId?: string
  signal?: AbortSignal
}

export interface DownloadFileOptions {
  key: string
  context?: StorageContext
  maxBytes?: number
  signal?: AbortSignal
}

export interface DeleteFileOptions {
  key: string
  context?: StorageContext
  signal?: AbortSignal
}

export interface StoredObjectInfo {
  size: number
  contentType?: string
  metadata?: Record<string, string>
  uploadId?: string
  version?: string
}
