/**
 * Custom S3 configuration
 */
export interface CustomS3Config {
  bucket: string
  region: string
}

/**
 * S3 multipart upload initialization options
 */
export interface S3MultipartUploadInit {
  fileName: string
  contentType: string
  fileSize: number
  customConfig?: CustomS3Config
}

/**
 * S3 part upload URL
 */
export interface S3PartUploadUrl {
  partNumber: number
  url: string
}

/**
 * S3 multipart part
 */
export interface S3MultipartPart {
  ETag: string
  PartNumber: number
}
