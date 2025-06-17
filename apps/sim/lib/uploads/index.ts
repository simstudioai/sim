// Export the storage abstraction layer

export * as BlobClient from './blob/blob-client'
// Export specific storage clients for advanced use cases
export * as S3Client from './s3/s3-client'
// Export configuration
export {
  BLOB_CONFIG,
  BLOB_KB_CONFIG,
  ensureUploadsDirectory,
  S3_CONFIG,
  S3_KB_CONFIG,
  UPLOAD_DIR,
  USE_BLOB_STORAGE,
  USE_S3_STORAGE,
} from './setup'
export {
  type CustomStorageConfig,
  deleteFile,
  downloadFile,
  type FileInfo,
  getPresignedUrl,
  getPresignedUrlWithConfig,
  getServePathPrefix,
  getStorageProvider,
  isUsingCloudStorage,
  uploadFile,
} from './storage-client'
