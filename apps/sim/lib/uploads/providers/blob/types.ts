export interface BlobConfig {
  containerName: string
  accountName: string
  accountKey?: string
  connectionString?: string
}

export interface AzureMultipartUploadInit {
  fileName: string
  contentType: string
  fileSize: number
  customConfig?: BlobConfig
  /**
   * When provided, overrides the default `kb/${id}-${name}` key derivation.
   * Caller is responsible for uniqueness and prefix conventions.
   */
  customKey?: string
}

export interface AzurePartUploadUrl {
  partNumber: number
  blockId: string
  url: string
}

export interface AzureMultipartPart {
  blockId: string
  partNumber: number
}
