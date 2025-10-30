export interface S3Config {
  bucket: string
  region: string
}

export interface S3MultipartUploadInit {
  fileName: string
  contentType: string
  fileSize: number
  customConfig?: S3Config
}

export interface S3PartUploadUrl {
  partNumber: number
  url: string
}

export interface S3MultipartPart {
  ETag: string
  PartNumber: number
}
