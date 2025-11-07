import type { ToolResponse } from '@/tools/types'

export interface SupabaseQueryParams {
  apiKey: string
  projectId: string
  table: string
  filter?: string
  orderBy?: string
  limit?: number
}

export interface SupabaseInsertParams {
  apiKey: string
  projectId: string
  table: string
  data: any
}

export interface SupabaseGetRowParams {
  apiKey: string
  projectId: string
  table: string
  filter: string
}

export interface SupabaseUpdateParams {
  apiKey: string
  projectId: string
  table: string
  filter: string
  data: any
}

export interface SupabaseDeleteParams {
  apiKey: string
  projectId: string
  table: string
  filter: string
}

export interface SupabaseUpsertParams {
  apiKey: string
  projectId: string
  table: string
  data: any
}

export interface SupabaseVectorSearchParams {
  apiKey: string
  projectId: string
  functionName: string
  queryEmbedding: number[]
  matchThreshold?: number
  matchCount?: number
}

export interface SupabaseBaseResponse extends ToolResponse {
  output: {
    message: string
    results: any
  }
  error?: string
}

export interface SupabaseQueryResponse extends SupabaseBaseResponse {}

export interface SupabaseInsertResponse extends SupabaseBaseResponse {}

export interface SupabaseGetRowResponse extends SupabaseBaseResponse {}

export interface SupabaseUpdateResponse extends SupabaseBaseResponse {}

export interface SupabaseDeleteResponse extends SupabaseBaseResponse {}

export interface SupabaseUpsertResponse extends SupabaseBaseResponse {}

export interface SupabaseVectorSearchResponse extends SupabaseBaseResponse {}

export interface SupabaseResponse extends SupabaseBaseResponse {}

// RPC types
export interface SupabaseRpcParams {
  apiKey: string
  projectId: string
  functionName: string
  params?: any
}

export interface SupabaseRpcResponse extends SupabaseBaseResponse {}

// Text Search types
export interface SupabaseTextSearchParams {
  apiKey: string
  projectId: string
  table: string
  column: string
  query: string
  searchType?: string
  language?: string
  limit?: number
}

export interface SupabaseTextSearchResponse extends SupabaseBaseResponse {}

// Count types
export interface SupabaseCountParams {
  apiKey: string
  projectId: string
  table: string
  filter?: string
  countType?: string
}

export interface SupabaseCountResponse extends ToolResponse {
  output: {
    message: string
    count: number
  }
  error?: string
}

// Storage Upload types
export interface SupabaseStorageUploadParams {
  apiKey: string
  projectId: string
  bucket: string
  path: string
  fileContent: string
  contentType?: string
  upsert?: boolean
}

export interface SupabaseStorageUploadResponse extends SupabaseBaseResponse {}

// Storage Download types
export interface SupabaseStorageDownloadParams {
  apiKey: string
  projectId: string
  bucket: string
  path: string
  fileName?: string
}

export interface SupabaseStorageDownloadResponse extends ToolResponse {
  output: {
    file: {
      name: string
      mimeType: string
      data: string | Buffer
      size: number
    }
  }
  error?: string
}

// Storage List types
export interface SupabaseStorageListParams {
  apiKey: string
  projectId: string
  bucket: string
  path?: string
  limit?: number
  offset?: number
  sortBy?: string
  sortOrder?: string
  search?: string
}

export interface SupabaseStorageListResponse extends SupabaseBaseResponse {}

// Storage Delete types
export interface SupabaseStorageDeleteParams {
  apiKey: string
  projectId: string
  bucket: string
  paths: string[]
}

export interface SupabaseStorageDeleteResponse extends SupabaseBaseResponse {}

// Storage Move types
export interface SupabaseStorageMoveParams {
  apiKey: string
  projectId: string
  bucket: string
  fromPath: string
  toPath: string
}

export interface SupabaseStorageMoveResponse extends SupabaseBaseResponse {}

// Storage Copy types
export interface SupabaseStorageCopyParams {
  apiKey: string
  projectId: string
  bucket: string
  fromPath: string
  toPath: string
}

export interface SupabaseStorageCopyResponse extends SupabaseBaseResponse {}

// Storage Create Bucket types
export interface SupabaseStorageCreateBucketParams {
  apiKey: string
  projectId: string
  bucket: string
  isPublic?: boolean
  fileSizeLimit?: number
  allowedMimeTypes?: string[]
}

export interface SupabaseStorageCreateBucketResponse extends SupabaseBaseResponse {}

// Storage List Buckets types
export interface SupabaseStorageListBucketsParams {
  apiKey: string
  projectId: string
}

export interface SupabaseStorageListBucketsResponse extends SupabaseBaseResponse {}

// Storage Delete Bucket types
export interface SupabaseStorageDeleteBucketParams {
  apiKey: string
  projectId: string
  bucket: string
}

export interface SupabaseStorageDeleteBucketResponse extends SupabaseBaseResponse {}

// Storage Get Public URL types
export interface SupabaseStorageGetPublicUrlParams {
  apiKey: string
  projectId: string
  bucket: string
  path: string
  download?: boolean
}

export interface SupabaseStorageGetPublicUrlResponse extends ToolResponse {
  output: {
    message: string
    publicUrl: string
  }
  error?: string
}

// Storage Create Signed URL types
export interface SupabaseStorageCreateSignedUrlParams {
  apiKey: string
  projectId: string
  bucket: string
  path: string
  expiresIn: number
  download?: boolean
}

export interface SupabaseStorageCreateSignedUrlResponse extends ToolResponse {
  output: {
    message: string
    signedUrl: string
  }
  error?: string
}
