/**
 * Defense-in-depth ceiling on the size of any single workspace file upload.
 * Enforced both server-side (presigned route) and client-side (Files tab) so
 * users get fast feedback before bytes are streamed.
 */
export const MAX_WORKSPACE_FILE_SIZE = 5 * 1024 * 1024 * 1024

/**
 * Cap on the legacy FormData upload route, which buffers the whole file in
 * worker memory. Direct-to-storage uploads use {@link MAX_WORKSPACE_FILE_SIZE}.
 */
export const MAX_WORKSPACE_FORMDATA_FILE_SIZE = 100 * 1024 * 1024

export type StorageContext =
  | 'knowledge-base'
  | 'chat'
  | 'copilot'
  | 'mothership'
  | 'execution'
  | 'workspace'
  | 'profile-pictures'
  | 'og-images'
  | 'logs'
  | 'workspace-logos'

/**
 * Contexts exempt from storage quota checks — small metadata assets not managed
 * by the user (profile pictures, logos, OG images). All other contexts represent
 * user-driven uploads and must pass quota validation before upload is initiated.
 */
export const QUOTA_EXEMPT_STORAGE_CONTEXTS = new Set<StorageContext>([
  'profile-pictures',
  'workspace-logos',
  'og-images',
  'logs',
])

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
}

export interface DownloadFileOptions {
  key: string
  context?: StorageContext
}

export interface DeleteFileOptions {
  key: string
  context?: StorageContext
}

export interface GeneratePresignedUrlOptions {
  fileName: string
  contentType: string
  fileSize: number
  context: StorageContext
  userId?: string
  expirationSeconds?: number
  metadata?: Record<string, string>
  /**
   * When provided, overrides the default `${context}/${timestamp}-${id}-${name}` key derivation.
   * The caller takes responsibility for uniqueness and prefix conventions.
   */
  customKey?: string
}

export interface PresignedUrlResponse {
  url: string
  key: string
  uploadHeaders?: Record<string, string>
}
