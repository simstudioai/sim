export interface S3Config {
  bucket: string
  region: string
}

export interface S3MultipartUploadInit {
  fileName: string
  contentType: string
  fileSize: number
  customConfig?: S3Config
  /**
   * When provided, overrides the default `kb/${id}-${name}` key derivation.
   * Caller is responsible for uniqueness and prefix conventions.
   */
  customKey?: string
  /**
   * Storage purpose tag persisted as object metadata. Defaults to `knowledge-base`
   * for backwards compatibility.
   */
  purpose?: string
}

export interface S3PartUploadUrl {
  partNumber: number
  url: string
}

export interface S3MultipartPart {
  ETag: string
  PartNumber: number
}
