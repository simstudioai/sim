export interface GcsConfig {
  bucket: string
}

export interface GcsMultipartUploadInit {
  fileName: string
  contentType: string
  fileSize: number
  customConfig?: GcsConfig
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

export interface GcsPartUploadUrl {
  partNumber: number
  url: string
}

export interface GcsMultipartPart {
  ETag: string
  PartNumber: number
}
