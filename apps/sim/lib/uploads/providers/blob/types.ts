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
