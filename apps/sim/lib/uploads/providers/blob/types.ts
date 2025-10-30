/**
 * Custom Blob configuration
 */
export interface CustomBlobConfig {
  containerName: string
  accountName: string
  accountKey?: string
  connectionString?: string
}

/**
 * Azure multipart upload initialization options
 */
export interface AzureMultipartUploadInit {
  fileName: string
  contentType: string
  fileSize: number
  customConfig?: CustomBlobConfig
}

/**
 * Azure part upload URL
 */
export interface AzurePartUploadUrl {
  partNumber: number
  blockId: string
  url: string
}

/**
 * Azure multipart part
 */
export interface AzureMultipartPart {
  blockId: string
  partNumber: number
}
