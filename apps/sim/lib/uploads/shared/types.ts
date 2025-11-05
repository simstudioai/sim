export type StorageContext =
  | 'knowledge-base'
  | 'chat'
  | 'copilot'
  | 'execution'
  | 'workspace'
  | 'profile-pictures'
  | 'logs'

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
}

export interface PresignedUrlResponse {
  url: string
  key: string
  uploadHeaders?: Record<string, string>
}
