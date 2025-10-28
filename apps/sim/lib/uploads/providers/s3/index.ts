export {
  type CustomS3Config,
  deleteFromS3,
  downloadFromS3,
  type FileInfo,
  getPresignedUrl,
  getPresignedUrlWithConfig,
  getS3Client,
  sanitizeFilenameForMetadata,
  uploadToS3,
} from '@/lib/uploads/providers/s3/s3-client'
