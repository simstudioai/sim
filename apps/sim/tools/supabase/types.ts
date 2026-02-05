import type { UserFile } from '@/executor/types'
import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Supabase API responses.
 * Based on official Supabase REST API and Storage API documentation.
 * @see https://supabase.com/docs/reference/javascript/introduction
 * @see https://supabase.com/docs/guides/storage
 */

/**
 * Output definition for storage file metadata object
 * Returned by storage list operations
 * @see https://github.com/supabase/storage-js/blob/main/src/lib/types.ts
 */
export const STORAGE_FILE_METADATA_OUTPUT_PROPERTIES = {
  size: { type: 'number', description: 'File size in bytes', optional: true },
  mimetype: { type: 'string', description: 'MIME type of the file', optional: true },
  cacheControl: { type: 'string', description: 'Cache control header value', optional: true },
  lastModified: { type: 'string', description: 'Last modified timestamp', optional: true },
  eTag: { type: 'string', description: 'Entity tag for caching', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for storage file objects returned by list operations
 * @see https://github.com/supabase/storage-js/blob/main/src/lib/types.ts
 */
export const STORAGE_FILE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique file identifier' },
  name: { type: 'string', description: 'File name' },
  bucket_id: { type: 'string', description: 'Bucket identifier the file belongs to' },
  owner: { type: 'string', description: 'Owner identifier', optional: true },
  created_at: { type: 'string', description: 'File creation timestamp' },
  updated_at: { type: 'string', description: 'Last update timestamp' },
  last_accessed_at: { type: 'string', description: 'Last access timestamp' },
  metadata: {
    type: 'object',
    description: 'File metadata including size and MIME type',
    properties: STORAGE_FILE_METADATA_OUTPUT_PROPERTIES,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete storage file object output definition
 */
export const STORAGE_FILE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Storage file object with metadata',
  properties: STORAGE_FILE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for storage bucket objects
 * @see https://github.com/supabase/storage-js/blob/main/src/lib/types.ts
 */
export const STORAGE_BUCKET_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique bucket identifier' },
  name: { type: 'string', description: 'Bucket name' },
  owner: { type: 'string', description: 'Owner identifier', optional: true },
  public: { type: 'boolean', description: 'Whether the bucket is publicly accessible' },
  created_at: { type: 'string', description: 'Bucket creation timestamp' },
  updated_at: { type: 'string', description: 'Last update timestamp' },
  file_size_limit: {
    type: 'number',
    description: 'Maximum file size allowed in bytes',
    optional: true,
  },
  allowed_mime_types: {
    type: 'array',
    description: 'List of allowed MIME types for uploads',
    items: { type: 'string', description: 'MIME type' },
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete storage bucket object output definition
 */
export const STORAGE_BUCKET_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Storage bucket object with configuration',
  properties: STORAGE_BUCKET_OUTPUT_PROPERTIES,
}

/**
 * Output definition for storage upload response
 * @see https://supabase.com/docs/reference/javascript/storage-from-upload
 */
export const STORAGE_UPLOAD_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the uploaded file' },
  path: { type: 'string', description: 'Path to the uploaded file within the bucket' },
  fullPath: { type: 'string', description: 'Full path including bucket name' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for storage move/copy response
 * @see https://supabase.com/docs/reference/javascript/storage-from-move
 */
export const STORAGE_MOVE_OUTPUT_PROPERTIES = {
  message: { type: 'string', description: 'Operation status message' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for storage copy response
 * Returns: { path: string }
 * @see https://github.com/supabase/storage-js/blob/main/src/packages/StorageFileApi.ts
 */
export const STORAGE_COPY_OUTPUT_PROPERTIES = {
  path: { type: 'string', description: 'Path to the copied file' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for storage delete bucket response
 * Returns a confirmation message
 */
export const STORAGE_DELETE_BUCKET_OUTPUT_PROPERTIES = {
  message: { type: 'string', description: 'Operation status message' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for storage create bucket response
 * @see https://supabase.com/docs/reference/javascript/storage-createbucket
 */
export const STORAGE_CREATE_BUCKET_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Created bucket name' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for storage delete files response
 * Returns array of deleted file objects
 */
export const STORAGE_DELETED_FILE_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Name of the deleted file' },
  bucket_id: { type: 'string', description: 'Bucket identifier', optional: true },
  owner: { type: 'string', description: 'Owner identifier', optional: true },
  id: { type: 'string', description: 'Unique file identifier', optional: true },
  updated_at: { type: 'string', description: 'Last update timestamp', optional: true },
  created_at: { type: 'string', description: 'File creation timestamp', optional: true },
  last_accessed_at: { type: 'string', description: 'Last access timestamp', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for download file response
 */
export const STORAGE_DOWNLOAD_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'File name' },
  mimeType: { type: 'string', description: 'MIME type of the file' },
  data: { type: 'string', description: 'Base64 encoded file content' },
  size: { type: 'number', description: 'File size in bytes' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete download file object output definition
 */
export const STORAGE_DOWNLOAD_FILE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Downloaded file with content and metadata',
  properties: STORAGE_DOWNLOAD_OUTPUT_PROPERTIES,
}

/**
 * Output definition for public URL response
 */
export const STORAGE_PUBLIC_URL_OUTPUT_PROPERTIES = {
  publicUrl: { type: 'string', description: 'The public URL to access the file' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for signed URL response
 */
export const STORAGE_SIGNED_URL_OUTPUT_PROPERTIES = {
  signedUrl: { type: 'string', description: 'The temporary signed URL to access the file' },
} as const satisfies Record<string, OutputProperty>

/**
 * Storage files array output definition for list operations
 */
export const STORAGE_FILES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of file objects with metadata',
  items: {
    type: 'object',
    properties: STORAGE_FILE_OUTPUT_PROPERTIES,
  },
}

/**
 * Storage buckets array output definition for list buckets operations
 */
export const STORAGE_BUCKETS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of bucket objects',
  items: {
    type: 'object',
    properties: STORAGE_BUCKET_OUTPUT_PROPERTIES,
  },
}

/**
 * Storage deleted files array output definition
 */
export const STORAGE_DELETED_FILES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of deleted file objects',
  items: {
    type: 'object',
    properties: STORAGE_DELETED_FILE_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for foreign key reference in column schema
 */
export const INTROSPECT_REFERENCE_OUTPUT_PROPERTIES = {
  table: { type: 'string', description: 'Referenced table name' },
  column: { type: 'string', description: 'Referenced column name' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for introspect column schema
 */
export const INTROSPECT_COLUMN_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Column name' },
  type: { type: 'string', description: 'Column data type' },
  nullable: { type: 'boolean', description: 'Whether the column allows null values' },
  default: { type: 'string', description: 'Default value for the column', optional: true },
  isPrimaryKey: { type: 'boolean', description: 'Whether the column is a primary key' },
  isForeignKey: { type: 'boolean', description: 'Whether the column is a foreign key' },
  references: {
    type: 'object',
    description: 'Foreign key reference details',
    optional: true,
    properties: INTROSPECT_REFERENCE_OUTPUT_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for introspect foreign key
 */
export const INTROSPECT_FOREIGN_KEY_OUTPUT_PROPERTIES = {
  column: { type: 'string', description: 'Local column name' },
  referencesTable: { type: 'string', description: 'Referenced table name' },
  referencesColumn: { type: 'string', description: 'Referenced column name' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for introspect index
 */
export const INTROSPECT_INDEX_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Index name' },
  columns: {
    type: 'array',
    description: 'Columns included in the index',
    items: { type: 'string', description: 'Column name' },
  },
  unique: { type: 'boolean', description: 'Whether the index enforces uniqueness' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for introspect table schema
 */
export const INTROSPECT_TABLE_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Table name' },
  schema: { type: 'string', description: 'Database schema name' },
  columns: {
    type: 'array',
    description: 'Array of column definitions',
    items: {
      type: 'object',
      properties: INTROSPECT_COLUMN_OUTPUT_PROPERTIES,
    },
  },
  primaryKey: {
    type: 'array',
    description: 'Array of primary key column names',
    items: { type: 'string', description: 'Column name' },
  },
  foreignKeys: {
    type: 'array',
    description: 'Array of foreign key relationships',
    items: {
      type: 'object',
      properties: INTROSPECT_FOREIGN_KEY_OUTPUT_PROPERTIES,
    },
  },
  indexes: {
    type: 'array',
    description: 'Array of index definitions',
    items: {
      type: 'object',
      properties: INTROSPECT_INDEX_OUTPUT_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Introspect tables array output definition
 */
export const INTROSPECT_TABLES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of table schemas with columns, keys, and indexes',
  items: {
    type: 'object',
    properties: INTROSPECT_TABLE_OUTPUT_PROPERTIES,
  },
}

export interface SupabaseQueryParams {
  apiKey: string
  projectId: string
  table: string
  schema?: string
  select?: string
  filter?: string
  orderBy?: string
  limit?: number
}

export interface SupabaseInsertParams {
  apiKey: string
  projectId: string
  table: string
  schema?: string
  data: any
}

export interface SupabaseGetRowParams {
  apiKey: string
  projectId: string
  table: string
  schema?: string
  select?: string
  filter: string
}

export interface SupabaseUpdateParams {
  apiKey: string
  projectId: string
  table: string
  schema?: string
  filter: string
  data: any
}

export interface SupabaseDeleteParams {
  apiKey: string
  projectId: string
  table: string
  schema?: string
  filter: string
}

export interface SupabaseUpsertParams {
  apiKey: string
  projectId: string
  table: string
  schema?: string
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
  schema?: string
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
  schema?: string
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
  fileName: string
  path?: string
  fileData: UserFile | string
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

/**
 * Parameters for introspecting a Supabase database schema
 */
export interface SupabaseIntrospectParams {
  apiKey: string
  projectId: string
  schema?: string
}

/**
 * Column information for a database table
 */
export interface SupabaseColumnSchema {
  name: string
  type: string
  nullable: boolean
  default: string | null
  isPrimaryKey: boolean
  isForeignKey: boolean
  references?: { table: string; column: string }
}

/**
 * Table schema information including columns, keys, and indexes
 */
export interface SupabaseTableSchema {
  name: string
  schema: string
  columns: SupabaseColumnSchema[]
  primaryKey: string[]
  foreignKeys: Array<{ column: string; referencesTable: string; referencesColumn: string }>
  indexes: Array<{ name: string; columns: string[]; unique: boolean }>
}

/**
 * Response from the introspect operation
 */
export interface SupabaseIntrospectResponse extends ToolResponse {
  output: {
    message: string
    tables: SupabaseTableSchema[]
    schemas: string[]
  }
  error?: string
}
