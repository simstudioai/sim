/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Emitted from the Zod route contracts in
 * `apps/sim/lib/api/contracts/v2/**` by `scripts/generate-v2-cli-api.ts`.
 * Regenerate with `bun run generate:cli-api`; CI fails when this file is
 * stale, so edit the contract rather than this file.
 *
 * Contains only type declarations and one const table — no imports, so the
 * `packages/* must not import apps/*` boundary is preserved.
 */

/** `DELETE /api/v2/files/uploads/[uploadId]` */
export type AbortFileUploadParams = {
  uploadId: string
}

export type AbortFileUploadQuery = {
  workspaceId: string
}

export type AbortFileUploadHeaders = {
  'upload-token': string
}

type AbortFileUploadResponseRef0 = {
  id: string
  name: string
  size: number
  type: string
  key: string
  folderPath: string
  uploadedByEmail: string
  uploadedAt: string
  updatedAt: string
  deletedAt: string | null
}

type AbortFileUploadResponseRef1 = {
  id: string
  status:
    | 'uploading'
    | 'completing'
    | 'finalizing'
    | 'completed'
    | 'failed'
    | 'aborting'
    | 'aborted'
    | 'expired'
  name: string
  contentType: string
  size: number
  expiresAt: string
  error: string | null
  file: AbortFileUploadResponseRef0 | null
}

export type AbortFileUploadResponse = {
  data: AbortFileUploadResponseRef1
}

/** `DELETE /api/v2/knowledge/[id]/documents/uploads/[uploadId]` */
export type AbortKnowledgeDocumentUploadParams = {
  id: string
  uploadId: string
}

export type AbortKnowledgeDocumentUploadQuery = {
  workspaceId: string
}

export type AbortKnowledgeDocumentUploadHeaders = {
  'upload-token': string
}

type AbortKnowledgeDocumentUploadResponseRef0 = {
  id: string
  knowledgeBaseId: string
  filename: string
  fileSize: number
  mimeType: string
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  chunkCount: number
  tokenCount: number
  characterCount: number
  enabled: boolean
  createdAt: string | null
}

type AbortKnowledgeDocumentUploadResponseRef1 = {
  id: string
  knowledgeBaseId: string
  status:
    | 'uploading'
    | 'completing'
    | 'finalizing'
    | 'completed'
    | 'failed'
    | 'aborting'
    | 'aborted'
    | 'expired'
  name: string
  contentType: string
  size: number
  expiresAt: string
  error: string | null
  document: AbortKnowledgeDocumentUploadResponseRef0 | null
}

export type AbortKnowledgeDocumentUploadResponse = {
  data: AbortKnowledgeDocumentUploadResponseRef1
}

/** `POST /api/v2/tables/[tableId]/columns` */
export type AddTableColumnParams = {
  tableId: string
}

export type AddTableColumnQuery = Record<string, unknown>

export type AddTableColumnBody = {
  workspaceId: string
  column: {
    id?: string
    name: string
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
    required?: boolean
    unique?: boolean
    options?: Array<{
      id: string
      name: string
    }>
    multiple?: boolean
    currencyCode?: string
    position?: number
  }
}

type AddTableColumnResponseRef0 = {
  columns: Array<{
    id?: string
    name: string
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
    required: boolean
    unique: boolean
    workflowGroupId?: string
    options?: Array<{
      id: string
      name: string
    }>
    multiple?: boolean
    currencyCode?: string
  }>
}

export type AddTableColumnResponse = {
  data: AddTableColumnResponseRef0
}

/** `POST /api/v2/tables/[tableId]/groups` */
export type AddWorkflowGroupParams = {
  tableId: string
}

export type AddWorkflowGroupQuery = Record<string, unknown>

export type AddWorkflowGroupBody = {
  workspaceId: string
  group: {
    id?: string
    workflowId?: string
    enrichmentId?: string
    name?: string
    type?: 'manual' | 'enrichment'
    dependencies?: {
      columns?: Array<string>
    }
    outputs: Array<{
      blockId?: string
      path?: string
      outputId?: string
      columnName: string
    }>
    inputMappings?: Array<{
      inputName: string
      columnName: string
    }>
    deploymentMode?: 'live' | 'deployed'
    autoRun?: boolean
  }
  outputColumns: Array<{
    name: string
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
    required?: boolean
    unique?: boolean
  }>
  autoRun?: boolean
}

type AddWorkflowGroupResponseRef0 = {
  id: string
  workflowId: string
  enrichmentId?: string
  name?: string
  type?: 'manual' | 'enrichment'
  dependencies?: {
    columns?: Array<string>
  }
  outputs: Array<{
    blockId: string
    path: string
    outputId?: string
    columnName: string
  }>
  inputMappings?: Array<{
    inputName: string
    columnName: string
  }>
  deploymentMode?: 'live' | 'deployed'
  autoRun?: boolean
}

type AddWorkflowGroupResponseRef1 = {
  group: AddWorkflowGroupResponseRef0
  columns: Array<{
    id?: string
    name: string
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
    required: boolean
    unique: boolean
    workflowGroupId?: string
    options?: Array<{
      id: string
      name: string
    }>
    multiple?: boolean
    currencyCode?: string
  }>
}

export type AddWorkflowGroupResponse = {
  data: AddWorkflowGroupResponseRef1
}

/** `POST /api/v2/files/bulk-delete` */
export type BulkDeleteFilesQuery = Record<string, unknown>

export type BulkDeleteFilesBody = {
  workspaceId: string
  fileIds: Array<string>
}

type BulkDeleteFilesResponseRef0 = {
  deletedItems: {
    files: number
  }
}

export type BulkDeleteFilesResponse = {
  data: BulkDeleteFilesResponseRef0
}

/** `PATCH /api/v2/knowledge/[id]/documents` */
export type BulkUpdateKnowledgeDocumentsParams = {
  id: string
}

export type BulkUpdateKnowledgeDocumentsQuery = Record<string, unknown>

export type BulkUpdateKnowledgeDocumentsBody = {
  workspaceId: string
  operation: 'enable' | 'disable'
  documentIds?: Array<string>
  selectAll?: true
  enabledFilter?: 'all' | 'enabled' | 'disabled'
}

type BulkUpdateKnowledgeDocumentsResponseRef0 = {
  operation: 'enable' | 'disable'
  updatedCount: number
  documentIds?: Array<string>
}

export type BulkUpdateKnowledgeDocumentsResponse = {
  data: BulkUpdateKnowledgeDocumentsResponseRef0
}

/** `DELETE /api/v2/tables/exports/[exportId]` */
export type CancelTableExportParams = {
  exportId: string
}

export type CancelTableExportQuery = {
  workspaceId: string
}

type CancelTableExportResponseRef0 = {
  id: string
  tableId: string
  workspaceId: string
  format: 'csv' | 'json'
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled'
  rowsProcessed: number
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type CancelTableExportResponse = {
  data: CancelTableExportResponseRef0
}

/** `DELETE /api/v2/tables/imports/[importId]` */
export type CancelTableImportParams = {
  importId: string
}

export type CancelTableImportQuery = {
  workspaceId: string
}

export type CancelTableImportHeaders = {
  'upload-token'?: string
}

type CancelTableImportResponseRef0 = {
  type: 'upload'
  name: string
  contentType: string
  size: number
}

type CancelTableImportResponseRef1 = {
  type: 'workspace_file'
  fileId: string
}

type CancelTableImportResponseRef2 = string

type CancelTableImportResponseRef3 = {
  id: string
  workspaceId: string
  status: 'uploading' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired'
  source: CancelTableImportResponseRef0 | CancelTableImportResponseRef1
  target:
    | {
        type: 'new'
        name: string
        folderPath?: CancelTableImportResponseRef2
      }
    | {
        type: 'existing'
        tableId: string
        mode: 'append' | 'replace'
      }
  tableId: string | null
  rowsProcessed: number
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type CancelTableImportResponse = {
  data: CancelTableImportResponseRef3
}

/** `POST /api/v2/tables/[tableId]/cancel-runs` */
export type CancelTableRunsParams = {
  tableId: string
}

export type CancelTableRunsQuery = Record<string, unknown>

type CancelTableRunsBodyRef0 =
  | {
      all: Array<
        | CancelTableRunsBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }
  | {
      any: Array<
        | CancelTableRunsBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }

export type CancelTableRunsBody = {
  workspaceId: string
  scope: 'all' | 'row'
  rowId?: string
  filter?: CancelTableRunsBodyRef0
  excludeRowIds?: Array<string>
}

type CancelTableRunsResponseRef0 = {
  cancelled: number
}

export type CancelTableRunsResponse = {
  data: CancelTableRunsResponseRef0
}

/** `POST /api/v2/workflows/[id]/runs/[runId]/cancel` */
export type CancelWorkflowRunParams = {
  id: string
  runId: string
}

export type CancelWorkflowRunQuery = Record<string, unknown>

type CancelWorkflowRunResponseRef0 = {
  success: boolean
  runId: string
  redisAvailable: boolean
  durablyRecorded: boolean
  locallyAborted: boolean
  pausedCancelled: boolean
  reason?:
    | 'recorded'
    | 'redis_unavailable'
    | 'redis_write_failed'
    | 'paused_event_publish_failed'
    | 'paused_database_cancel_failed'
}

export type CancelWorkflowRunResponse = {
  data: CancelWorkflowRunResponseRef0
}

/** `POST /api/v2/files/uploads/[uploadId]/complete` */
export type CompleteFileUploadParams = {
  uploadId: string
}

export type CompleteFileUploadQuery = {
  workspaceId: string
}

export type CompleteFileUploadHeaders = {
  'upload-token': string
}

type CompleteFileUploadResponseRef0 = {
  id: string
  name: string
  size: number
  type: string
  key: string
  folderPath: string
  uploadedByEmail: string
  uploadedAt: string
  updatedAt: string
  deletedAt: string | null
}

type CompleteFileUploadResponseRef1 = {
  id: string
  status:
    | 'uploading'
    | 'completing'
    | 'finalizing'
    | 'completed'
    | 'failed'
    | 'aborting'
    | 'aborted'
    | 'expired'
  name: string
  contentType: string
  size: number
  expiresAt: string
  error: string | null
  file: CompleteFileUploadResponseRef0 | null
}

export type CompleteFileUploadResponse = {
  data: CompleteFileUploadResponseRef1
}

/** `POST /api/v2/knowledge/[id]/documents/uploads/[uploadId]/complete` */
export type CompleteKnowledgeDocumentUploadParams = {
  id: string
  uploadId: string
}

export type CompleteKnowledgeDocumentUploadQuery = {
  workspaceId: string
}

export type CompleteKnowledgeDocumentUploadHeaders = {
  'upload-token': string
}

type CompleteKnowledgeDocumentUploadResponseRef0 = {
  id: string
  knowledgeBaseId: string
  filename: string
  fileSize: number
  mimeType: string
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  chunkCount: number
  tokenCount: number
  characterCount: number
  enabled: boolean
  createdAt: string | null
}

type CompleteKnowledgeDocumentUploadResponseRef1 = {
  id: string
  knowledgeBaseId: string
  status:
    | 'uploading'
    | 'completing'
    | 'finalizing'
    | 'completed'
    | 'failed'
    | 'aborting'
    | 'aborted'
    | 'expired'
  name: string
  contentType: string
  size: number
  expiresAt: string
  error: string | null
  document: CompleteKnowledgeDocumentUploadResponseRef0 | null
}

export type CompleteKnowledgeDocumentUploadResponse = {
  data: CompleteKnowledgeDocumentUploadResponseRef1
}

/** `POST /api/v2/tables/imports/[importId]/complete` */
export type CompleteTableImportParams = {
  importId: string
}

export type CompleteTableImportQuery = {
  workspaceId: string
}

export type CompleteTableImportHeaders = {
  'upload-token': string
}

type CompleteTableImportResponseRef0 = {
  type: 'upload'
  name: string
  contentType: string
  size: number
}

type CompleteTableImportResponseRef1 = {
  type: 'workspace_file'
  fileId: string
}

type CompleteTableImportResponseRef2 = string

type CompleteTableImportResponseRef3 = {
  id: string
  workspaceId: string
  status: 'uploading' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired'
  source: CompleteTableImportResponseRef0 | CompleteTableImportResponseRef1
  target:
    | {
        type: 'new'
        name: string
        folderPath?: CompleteTableImportResponseRef2
      }
    | {
        type: 'existing'
        tableId: string
        mode: 'append' | 'replace'
      }
  tableId: string | null
  rowsProcessed: number
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type CompleteTableImportResponse = {
  data: CompleteTableImportResponseRef3
}

/** `POST /api/v2/custom-tools` */
export type CreateCustomToolQuery = Record<string, unknown>

export type CreateCustomToolBody = {
  workspaceId: string
  title: string
  schema: {
    type: 'function'
    function: {
      name: string
      description?: string
      parameters: {
        type: string
        properties: Record<string, unknown>
        required?: Array<string>
      }
    }
  }
  code: string
}

type CreateCustomToolResponseRef0 = {
  id: string
  title: string
  schema: {
    type: 'function'
    function: {
      name: string
      description?: string
      parameters: {
        type: string
        properties: Record<string, unknown>
        required?: Array<string>
      }
    }
  }
  code: string
  createdAt: string
  updatedAt: string
}

export type CreateCustomToolResponse = {
  data: CreateCustomToolResponseRef0
}

/** `POST /api/v2/files` */
export type CreateFileQuery = Record<string, unknown>

type CreateFileBodyRef0 = string

export type CreateFileBody = {
  workspaceId: string
  name: string
  contentType?: string
  folderPath?: CreateFileBodyRef0
  content?: string
  encoding?: 'utf-8' | 'base64'
}

type CreateFileResponseRef0 = {
  id: string
  name: string
  size: number
  type: string
  key: string
  folderPath: string
  uploadedByEmail: string
  uploadedAt: string
  updatedAt: string
  deletedAt: string | null
}

export type CreateFileResponse = {
  data: CreateFileResponseRef0
}

/** `POST /api/v2/files/folders` */
export type CreateFileFolderQuery = Record<string, unknown>

type CreateFileFolderBodyRef0 = string

export type CreateFileFolderBody = {
  workspaceId: string
  path: CreateFileFolderBodyRef0
}

type CreateFileFolderResponseRef0 = {
  name: string
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
}

export type CreateFileFolderResponse = {
  data: CreateFileFolderResponseRef0
}

/** `POST /api/v2/files/uploads` */
export type CreateFileUploadQuery = Record<string, unknown>

type CreateFileUploadBodyRef0 = string

export type CreateFileUploadBody = {
  workspaceId: string
  name: string
  contentType: string
  size: number
  folderPath?: CreateFileUploadBodyRef0
}

type CreateFileUploadResponseRef0 = {
  id: string
  name: string
  size: number
  type: string
  key: string
  folderPath: string
  uploadedByEmail: string
  uploadedAt: string
  updatedAt: string
  deletedAt: string | null
}

type CreateFileUploadResponseRef1 = {
  id: string
  status:
    | 'uploading'
    | 'completing'
    | 'finalizing'
    | 'completed'
    | 'failed'
    | 'aborting'
    | 'aborted'
    | 'expired'
  name: string
  contentType: string
  size: number
  expiresAt: string
  error: string | null
  file: CreateFileUploadResponseRef0 | null
}

type CreateFileUploadResponseRef2 = {
  method: 'put'
  url: string
  headers: Record<string, string>
  expiresAt: string
}

type CreateFileUploadResponseRef3 = {
  method: 'multipart'
  partSize: number
  partCount: number
}

type CreateFileUploadResponseRef4 = {
  session: CreateFileUploadResponseRef1
  uploadToken: string
  transfer: CreateFileUploadResponseRef2 | CreateFileUploadResponseRef3
}

export type CreateFileUploadResponse = {
  data: CreateFileUploadResponseRef4
}

/** `POST /api/v2/files/uploads/[uploadId]/parts` */
export type CreateFileUploadPartUrlsParams = {
  uploadId: string
}

export type CreateFileUploadPartUrlsQuery = {
  workspaceId: string
}

export type CreateFileUploadPartUrlsBody = {
  partNumbers: Array<number>
}

export type CreateFileUploadPartUrlsHeaders = {
  'upload-token': string
}

type CreateFileUploadPartUrlsResponseRef0 = {
  partNumber: number
  url: string
  headers: Record<string, string>
  expiresAt: string
}

type CreateFileUploadPartUrlsResponseRef1 = {
  parts: Array<CreateFileUploadPartUrlsResponseRef0>
}

export type CreateFileUploadPartUrlsResponse = {
  data: CreateFileUploadPartUrlsResponseRef1
}

/** `POST /api/v2/knowledge` */
export type CreateKnowledgeBaseQuery = Record<string, unknown>

type CreateKnowledgeBaseBodyRef0 = {
  maxSize?: number
  minSize?: number
  overlap?: number
}

type CreateKnowledgeBaseBodyRef1 = string

export type CreateKnowledgeBaseBody = {
  workspaceId: string
  name: string
  description?: string
  chunkingConfig?: CreateKnowledgeBaseBodyRef0
  folderPath?: CreateKnowledgeBaseBodyRef1
}

type CreateKnowledgeBaseResponseRef0 = {
  maxSize: number
  minSize: number
  overlap: number
  strategy?: 'auto' | 'text' | 'regex' | 'recursive' | 'sentence' | 'token'
  strategyOptions?: {
    pattern?: string
    separators?: Array<string>
    recipe?: 'plain' | 'markdown' | 'code'
    strictBoundaries?: boolean
  }
}

type CreateKnowledgeBaseResponseRef1 = {
  id: string
  name: string
  description: string | null
  tokenCount: number
  embeddingModel: string
  embeddingDimension: number
  chunkingConfig: CreateKnowledgeBaseResponseRef0
  docCount?: number
  connectorTypes?: Array<string>
  createdAt: string
  updatedAt: string
  ownerEmail: string
  folderPath: string
}

export type CreateKnowledgeBaseResponse = {
  data: CreateKnowledgeBaseResponseRef1
}

/** `POST /api/v2/knowledge/[id]/documents/uploads` */
export type CreateKnowledgeDocumentUploadParams = {
  id: string
}

export type CreateKnowledgeDocumentUploadQuery = Record<string, unknown>

export type CreateKnowledgeDocumentUploadBody = {
  workspaceId: string
  name: string
  contentType: string
  size: number
  tag1?: string
  tag2?: string
  tag3?: string
  tag4?: string
  tag5?: string
  tag6?: string
  tag7?: string
  processingOptions?: {
    recipe?: string
    lang?: string
  }
}

type CreateKnowledgeDocumentUploadResponseRef0 = {
  id: string
  knowledgeBaseId: string
  status:
    | 'uploading'
    | 'completing'
    | 'finalizing'
    | 'completed'
    | 'failed'
    | 'aborting'
    | 'aborted'
    | 'expired'
  name: string
  contentType: string
  size: number
  expiresAt: string
  error: string | null
  document: CreateKnowledgeDocumentUploadResponseRef1 | null
}

type CreateKnowledgeDocumentUploadResponseRef1 = {
  id: string
  knowledgeBaseId: string
  filename: string
  fileSize: number
  mimeType: string
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  chunkCount: number
  tokenCount: number
  characterCount: number
  enabled: boolean
  createdAt: string | null
}

type CreateKnowledgeDocumentUploadResponseRef2 =
  | CreateKnowledgeDocumentUploadResponseRef3
  | CreateKnowledgeDocumentUploadResponseRef4

type CreateKnowledgeDocumentUploadResponseRef3 = {
  method: 'put'
  url: string
  headers: Record<string, string>
  expiresAt: string
}

type CreateKnowledgeDocumentUploadResponseRef4 = {
  method: 'multipart'
  partSize: number
  partCount: number
}

type CreateKnowledgeDocumentUploadResponseRef5 = {
  session: CreateKnowledgeDocumentUploadResponseRef0
  uploadToken: string
  transfer: CreateKnowledgeDocumentUploadResponseRef2
}

export type CreateKnowledgeDocumentUploadResponse = {
  data: CreateKnowledgeDocumentUploadResponseRef5
}

/** `POST /api/v2/knowledge/[id]/documents/uploads/[uploadId]/parts` */
export type CreateKnowledgeDocumentUploadPartUrlsParams = {
  id: string
  uploadId: string
}

export type CreateKnowledgeDocumentUploadPartUrlsQuery = {
  workspaceId: string
}

export type CreateKnowledgeDocumentUploadPartUrlsBody = {
  partNumbers: Array<number>
}

export type CreateKnowledgeDocumentUploadPartUrlsHeaders = {
  'upload-token': string
}

type CreateKnowledgeDocumentUploadPartUrlsResponseRef0 = {
  partNumber: number
  url: string
  headers: Record<string, string>
  expiresAt: string
}

type CreateKnowledgeDocumentUploadPartUrlsResponseRef1 = {
  parts: Array<CreateKnowledgeDocumentUploadPartUrlsResponseRef0>
}

export type CreateKnowledgeDocumentUploadPartUrlsResponse = {
  data: CreateKnowledgeDocumentUploadPartUrlsResponseRef1
}

/** `POST /api/v2/knowledge/folders` */
export type CreateKnowledgeFolderQuery = Record<string, unknown>

type CreateKnowledgeFolderBodyRef0 = string

export type CreateKnowledgeFolderBody = {
  workspaceId: string
  path: CreateKnowledgeFolderBodyRef0
}

type CreateKnowledgeFolderResponseRef0 = {
  name: string
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
}

export type CreateKnowledgeFolderResponse = {
  data: CreateKnowledgeFolderResponseRef0
}

/** `POST /api/v2/mcp-servers` */
export type CreateMcpServerQuery = Record<string, unknown>

export type CreateMcpServerBody = {
  workspaceId: string
  name: string
  description?: string
  transport?: 'streamable-http'
  url: string
  authType?: 'none' | 'headers' | 'oauth'
  headers?: Record<string, string>
  timeout?: number
  retries?: number
  enabled?: boolean
  oauthClientId?: string | null
  oauthClientSecret?: string | null
}

type CreateMcpServerResponseRef0 = {
  id: string
  name: string
  description?: string
  transport: 'streamable-http'
  authType?: 'none' | 'headers' | 'oauth'
  url?: string
  timeout?: number
  retries?: number
  enabled: boolean
  connectionStatus?: 'connected' | 'disconnected' | 'error'
  lastError?: string | null
  toolCount?: number
  lastToolsRefresh?: string
  lastConnected?: string
  createdAt: string
  updatedAt: string
  oauthClientId?: string
  hasHeaders: boolean
  headerNames: Array<string>
  hasOauthClientSecret: boolean
}

export type CreateMcpServerResponse = {
  data: CreateMcpServerResponseRef0
}

/** `POST /api/v2/skills` */
export type CreateSkillQuery = Record<string, unknown>

export type CreateSkillBody = {
  workspaceId: string
  name: string
  description: string
  content: string
}

type CreateSkillResponseRef0 = {
  id: string
  name: string
  description: string
  readOnly: boolean
  createdAt: string
  updatedAt: string
  content: string
}

export type CreateSkillResponse = {
  data: CreateSkillResponseRef0
}

/** `POST /api/v2/tables` */
export type CreateTableQuery = Record<string, unknown>

type CreateTableBodyRef0 = string

export type CreateTableBody = {
  name: string
  description?: string
  workspaceId: string
  schema: {
    columns: Array<{
      id?: string
      name: string
      type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
      required?: boolean
      unique?: boolean
      options?: Array<{
        id: string
        name: string
      }>
      multiple?: boolean
      currencyCode?: string
    }>
  }
  folderPath?: CreateTableBodyRef0
}

type CreateTableResponseRef0 = {
  id: string | null
  type: 'import' | 'delete' | 'export' | 'backfill' | 'update' | null
  status: 'running' | 'ready' | 'failed' | 'canceled'
  rowsProcessed: number
  error: string | null
}

type CreateTableResponseRef1 = {
  id: string
  name: string
  description: string | null
  ownerEmail: string
  schema: {
    columns: Array<{
      id?: string
      name: string
      type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
      required: boolean
      unique: boolean
      workflowGroupId?: string
      options?: Array<{
        id: string
        name: string
      }>
      multiple?: boolean
      currencyCode?: string
    }>
  }
  rowCount: number
  maxRows: number
  folderPath: string
  locks: {
    schemaLocked: boolean
    insertLocked: boolean
    updateLocked: boolean
    deleteLocked: boolean
  }
  job: CreateTableResponseRef0 | null
  createdAt: string
  updatedAt: string
}

export type CreateTableResponse = {
  data: CreateTableResponseRef1
}

/** `POST /api/v2/tables/[tableId]/exports` */
export type CreateTableExportParams = {
  tableId: string
}

export type CreateTableExportQuery = Record<string, unknown>

export type CreateTableExportBody = {
  workspaceId: string
  format?: 'csv' | 'json'
}

type CreateTableExportResponseRef0 = {
  id: string
  tableId: string
  workspaceId: string
  format: 'csv' | 'json'
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled'
  rowsProcessed: number
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type CreateTableExportResponse = {
  data: CreateTableExportResponseRef0
}

/** `POST /api/v2/tables/folders` */
export type CreateTableFolderQuery = Record<string, unknown>

type CreateTableFolderBodyRef0 = string

export type CreateTableFolderBody = {
  workspaceId: string
  path: CreateTableFolderBodyRef0
}

type CreateTableFolderResponseRef0 = {
  name: string
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
}

export type CreateTableFolderResponse = {
  data: CreateTableFolderResponseRef0
}

/** `POST /api/v2/tables/imports` */
export type CreateTableImportQuery = Record<string, unknown>

type CreateTableImportBodyRef0 = {
  type: 'upload'
  name: string
  contentType: string
  size: number
}

type CreateTableImportBodyRef1 = {
  type: 'workspace_file'
  fileId: string
}

type CreateTableImportBodyRef2 = string

export type CreateTableImportBody = {
  workspaceId: string
  source: CreateTableImportBodyRef0 | CreateTableImportBodyRef1
  target:
    | {
        type: 'new'
        name: string
        folderPath?: CreateTableImportBodyRef2
      }
    | {
        type: 'existing'
        tableId: string
        mode: 'append' | 'replace'
      }
  mapping?: Record<string, string | null>
  createColumns?: Array<string>
  timezone?: string
}

type CreateTableImportResponseRef0 = {
  type: 'upload'
  name: string
  contentType: string
  size: number
}

type CreateTableImportResponseRef1 = string

type CreateTableImportResponseRef2 = {
  id: string
  workspaceId: string
  status: 'uploading' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired'
  source: CreateTableImportResponseRef0
  target:
    | {
        type: 'new'
        name: string
        folderPath?: CreateTableImportResponseRef1
      }
    | {
        type: 'existing'
        tableId: string
        mode: 'append' | 'replace'
      }
  tableId: string | null
  rowsProcessed: number
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

type CreateTableImportResponseRef3 = {
  method: 'put'
  url: string
  headers: Record<string, string>
  expiresAt: string
}

type CreateTableImportResponseRef4 = {
  method: 'multipart'
  partSize: number
  partCount: number
}

type CreateTableImportResponseRef5 = {
  type: 'workspace_file'
  fileId: string
}

type CreateTableImportResponseRef6 = {
  id: string
  workspaceId: string
  status: 'uploading' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired'
  source: CreateTableImportResponseRef5
  target:
    | {
        type: 'new'
        name: string
        folderPath?: CreateTableImportResponseRef1
      }
    | {
        type: 'existing'
        tableId: string
        mode: 'append' | 'replace'
      }
  tableId: string | null
  rowsProcessed: number
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

type CreateTableImportResponseRef7 =
  | {
      session: CreateTableImportResponseRef2
      uploadToken: string
      transfer: CreateTableImportResponseRef3 | CreateTableImportResponseRef4
    }
  | {
      session: CreateTableImportResponseRef6
      uploadToken: null
      transfer: null
    }

export type CreateTableImportResponse = {
  data: CreateTableImportResponseRef7
}

/** `POST /api/v2/tables/imports/[importId]/parts` */
export type CreateTableImportPartUrlsParams = {
  importId: string
}

export type CreateTableImportPartUrlsQuery = {
  workspaceId: string
}

export type CreateTableImportPartUrlsBody = {
  partNumbers: Array<number>
}

export type CreateTableImportPartUrlsHeaders = {
  'upload-token': string
}

type CreateTableImportPartUrlsResponseRef0 = {
  partNumber: number
  url: string
  headers: Record<string, string>
  expiresAt: string
}

type CreateTableImportPartUrlsResponseRef1 = {
  parts: Array<CreateTableImportPartUrlsResponseRef0>
}

export type CreateTableImportPartUrlsResponse = {
  data: CreateTableImportPartUrlsResponseRef1
}

/** `POST /api/v2/tables/[tableId]/rows` */
export type CreateTableRowsParams = {
  tableId: string
}

export type CreateTableRowsQuery = Record<string, unknown>

type CreateTableRowsBodyRef0 = Record<string, unknown>

export type CreateTableRowsBody =
  | {
      workspaceId: string
      rows: Array<CreateTableRowsBodyRef0>
    }
  | {
      workspaceId: string
      data: CreateTableRowsBodyRef0
      afterRowId?: string
      beforeRowId?: string
    }

type CreateTableRowsResponseRef0 = {
  data: CreateTableRowsResponseRef2
}

type CreateTableRowsResponseRef1 = Record<string, unknown>

type CreateTableRowsResponseRef2 = {
  id: string
  data: CreateTableRowsResponseRef1
  createdAt: string
  updatedAt: string
}

type CreateTableRowsResponseRef3 = {
  data: CreateTableRowsResponseRef4
}

type CreateTableRowsResponseRef4 = {
  rows: Array<CreateTableRowsResponseRef2>
  insertedCount: number
}

export type CreateTableRowsResponse = CreateTableRowsResponseRef0 | CreateTableRowsResponseRef3

/** `POST /api/v2/tables/[tableId]/views` */
export type CreateTableViewParams = {
  tableId: string
}

export type CreateTableViewQuery = Record<string, unknown>

type CreateTableViewBodyRef0 =
  | {
      all: Array<
        | CreateTableViewBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }
  | {
      any: Array<
        | CreateTableViewBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }
  | {
      field: string
      op:
        | 'eq'
        | 'ne'
        | 'gt'
        | 'gte'
        | 'lt'
        | 'lte'
        | 'in'
        | 'nin'
        | 'contains'
        | 'ncontains'
        | 'startsWith'
        | 'endsWith'
        | 'like'
        | 'ilike'
        | 'nlike'
        | 'nilike'
        | 'isEmpty'
        | 'isNotEmpty'
        | 'isNull'
        | 'isNotNull'
      value?: unknown
    }

export type CreateTableViewBody = {
  workspaceId: string
  name: string
  config: {
    columnWidths?: Record<string, number>
    columnOrder?: Array<string>
    pinnedColumns?: Array<string>
    hiddenColumns?: Array<string>
    filter?: CreateTableViewBodyRef0 | null
    sort?: Array<{
      field: string
      direction: 'asc' | 'desc'
    }> | null
  }
}

type CreateTableViewResponseRef0 = {
  columnWidths?: Record<string, number>
  columnOrder?: Array<string>
  pinnedColumns?: Array<string>
  hiddenColumns?: Array<string>
  filter?: unknown | null
  sort?: Array<{
    field: string
    direction: 'asc' | 'desc'
  }> | null
}

type CreateTableViewResponseRef1 = {
  id: string
  tableId: string
  name: string
  config: CreateTableViewResponseRef0
  isDefault: boolean
  createdByEmail: string | null
  createdAt: string
  updatedAt: string
}

export type CreateTableViewResponse = {
  data: CreateTableViewResponseRef1
}

/** `POST /api/v2/workflows` */
export type CreateWorkflowQuery = Record<string, unknown>

type CreateWorkflowBodyRef0 = string

export type CreateWorkflowBody = {
  workspaceId: string
  name: string
  description?: string | null
  folderPath?: CreateWorkflowBodyRef0
}

type CreateWorkflowResponseRef0 = {
  id: string
  name: string
  description: string | null
  folderPath: string
  workspaceId: string
  isDeployed: boolean
  deployedAt: string | null
  runCount: number
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
}

export type CreateWorkflowResponse = {
  data: CreateWorkflowResponseRef0
}

/** `POST /api/v2/workflows/folders` */
export type CreateWorkflowFolderQuery = Record<string, unknown>

type CreateWorkflowFolderBodyRef0 = string

export type CreateWorkflowFolderBody = {
  workspaceId: string
  path: CreateWorkflowFolderBodyRef0
}

type CreateWorkflowFolderResponseRef0 = {
  name: string
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
  locked: boolean
}

export type CreateWorkflowFolderResponse = {
  data: CreateWorkflowFolderResponseRef0
}

/** `DELETE /api/v2/custom-tools/[id]` */
export type DeleteCustomToolParams = {
  id: string
}

export type DeleteCustomToolQuery = {
  workspaceId: string
}

type DeleteCustomToolResponseRef0 = {
  id: string
  deleted: true
}

export type DeleteCustomToolResponse = {
  data: DeleteCustomToolResponseRef0
}

/** `DELETE /api/v2/files/[fileId]` */
export type DeleteFileParams = {
  fileId: string
}

export type DeleteFileQuery = {
  workspaceId: string
}

type DeleteFileResponseRef0 = {
  id: string
  deleted: true
}

export type DeleteFileResponse = {
  data: DeleteFileResponseRef0
}

/** `DELETE /api/v2/files/folders` */
type DeleteFileFolderQueryRef0 = string

export type DeleteFileFolderQuery = {
  workspaceId: string
  path: DeleteFileFolderQueryRef0
  recursive?:
    | 'true'
    | '1'
    | 'yes'
    | 'on'
    | 'y'
    | 'enabled'
    | 'false'
    | '0'
    | 'no'
    | 'off'
    | 'n'
    | 'disabled'
}

type DeleteFileFolderResponseRef0 = {
  path: string
  deleted: true
  deletedItems: {
    folders: number
    files: number
  }
}

export type DeleteFileFolderResponse = {
  data: DeleteFileFolderResponseRef0
}

/** `DELETE /api/v2/knowledge/[id]` */
export type DeleteKnowledgeBaseParams = {
  id: string
}

export type DeleteKnowledgeBaseQuery = {
  workspaceId: string
}

type DeleteKnowledgeBaseResponseRef0 = {
  id: string
  deleted: true
}

export type DeleteKnowledgeBaseResponse = {
  data: DeleteKnowledgeBaseResponseRef0
}

/** `DELETE /api/v2/knowledge/[id]/documents/[documentId]` */
export type DeleteKnowledgeDocumentParams = {
  id: string
  documentId: string
}

export type DeleteKnowledgeDocumentQuery = {
  workspaceId: string
}

type DeleteKnowledgeDocumentResponseRef0 = {
  id: string
  deleted: true
}

export type DeleteKnowledgeDocumentResponse = {
  data: DeleteKnowledgeDocumentResponseRef0
}

/** `DELETE /api/v2/knowledge/folders` */
type DeleteKnowledgeFolderQueryRef0 = string

export type DeleteKnowledgeFolderQuery = {
  workspaceId: string
  path: DeleteKnowledgeFolderQueryRef0
  recursive?:
    | 'true'
    | '1'
    | 'yes'
    | 'on'
    | 'y'
    | 'enabled'
    | 'false'
    | '0'
    | 'no'
    | 'off'
    | 'n'
    | 'disabled'
}

type DeleteKnowledgeFolderResponseRef0 = {
  path: string
  deleted: true
  deletedItems: {
    folders: number
    knowledgeBases: number
  }
}

export type DeleteKnowledgeFolderResponse = {
  data: DeleteKnowledgeFolderResponseRef0
}

/** `DELETE /api/v2/mcp-servers/[id]` */
export type DeleteMcpServerParams = {
  id: string
}

export type DeleteMcpServerQuery = {
  workspaceId: string
}

type DeleteMcpServerResponseRef0 = {
  id: string
  deleted: true
}

export type DeleteMcpServerResponse = {
  data: DeleteMcpServerResponseRef0
}

/** `DELETE /api/v2/secrets/[name]` */
export type DeleteSecretParams = {
  name: string
}

export type DeleteSecretQuery = {
  workspaceId: string
  scope: 'workspace' | 'personal'
}

type DeleteSecretResponseRef0 = {
  name: string
  scope: 'workspace' | 'personal'
  deleted: true
}

export type DeleteSecretResponse = {
  data: DeleteSecretResponseRef0
}

/** `DELETE /api/v2/skills/[id]` */
export type DeleteSkillParams = {
  id: string
}

export type DeleteSkillQuery = {
  workspaceId: string
}

type DeleteSkillResponseRef0 = {
  id: string
  deleted: true
}

export type DeleteSkillResponse = {
  data: DeleteSkillResponseRef0
}

/** `DELETE /api/v2/tables/[tableId]` */
export type DeleteTableParams = {
  tableId: string
}

export type DeleteTableQuery = {
  workspaceId: string
}

type DeleteTableResponseRef0 = {
  id: string
  deleted: true
}

export type DeleteTableResponse = {
  data: DeleteTableResponseRef0
}

/** `DELETE /api/v2/tables/[tableId]/columns` */
export type DeleteTableColumnParams = {
  tableId: string
}

export type DeleteTableColumnQuery = Record<string, unknown>

export type DeleteTableColumnBody = {
  workspaceId: string
  columnName: string
}

type DeleteTableColumnResponseRef0 = {
  columns: Array<{
    id?: string
    name: string
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
    required: boolean
    unique: boolean
    workflowGroupId?: string
    options?: Array<{
      id: string
      name: string
    }>
    multiple?: boolean
    currencyCode?: string
  }>
}

export type DeleteTableColumnResponse = {
  data: DeleteTableColumnResponseRef0
}

/** `DELETE /api/v2/tables/folders` */
type DeleteTableFolderQueryRef0 = string

export type DeleteTableFolderQuery = {
  workspaceId: string
  path: DeleteTableFolderQueryRef0
  recursive?:
    | 'true'
    | '1'
    | 'yes'
    | 'on'
    | 'y'
    | 'enabled'
    | 'false'
    | '0'
    | 'no'
    | 'off'
    | 'n'
    | 'disabled'
}

type DeleteTableFolderResponseRef0 = {
  path: string
  deleted: true
  deletedItems: {
    folders: number
    tables: number
  }
}

export type DeleteTableFolderResponse = {
  data: DeleteTableFolderResponseRef0
}

/** `DELETE /api/v2/tables/[tableId]/rows/[rowId]` */
export type DeleteTableRowParams = {
  tableId: string
  rowId: string
}

export type DeleteTableRowQuery = {
  workspaceId: string
}

type DeleteTableRowResponseRef0 = {
  id: string
  deleted: true
}

export type DeleteTableRowResponse = {
  data: DeleteTableRowResponseRef0
}

/** `DELETE /api/v2/tables/[tableId]/rows` */
export type DeleteTableRowsParams = {
  tableId: string
}

export type DeleteTableRowsQuery = Record<string, unknown>

type DeleteTableRowsBodyRef0 =
  | {
      all: Array<
        | DeleteTableRowsBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }
  | {
      any: Array<
        | DeleteTableRowsBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }

export type DeleteTableRowsBody = {
  workspaceId: string
  filter?: DeleteTableRowsBodyRef0
  limit?: number
  rowIds?: Array<string>
}

type DeleteTableRowsResponseRef0 = {
  deletedCount: number
  deletedRowIds: Array<string>
  requestedCount?: number
  missingRowIds?: Array<string>
}

export type DeleteTableRowsResponse = {
  data: DeleteTableRowsResponseRef0
}

/** `DELETE /api/v2/tables/[tableId]/views/[viewId]` */
export type DeleteTableViewParams = {
  tableId: string
  viewId: string
}

export type DeleteTableViewQuery = {
  workspaceId: string
}

type DeleteTableViewResponseRef0 = {
  id: string
  deleted: true
}

export type DeleteTableViewResponse = {
  data: DeleteTableViewResponseRef0
}

/** `DELETE /api/v2/workflows/[id]` */
export type DeleteWorkflowParams = {
  id: string
}

export type DeleteWorkflowQuery = Record<string, unknown>

type DeleteWorkflowResponseRef0 = {
  id: string
  deleted: true
}

export type DeleteWorkflowResponse = {
  data: DeleteWorkflowResponseRef0
}

/** `DELETE /api/v2/workflows/folders` */
type DeleteWorkflowFolderQueryRef0 = string

export type DeleteWorkflowFolderQuery = {
  workspaceId: string
  path: DeleteWorkflowFolderQueryRef0
  recursive?:
    | 'true'
    | '1'
    | 'yes'
    | 'on'
    | 'y'
    | 'enabled'
    | 'false'
    | '0'
    | 'no'
    | 'off'
    | 'n'
    | 'disabled'
}

type DeleteWorkflowFolderResponseRef0 = {
  path: string
  deleted: true
  deletedItems: {
    folders: number
    workflows: number
  }
}

export type DeleteWorkflowFolderResponse = {
  data: DeleteWorkflowFolderResponseRef0
}

/** `DELETE /api/v2/tables/[tableId]/groups` */
export type DeleteWorkflowGroupParams = {
  tableId: string
}

export type DeleteWorkflowGroupQuery = Record<string, unknown>

export type DeleteWorkflowGroupBody = {
  workspaceId: string
  groupId: string
}

type DeleteWorkflowGroupResponseRef0 = {
  id: string
  deleted: true
  columns: Array<{
    id?: string
    name: string
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
    required: boolean
    unique: boolean
    workflowGroupId?: string
    options?: Array<{
      id: string
      name: string
    }>
    multiple?: boolean
    currencyCode?: string
  }>
}

export type DeleteWorkflowGroupResponse = {
  data: DeleteWorkflowGroupResponseRef0
}

/** `POST /api/v2/workflows/[id]/deploy` */
export type DeployWorkflowParams = {
  id: string
}

export type DeployWorkflowQuery = Record<string, unknown>

export type DeployWorkflowBody = {
  name?: string
  description?: string | null
}

type DeployWorkflowResponseRef0 = {
  deploymentVersionId: string
  version: number
  deployedAt: string
}

type DeployWorkflowResponseRef1 = {
  id: string
  deploymentVersionId: string
  version: number
  action: 'deploy' | 'activate'
  status: 'preparing' | 'activating' | 'active' | 'failed' | 'superseded'
  isCurrent: boolean
  readiness: DeployWorkflowResponseRef2
  requestedAt: string
  activatedAt?: string | null
  error?: DeployWorkflowResponseRef3 | null
}

type DeployWorkflowResponseRef2 = {
  webhooks: 'pending' | 'ready' | 'not_applicable'
  schedules: 'pending' | 'ready' | 'not_applicable'
  mcp: 'pending' | 'ready' | 'not_applicable'
}

type DeployWorkflowResponseRef3 = {
  code: string
  message: string
  retryable: boolean
}

type DeployWorkflowResponseRef4 = {
  id: string
  isDeployed: boolean
  deployedAt: string | null
  warnings: Array<string>
  activeDeployment: DeployWorkflowResponseRef0 | null
  latestDeploymentAttempt: DeployWorkflowResponseRef1 | null
  version?: number
}

export type DeployWorkflowResponse = {
  data: DeployWorkflowResponseRef4
}

/** `GET /api/v2/files/[fileId]` */
export type DownloadFileParams = {
  fileId: string
}

export type DownloadFileQuery = {
  workspaceId: string
}

/** Non-JSON response (`binary`). */
export type DownloadFileResponse = never

/** `POST /api/v2/workflows/[id]/execute` */
export type ExecuteWorkflowParams = {
  id: string
}

export type ExecuteWorkflowQuery = Record<string, unknown>

export type ExecuteWorkflowBody = {
  input?: Record<string, unknown>
  async?: boolean
  executionTimeoutSeconds?: number
  stream?: boolean
  selectedOutputs?: Array<string>
  includeThinking?: boolean
  includeToolCalls?: boolean
  includeFileBase64?: boolean
  base64MaxBytes?: number
}

export type ExecuteWorkflowHeaders = {
  'x-run-id'?: string
  'x-sim-via'?: string
}

type ExecuteWorkflowResponseRef0 = {
  message: string
  code:
    | 'TIMEOUT'
    | 'CANCELLED'
    | 'USAGE_LIMIT_EXCEEDED'
    | 'INVALID_INPUT'
    | 'BLOCK_EXECUTION_FAILED'
    | 'CHILD_WORKFLOW_FAILED'
    | 'EXECUTION_FAILED'
  blockId?: string
  blockName?: string
  blockType?: string
}

type ExecuteWorkflowResponseRef1 = {
  runId: string
  workflowId: string
  status: 'completed' | 'failed' | 'paused' | 'cancelled'
  output: unknown
  error: ExecuteWorkflowResponseRef0 | null
  startedAt?: string
  endedAt?: string
  durationMs?: number
}

type ExecuteWorkflowResponseRef2 = {
  runId: string
  statusUrl: string
}

export type ExecuteWorkflowResponse =
  | {
      data: ExecuteWorkflowResponseRef1
    }
  | {
      data: ExecuteWorkflowResponseRef2
    }

/** `GET /api/v2/workflows/[id]/export` */
export type ExportWorkflowParams = {
  id: string
}

export type ExportWorkflowQuery = Record<string, unknown>

type ExportWorkflowResponseRef0 = {
  version: '1.0'
  exportedAt: string
  workflow: {
    id: string
    name: string
    description: string | null
    workspaceId: string | null
    folderPath: string
  }
  state: Record<string, unknown>
}

export type ExportWorkflowResponse = {
  data: ExportWorkflowResponseRef0
}

/** `POST /api/v2/tables/[tableId]/rows/find` */
export type FindTableRowsParams = {
  tableId: string
}

export type FindTableRowsQuery = Record<string, unknown>

type FindTableRowsBodyRef0 =
  | {
      all: Array<
        | FindTableRowsBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }
  | {
      any: Array<
        | FindTableRowsBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }

export type FindTableRowsBody = {
  workspaceId: string
  q: string
  predicate?: FindTableRowsBodyRef0
  sort?: Array<{
    field: string
    direction: 'asc' | 'desc'
  }>
}

type FindTableRowsResponseRef0 = {
  ordinal: number
  rowId: string
  column: string
}

type FindTableRowsResponseRef1 = {
  matches: Array<FindTableRowsResponseRef0>
  truncated: boolean
}

export type FindTableRowsResponse = {
  data: FindTableRowsResponseRef1
}

/** `GET /api/v2/audit-logs/[id]` */
export type GetAuditLogParams = {
  id: string
}

export type GetAuditLogQuery = {
  organizationId: string
}

type GetAuditLogResponseRef0 = {
  id: string
  workspaceId: string | null
  actorName: string | null
  actorEmail: string | null
  action: string
  resourceType: string
  resourceId: string | null
  resourceName: string | null
  description: string | null
  metadata: unknown
  createdAt: string
}

export type GetAuditLogResponse = {
  data: GetAuditLogResponseRef0
}

/** `GET /api/v2/billing/status` */
export type GetBillingStatusQuery = {
  workspaceId?: string
}

type GetBillingStatusResponseRef0 = {
  workspaceId: string | null
  period: {
    start: string
    end: string
  }
  plan: string
  status: 'active' | 'limit_exceeded' | 'billing_blocked'
  credits: {
    used: number
    limit: number
    remaining: number
  } | null
  storage: {
    usedBytes: number
    limitBytes: number
    percentUsed: number
  } | null
}

export type GetBillingStatusResponse = {
  data: GetBillingStatusResponseRef0
}

/** `GET /api/v2/custom-tools/[id]` */
export type GetCustomToolParams = {
  id: string
}

export type GetCustomToolQuery = {
  workspaceId: string
}

type GetCustomToolResponseRef0 = {
  id: string
  title: string
  schema: {
    type: 'function'
    function: {
      name: string
      description?: string
      parameters: {
        type: string
        properties: Record<string, unknown>
        required?: Array<string>
      }
    }
  }
  code: string
  createdAt: string
  updatedAt: string
}

export type GetCustomToolResponse = {
  data: GetCustomToolResponseRef0
}

/** `GET /api/v2/files/[fileId]/metadata` */
export type GetFileParams = {
  fileId: string
}

export type GetFileQuery = {
  workspaceId: string
}

type GetFileResponseRef0 = {
  id: string
  token: string
  url: string
  isActive: boolean
  resourceType: 'file' | 'folder'
  resourceId: string
  authType: 'public' | 'password' | 'email' | 'sso'
  hasPassword: boolean
  allowedEmails: Array<string>
}

type GetFileResponseRef1 = {
  id: string
  name: string
  size: number
  type: string
  key: string
  folderPath: string
  uploadedByEmail: string
  uploadedAt: string
  updatedAt: string
  deletedAt: string | null
  share: GetFileResponseRef0 | null
}

export type GetFileResponse = {
  data: GetFileResponseRef1
}

/** `GET /api/v2/files/[fileId]/share` */
export type GetFileShareParams = {
  fileId: string
}

export type GetFileShareQuery = {
  workspaceId: string
}

type GetFileShareResponseRef0 = {
  id: string
  token: string
  url: string
  isActive: boolean
  resourceType: 'file' | 'folder'
  resourceId: string
  authType: 'public' | 'password' | 'email' | 'sso'
  hasPassword: boolean
  allowedEmails: Array<string>
}

export type GetFileShareResponse = {
  data: GetFileShareResponseRef0 | null
}

/** `GET /api/v2/knowledge/[id]` */
export type GetKnowledgeBaseParams = {
  id: string
}

export type GetKnowledgeBaseQuery = {
  workspaceId: string
}

type GetKnowledgeBaseResponseRef0 = {
  maxSize: number
  minSize: number
  overlap: number
  strategy?: 'auto' | 'text' | 'regex' | 'recursive' | 'sentence' | 'token'
  strategyOptions?: {
    pattern?: string
    separators?: Array<string>
    recipe?: 'plain' | 'markdown' | 'code'
    strictBoundaries?: boolean
  }
}

type GetKnowledgeBaseResponseRef1 = {
  id: string
  name: string
  description: string | null
  tokenCount: number
  embeddingModel: string
  embeddingDimension: number
  chunkingConfig: GetKnowledgeBaseResponseRef0
  docCount?: number
  connectorTypes?: Array<string>
  createdAt: string
  updatedAt: string
  ownerEmail: string
  folderPath: string
}

export type GetKnowledgeBaseResponse = {
  data: GetKnowledgeBaseResponseRef1
}

/** `GET /api/v2/knowledge/[id]/documents/[documentId]` */
export type GetKnowledgeDocumentParams = {
  id: string
  documentId: string
}

export type GetKnowledgeDocumentQuery = {
  workspaceId: string
}

type GetKnowledgeDocumentResponseRef0 = {
  id: string
  knowledgeBaseId: string
  filename: string
  fileSize: number
  mimeType: string
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  chunkCount: number
  tokenCount: number
  characterCount: number
  enabled: boolean
  createdAt: string | null
  tags: Record<string, string | number | boolean | null>
  processingError: string | null
  processingStartedAt: string | null
  processingCompletedAt: string | null
  connectorId: string | null
  connectorType: string | null
  sourceUrl: string | null
}

export type GetKnowledgeDocumentResponse = {
  data: GetKnowledgeDocumentResponseRef0
}

/** `GET /api/v2/logs/[runId]` */
export type GetLogParams = {
  runId: string
}

export type GetLogQuery = Record<string, unknown>

type GetLogResponseRef0 = {
  id: string
  name: string
  type: string
  duration?: number
  durationMs?: number
  startTime?: string
  endTime?: string
  status?: string
  errorHandled?: boolean
  errorType?: string
  errorMessage?: string
  blockId?: string
  input?: unknown
  output?: unknown
  tokens?:
    | number
    | {
        total?: number
        input?: number
        output?: number
      }
  cost?: {
    total?: number
    input?: number
    output?: number
    toolCost?: number
  }
  relativeStartMs?: number
  toolCalls?: Array<{
    id?: string
    name?: string
    arguments?: unknown
    result?: unknown
    error?: string
    startTime?: string
    endTime?: string
    duration?: number
  }>
  children?: Array<GetLogResponseRef0>
}

type GetLogResponseRef1 = {
  runId: string
  workflowId: string | null
  deploymentVersionId: string | null
  status: 'pending' | 'running' | 'paused' | 'redacting' | 'completed' | 'failed' | 'cancelled'
  level: string
  trigger: string
  startedAt: string
  endedAt: string | null
  totalDurationMs: number | null
  files: Array<unknown> | null
  workflow: {
    id: string | null
    name: string
    description: string | null
    folderPath: string | null
    ownerEmail: string | null
    workspaceId: string | null
    createdAt: string | null
    updatedAt: string | null
    deleted: boolean
  }
  workflowState: Record<string, unknown> | null
  traceSpans: Array<GetLogResponseRef0>
  finalOutput: unknown | null
  cost: {
    total: number
  } | null
  createdAt: string
}

export type GetLogResponse = {
  data: GetLogResponseRef1
}

/** `GET /api/v2/mcp-servers/[id]` */
export type GetMcpServerParams = {
  id: string
}

export type GetMcpServerQuery = {
  workspaceId: string
}

type GetMcpServerResponseRef0 = {
  id: string
  name: string
  description?: string
  transport: 'streamable-http'
  authType?: 'none' | 'headers' | 'oauth'
  url?: string
  timeout?: number
  retries?: number
  enabled: boolean
  connectionStatus?: 'connected' | 'disconnected' | 'error'
  lastError?: string | null
  toolCount?: number
  lastToolsRefresh?: string
  lastConnected?: string
  createdAt: string
  updatedAt: string
  oauthClientId?: string
  hasHeaders: boolean
  headerNames: Array<string>
  hasOauthClientSecret: boolean
}

export type GetMcpServerResponse = {
  data: GetMcpServerResponseRef0
}

/** `GET /api/v2/skills/[id]` */
export type GetSkillParams = {
  id: string
}

export type GetSkillQuery = {
  workspaceId: string
}

type GetSkillResponseRef0 = {
  id: string
  name: string
  description: string
  readOnly: boolean
  createdAt: string
  updatedAt: string
  content: string
}

export type GetSkillResponse = {
  data: GetSkillResponseRef0
}

/** `GET /api/v2/tables/[tableId]` */
export type GetTableParams = {
  tableId: string
}

export type GetTableQuery = {
  workspaceId: string
}

type GetTableResponseRef0 = {
  id: string | null
  type: 'import' | 'delete' | 'export' | 'backfill' | 'update' | null
  status: 'running' | 'ready' | 'failed' | 'canceled'
  rowsProcessed: number
  error: string | null
}

type GetTableResponseRef1 = {
  id: string
  name: string
  description: string | null
  ownerEmail: string
  schema: {
    columns: Array<{
      id?: string
      name: string
      type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
      required: boolean
      unique: boolean
      workflowGroupId?: string
      options?: Array<{
        id: string
        name: string
      }>
      multiple?: boolean
      currencyCode?: string
    }>
  }
  rowCount: number
  maxRows: number
  folderPath: string
  locks: {
    schemaLocked: boolean
    insertLocked: boolean
    updateLocked: boolean
    deleteLocked: boolean
  }
  job: GetTableResponseRef0 | null
  createdAt: string
  updatedAt: string
}

export type GetTableResponse = {
  data: GetTableResponseRef1
}

/** `GET /api/v2/tables/exports/[exportId]` */
export type GetTableExportParams = {
  exportId: string
}

export type GetTableExportQuery = {
  workspaceId: string
}

type GetTableExportResponseRef0 = {
  id: string
  tableId: string
  workspaceId: string
  format: 'csv' | 'json'
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled'
  rowsProcessed: number
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type GetTableExportResponse = {
  data: GetTableExportResponseRef0
}

/** `GET /api/v2/tables/imports/[importId]` */
export type GetTableImportParams = {
  importId: string
}

export type GetTableImportQuery = {
  workspaceId: string
}

export type GetTableImportHeaders = {
  'upload-token'?: string
}

type GetTableImportResponseRef0 = {
  type: 'upload'
  name: string
  contentType: string
  size: number
}

type GetTableImportResponseRef1 = {
  type: 'workspace_file'
  fileId: string
}

type GetTableImportResponseRef2 = string

type GetTableImportResponseRef3 = {
  id: string
  workspaceId: string
  status: 'uploading' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired'
  source: GetTableImportResponseRef0 | GetTableImportResponseRef1
  target:
    | {
        type: 'new'
        name: string
        folderPath?: GetTableImportResponseRef2
      }
    | {
        type: 'existing'
        tableId: string
        mode: 'append' | 'replace'
      }
  tableId: string | null
  rowsProcessed: number
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type GetTableImportResponse = {
  data: GetTableImportResponseRef3
}

/** `GET /api/v2/tables/[tableId]/rows/[rowId]` */
export type GetTableRowParams = {
  tableId: string
  rowId: string
}

export type GetTableRowQuery = {
  workspaceId: string
}

type GetTableRowResponseRef0 = Record<string, unknown>

type GetTableRowResponseRef1 = {
  id: string
  data: GetTableRowResponseRef0
  createdAt: string
  updatedAt: string
}

export type GetTableRowResponse = {
  data: GetTableRowResponseRef1
}

/** `GET /api/v2/tables/[tableId]/views/[viewId]` */
export type GetTableViewParams = {
  tableId: string
  viewId: string
}

export type GetTableViewQuery = {
  workspaceId: string
}

type GetTableViewResponseRef0 = {
  columnWidths?: Record<string, number>
  columnOrder?: Array<string>
  pinnedColumns?: Array<string>
  hiddenColumns?: Array<string>
  filter?: unknown | null
  sort?: Array<{
    field: string
    direction: 'asc' | 'desc'
  }> | null
}

type GetTableViewResponseRef1 = {
  id: string
  tableId: string
  name: string
  config: GetTableViewResponseRef0
  isDefault: boolean
  createdByEmail: string | null
  createdAt: string
  updatedAt: string
}

export type GetTableViewResponse = {
  data: GetTableViewResponseRef1
}

/** `GET /api/v2/workflows/[id]` */
export type GetWorkflowParams = {
  id: string
}

export type GetWorkflowQuery = Record<string, unknown>

type GetWorkflowResponseRef0 = {
  name: string
  type: string
  description?: string
}

type GetWorkflowResponseRef1 = {
  id: string
  name: string
  description: string | null
  folderPath: string
  workspaceId: string
  isDeployed: boolean
  deployedAt: string | null
  runCount: number
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
  variables: Record<string, unknown>
  inputs: Array<GetWorkflowResponseRef0>
}

export type GetWorkflowResponse = {
  data: GetWorkflowResponseRef1
}

/** `GET /api/v2/workflows/[id]/deployment` */
export type GetWorkflowDeploymentParams = {
  id: string
}

export type GetWorkflowDeploymentQuery = Record<string, unknown>

type GetWorkflowDeploymentResponseRef0 = {
  deploymentVersionId: string
  version: number
  deployedAt: string
}

type GetWorkflowDeploymentResponseRef1 = {
  id: string
  deploymentVersionId: string
  version: number
  action: 'deploy' | 'activate'
  status: 'preparing' | 'activating' | 'active' | 'failed' | 'superseded'
  isCurrent: boolean
  readiness: GetWorkflowDeploymentResponseRef2
  requestedAt: string
  activatedAt?: string | null
  error?: GetWorkflowDeploymentResponseRef3 | null
}

type GetWorkflowDeploymentResponseRef2 = {
  webhooks: 'pending' | 'ready' | 'not_applicable'
  schedules: 'pending' | 'ready' | 'not_applicable'
  mcp: 'pending' | 'ready' | 'not_applicable'
}

type GetWorkflowDeploymentResponseRef3 = {
  code: string
  message: string
  retryable: boolean
}

type GetWorkflowDeploymentResponseRef4 = {
  id: string
  isDeployed: boolean
  deployedAt: string | null
  warnings: Array<string>
  activeDeployment: GetWorkflowDeploymentResponseRef0 | null
  latestDeploymentAttempt: GetWorkflowDeploymentResponseRef1 | null
  needsRedeployment: boolean
}

export type GetWorkflowDeploymentResponse = {
  data: GetWorkflowDeploymentResponseRef4
}

/** `GET /api/v2/workflows/[id]/runs/[runId]` */
export type GetWorkflowRunParams = {
  id: string
  runId: string
}

export type GetWorkflowRunQuery = {
  includeOutput?: boolean
  selectedOutputs?: string
}

type GetWorkflowRunResponseRef0 = {
  message: string
  code:
    | 'TIMEOUT'
    | 'CANCELLED'
    | 'USAGE_LIMIT_EXCEEDED'
    | 'INVALID_INPUT'
    | 'BLOCK_EXECUTION_FAILED'
    | 'CHILD_WORKFLOW_FAILED'
    | 'EXECUTION_FAILED'
  blockId?: string
  blockName?: string
  blockType?: string
}

type GetWorkflowRunResponseRef1 = {
  runId: string
  workflowId: string
  status:
    | 'pending'
    | 'running'
    | 'paused'
    | 'redacting'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'queued'
  trigger: string | null
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  paused: {
    contextId: string | null
    pausedAt: string
    resumeAt: string | null
    pauseKind: 'time' | 'human' | null
    blockedOnBlockId: string | null
    automaticResumeWaitingReason: string | null
    pausePointCount: number
    resumedCount: number
  } | null
  cost: {
    total: number
  } | null
  error: GetWorkflowRunResponseRef0 | null
  output: unknown | null
  blockOutputs: Record<string, unknown> | null
}

export type GetWorkflowRunResponse = {
  data: GetWorkflowRunResponseRef1
}

/** `GET /api/v2/workflows/[id]/versions/[version]` */
export type GetWorkflowVersionParams = {
  id: string
  version: number
}

export type GetWorkflowVersionQuery = Record<string, unknown>

type GetWorkflowVersionResponseRef0 = Record<string, unknown>

type GetWorkflowVersionResponseRef1 = {
  id: string
  version: number
  name: string | null
  description: string | null
  isActive: boolean
  createdAt: string
  state: GetWorkflowVersionResponseRef0
}

export type GetWorkflowVersionResponse = {
  data: GetWorkflowVersionResponseRef1
}

/** `GET /api/v2/workspaces/[workspaceId]` */
export type GetWorkspaceParams = {
  workspaceId: string
}

export type GetWorkspaceQuery = Record<string, unknown>

type GetWorkspaceResponseRef0 = {
  id: string
  name: string
  color: string
  logoUrl: string | null
  memberCount: number
  createdAt: string
  updatedAt: string
}

export type GetWorkspaceResponse = {
  data: GetWorkspaceResponseRef0
}

/** `POST /api/v2/workflows/import` */
export type ImportWorkflowQuery = Record<string, unknown>

type ImportWorkflowBodyRef0 = string

export type ImportWorkflowBody = {
  workspaceId: string
  workflow: string | Record<string, unknown>
  folderPath?: ImportWorkflowBodyRef0
  name?: string
  description?: string
}

type ImportWorkflowResponseRef0 = {
  id: string
  name: string
  description: string | null
  workspaceId: string
  folderPath: string
  createdAt: string
  updatedAt: string
}

export type ImportWorkflowResponse = {
  data: ImportWorkflowResponseRef0
}

/** `GET /api/v2/audit-logs` */
export type ListAuditLogsQuery = {
  action?: string
  resourceType?: string
  resourceId?: string
  workspaceId?: string
  startDate?: string
  endDate?: string
  includeDeparted?: boolean
  limit?: number
  cursor?: string
  organizationId: string
  actorEmail?: string
}

type ListAuditLogsResponseRef0 = {
  id: string
  workspaceId: string | null
  actorName: string | null
  actorEmail: string | null
  action: string
  resourceType: string
  resourceId: string | null
  resourceName: string | null
  description: string | null
  metadata: unknown
  createdAt: string
}

export type ListAuditLogsResponse = {
  data: Array<ListAuditLogsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/billing/logs` */
export type ListBillingLogsQuery = {
  source?:
    | 'workflow'
    | 'wand'
    | 'sim-chat'
    | 'mcp_copilot'
    | 'mothership_block'
    | 'knowledge-base'
    | 'voice-input'
    | 'enrichment'
    | 'voice-output'
  workspaceId?: string
  period?: '1d' | '7d' | '30d' | 'all' | 'custom'
  startDate?: string
  endDate?: string
  limit?: number
  cursor?: string
}

type ListBillingLogsResponseRef0 = {
  id: string
  createdAt: string
  source:
    | 'workflow'
    | 'wand'
    | 'sim-chat'
    | 'mcp_copilot'
    | 'mothership_block'
    | 'knowledge-base'
    | 'voice-input'
    | 'enrichment'
    | 'voice-output'
  workspaceId: string | null
  workflow: {
    id: string
    name: string | null
  } | null
  runId: string | null
  creditCost: number
}

export type ListBillingLogsResponse = {
  data: Array<ListBillingLogsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/credentials` */
export type ListCredentialsQuery = {
  workspaceId: string
  type?: 'oauth' | 'service_account'
  providerId?: string
  search?: string
  sortBy?: 'displayName' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListCredentialsResponseRef0 = {
  id: string
  type: 'oauth' | 'service_account'
  displayName: string
  description: string | null
  providerId: string | null
  accountId: string | null
  hasServiceAccountKey: boolean
  role: 'admin' | 'member'
  createdAt: string
  updatedAt: string
}

export type ListCredentialsResponse = {
  data: Array<ListCredentialsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/custom-tools` */
export type ListCustomToolsQuery = {
  workspaceId: string
  search?: string
  sortBy?: 'title' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListCustomToolsResponseRef0 = {
  id: string
  title: string
  schema: {
    type: 'function'
    function: {
      name: string
      description?: string
      parameters: {
        type: string
        properties: Record<string, unknown>
        required?: Array<string>
      }
    }
  }
  code: string
  createdAt: string
  updatedAt: string
}

export type ListCustomToolsResponse = {
  data: Array<ListCustomToolsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/files/folders` */
type ListFileFoldersQueryRef0 = string

export type ListFileFoldersQuery = {
  workspaceId: string
  parentPath?: ListFileFoldersQueryRef0
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}

type ListFileFoldersResponseRef0 = {
  name: string
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
}

export type ListFileFoldersResponse = {
  data: Array<ListFileFoldersResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/files` */
type ListFilesQueryRef0 = string

export type ListFilesQuery = {
  workspaceId: string
  folderPath?: ListFilesQueryRef0
  scope?: 'active' | 'archived'
  search?: string
  sortBy?: 'name' | 'size' | 'uploadedAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListFilesResponseRef0 = {
  id: string
  name: string
  size: number
  type: string
  key: string
  folderPath: string
  uploadedByEmail: string
  uploadedAt: string
  updatedAt: string
  deletedAt: string | null
}

export type ListFilesResponse = {
  data: Array<ListFilesResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/knowledge` */
type ListKnowledgeBasesQueryRef0 = string

export type ListKnowledgeBasesQuery = {
  workspaceId: string
  folderPath?: ListKnowledgeBasesQueryRef0
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListKnowledgeBasesResponseRef0 = {
  id: string
  name: string
  description: string | null
  tokenCount: number
  embeddingModel: string
  embeddingDimension: number
  chunkingConfig: ListKnowledgeBasesResponseRef1
  docCount?: number
  connectorTypes?: Array<string>
  createdAt: string
  updatedAt: string
  ownerEmail: string
  folderPath: string
}

type ListKnowledgeBasesResponseRef1 = {
  maxSize: number
  minSize: number
  overlap: number
  strategy?: 'auto' | 'text' | 'regex' | 'recursive' | 'sentence' | 'token'
  strategyOptions?: {
    pattern?: string
    separators?: Array<string>
    recipe?: 'plain' | 'markdown' | 'code'
    strictBoundaries?: boolean
  }
}

export type ListKnowledgeBasesResponse = {
  data: Array<ListKnowledgeBasesResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/knowledge/[id]/documents` */
export type ListKnowledgeDocumentsParams = {
  id: string
}

export type ListKnowledgeDocumentsQuery = {
  workspaceId: string
  limit?: number
  search?: string
  enabledFilter?: 'all' | 'enabled' | 'disabled'
  sortBy?:
    | 'filename'
    | 'fileSize'
    | 'tokenCount'
    | 'chunkCount'
    | 'uploadedAt'
    | 'processingStatus'
    | 'enabled'
  sortOrder?: 'asc' | 'desc'
  cursor?: string
  tagFilters?: string
}

type ListKnowledgeDocumentsResponseRef0 = {
  id: string
  knowledgeBaseId: string
  filename: string
  fileSize: number
  mimeType: string
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  chunkCount: number
  tokenCount: number
  characterCount: number
  enabled: boolean
  createdAt: string | null
  tags: Record<string, string | number | boolean | null>
}

export type ListKnowledgeDocumentsResponse = {
  data: Array<ListKnowledgeDocumentsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/knowledge/folders` */
type ListKnowledgeFoldersQueryRef0 = string

export type ListKnowledgeFoldersQuery = {
  workspaceId: string
  parentPath?: ListKnowledgeFoldersQueryRef0
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}

type ListKnowledgeFoldersResponseRef0 = {
  name: string
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
}

export type ListKnowledgeFoldersResponse = {
  data: Array<ListKnowledgeFoldersResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/knowledge/[id]/tags` */
export type ListKnowledgeTagsParams = {
  id: string
}

export type ListKnowledgeTagsQuery = {
  workspaceId: string
}

type ListKnowledgeTagsResponseRef0 = {
  displayName: string
  tagSlot: string
  fieldType: string
}

export type ListKnowledgeTagsResponse = {
  data: Array<ListKnowledgeTagsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/logs` */
export type ListLogsQuery = {
  workspaceId: string
  workflowIds?: string
  triggers?: string
  level?: 'info' | 'error'
  startDate?: string
  endDate?: string
  minDurationMs?: number
  maxDurationMs?: number
  minCost?: number
  maxCost?: number
  model?: string
  details?: 'basic' | 'full'
  includeTraceSpans?: boolean
  includeFinalOutput?: boolean
  limit?: number
  cursor?: string
  order?: 'asc' | 'desc'
  runId?: string
  folderPaths?: string
}

type ListLogsResponseRef0 = {
  runId: string
  workflowId: string | null
  deploymentVersionId: string | null
  status: 'pending' | 'running' | 'paused' | 'redacting' | 'completed' | 'failed' | 'cancelled'
  level: string
  trigger: string
  startedAt: string
  endedAt: string | null
  totalDurationMs: number | null
  cost: {
    total: number
  } | null
  files: Array<unknown> | null
  workflow?: {
    id: string | null
    name: string
    description: string | null
    deleted: boolean
  }
  finalOutput?: unknown
  traceSpans?: Array<ListLogsResponseRef1>
}

type ListLogsResponseRef1 = {
  id: string
  name: string
  type: string
  duration?: number
  durationMs?: number
  startTime?: string
  endTime?: string
  status?: string
  errorHandled?: boolean
  errorType?: string
  errorMessage?: string
  blockId?: string
  input?: unknown
  output?: unknown
  tokens?:
    | number
    | {
        total?: number
        input?: number
        output?: number
      }
  cost?: {
    total?: number
    input?: number
    output?: number
    toolCost?: number
  }
  relativeStartMs?: number
  toolCalls?: Array<{
    id?: string
    name?: string
    arguments?: unknown
    result?: unknown
    error?: string
    startTime?: string
    endTime?: string
    duration?: number
  }>
  children?: Array<ListLogsResponseRef1>
}

export type ListLogsResponse = {
  data: Array<ListLogsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/mcp-servers` */
export type ListMcpServersQuery = {
  workspaceId: string
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListMcpServersResponseRef0 = {
  id: string
  name: string
  description?: string
  transport: 'streamable-http'
  authType?: 'none' | 'headers' | 'oauth'
  url?: string
  timeout?: number
  retries?: number
  enabled: boolean
  connectionStatus?: 'connected' | 'disconnected' | 'error'
  lastError?: string | null
  toolCount?: number
  lastToolsRefresh?: string
  lastConnected?: string
  createdAt: string
  updatedAt: string
  oauthClientId?: string
  hasHeaders: boolean
  headerNames: Array<string>
  hasOauthClientSecret: boolean
}

export type ListMcpServersResponse = {
  data: Array<ListMcpServersResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/mcp-servers/[id]/tools` */
export type ListMcpServerToolsParams = {
  id: string
}

export type ListMcpServerToolsQuery = {
  workspaceId: string
  refresh?: boolean
}

type ListMcpServerToolsResponseRef0 = {
  name: string
  description?: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: Array<string>
  }
  serverId: string
  serverName: string
}

export type ListMcpServerToolsResponse = {
  data: Array<ListMcpServerToolsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/secrets` */
export type ListSecretsQuery = {
  workspaceId: string
  scope?: 'workspace' | 'personal'
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListSecretsResponseRef0 = {
  name: string
  scope: 'workspace' | 'personal'
  role: 'admin' | 'member'
  createdAt: string
  updatedAt: string
}

export type ListSecretsResponse = {
  data: Array<ListSecretsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/skills` */
export type ListSkillsQuery = {
  workspaceId: string
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListSkillsResponseRef0 = {
  id: string
  name: string
  description: string
  readOnly: boolean
  createdAt: string
  updatedAt: string
}

export type ListSkillsResponse = {
  data: Array<ListSkillsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/tables/folders` */
type ListTableFoldersQueryRef0 = string

export type ListTableFoldersQuery = {
  workspaceId: string
  parentPath?: ListTableFoldersQueryRef0
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}

type ListTableFoldersResponseRef0 = {
  name: string
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
}

export type ListTableFoldersResponse = {
  data: Array<ListTableFoldersResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/tables/[tableId]/rows` */
export type ListTableRowsParams = {
  tableId: string
}

export type ListTableRowsQuery = {
  workspaceId: string
  limit?: number
  cursor?: string
}

type ListTableRowsResponseRef0 = {
  id: string
  data: ListTableRowsResponseRef1
  createdAt: string
  updatedAt: string
}

type ListTableRowsResponseRef1 = Record<string, unknown>

export type ListTableRowsResponse = {
  data: Array<ListTableRowsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/tables` */
type ListTablesQueryRef0 = string

export type ListTablesQuery = {
  workspaceId: string
  folderPath?: ListTablesQueryRef0
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListTablesResponseRef0 = {
  id: string
  name: string
  description: string | null
  ownerEmail: string
  schema: {
    columns: Array<{
      id?: string
      name: string
      type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
      required: boolean
      unique: boolean
      workflowGroupId?: string
      options?: Array<{
        id: string
        name: string
      }>
      multiple?: boolean
      currencyCode?: string
    }>
  }
  rowCount: number
  maxRows: number
  folderPath: string
  locks: {
    schemaLocked: boolean
    insertLocked: boolean
    updateLocked: boolean
    deleteLocked: boolean
  }
  job: ListTablesResponseRef1 | null
  createdAt: string
  updatedAt: string
}

type ListTablesResponseRef1 = {
  id: string | null
  type: 'import' | 'delete' | 'export' | 'backfill' | 'update' | null
  status: 'running' | 'ready' | 'failed' | 'canceled'
  rowsProcessed: number
  error: string | null
}

export type ListTablesResponse = {
  data: Array<ListTablesResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/tables/[tableId]/views` */
export type ListTableViewsParams = {
  tableId: string
}

export type ListTableViewsQuery = {
  workspaceId: string
}

type ListTableViewsResponseRef0 = {
  id: string
  tableId: string
  name: string
  config: ListTableViewsResponseRef1
  isDefault: boolean
  createdByEmail: string | null
  createdAt: string
  updatedAt: string
}

type ListTableViewsResponseRef1 = {
  columnWidths?: Record<string, number>
  columnOrder?: Array<string>
  pinnedColumns?: Array<string>
  hiddenColumns?: Array<string>
  filter?: unknown | null
  sort?: Array<{
    field: string
    direction: 'asc' | 'desc'
  }> | null
}

export type ListTableViewsResponse = {
  data: Array<ListTableViewsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/workflows/folders` */
type ListWorkflowFoldersQueryRef0 = string

export type ListWorkflowFoldersQuery = {
  workspaceId: string
  parentPath?: ListWorkflowFoldersQueryRef0
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}

type ListWorkflowFoldersResponseRef0 = {
  name: string
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
  locked: boolean
}

export type ListWorkflowFoldersResponse = {
  data: Array<ListWorkflowFoldersResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/tables/[tableId]/groups` */
export type ListWorkflowGroupsParams = {
  tableId: string
}

export type ListWorkflowGroupsQuery = {
  workspaceId: string
}

type ListWorkflowGroupsResponseRef0 = {
  id: string
  workflowId: string
  enrichmentId?: string
  name?: string
  type?: 'manual' | 'enrichment'
  dependencies?: {
    columns?: Array<string>
  }
  outputs: Array<{
    blockId: string
    path: string
    outputId?: string
    columnName: string
  }>
  inputMappings?: Array<{
    inputName: string
    columnName: string
  }>
  deploymentMode?: 'live' | 'deployed'
  autoRun?: boolean
}

export type ListWorkflowGroupsResponse = {
  data: Array<ListWorkflowGroupsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/workflows/[id]/runs` */
export type ListWorkflowRunsParams = {
  id: string
}

export type ListWorkflowRunsQuery = {
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'
  trigger?: string
  startDate?: string
  endDate?: string
  limit?: number
  cursor?: string
  order?: 'asc' | 'desc'
}

type ListWorkflowRunsResponseRef0 = {
  runId: string
  workflowId: string
  status: 'pending' | 'running' | 'paused' | 'redacting' | 'completed' | 'failed' | 'cancelled'
  trigger: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  cost: {
    total: number
  } | null
}

export type ListWorkflowRunsResponse = {
  data: Array<ListWorkflowRunsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/workflows` */
type ListWorkflowsQueryRef0 = string

export type ListWorkflowsQuery = {
  workspaceId: string
  folderPath?: ListWorkflowsQueryRef0
  deployedOnly?: boolean
  limit?: number
  cursor?: string
  search?: string
  sortBy?: 'position' | 'name' | 'createdAt' | 'updatedAt' | 'runCount'
  sortOrder?: 'asc' | 'desc'
}

type ListWorkflowsResponseRef0 = {
  id: string
  name: string
  description: string | null
  folderPath: string
  workspaceId: string
  isDeployed: boolean
  deployedAt: string | null
  runCount: number
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
}

export type ListWorkflowsResponse = {
  data: Array<ListWorkflowsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/workflows/[id]/versions` */
export type ListWorkflowVersionsParams = {
  id: string
}

export type ListWorkflowVersionsQuery = {
  limit?: number
  cursor?: string
}

type ListWorkflowVersionsResponseRef0 = {
  id: string
  version: number
  name?: string | null
  description?: string | null
  isActive: boolean
  createdAt: string
  deployedBy?: string | null
  latestOperationStatus?: 'preparing' | 'activating' | 'active' | 'failed' | 'superseded' | null
}

export type ListWorkflowVersionsResponse = {
  data: Array<ListWorkflowVersionsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/workspaces/[workspaceId]/members` */
export type ListWorkspaceMembersParams = {
  workspaceId: string
}

export type ListWorkspaceMembersQuery = {
  limit?: number
  cursor?: string
}

type ListWorkspaceMembersResponseRef0 = {
  email: string
  name: string
  image: string | null
  role: 'admin' | 'write' | 'read'
  isExternal: boolean
  joinedAt: string
}

export type ListWorkspaceMembersResponse = {
  data: Array<ListWorkspaceMembersResponseRef0>
  nextCursor: string | null
}

/** `POST /api/v2/files/move` */
export type MoveFileItemsQuery = Record<string, unknown>

type MoveFileItemsBodyRef0 = string

export type MoveFileItemsBody = {
  workspaceId: string
  fileIds: Array<string>
  targetFolderPath?: MoveFileItemsBodyRef0
}

type MoveFileItemsResponseRef0 = {
  movedItems: {
    files: number
  }
}

export type MoveFileItemsResponse = {
  data: MoveFileItemsResponseRef0
}

/** `POST /api/v2/tables/[tableId]/query` */
export type QueryRowsParams = {
  tableId: string
}

export type QueryRowsQuery = Record<string, unknown>

type QueryRowsBodyRef0 =
  | {
      all: Array<
        | QueryRowsBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }
  | {
      any: Array<
        | QueryRowsBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }

export type QueryRowsBody = {
  workspaceId: string
  predicate?: QueryRowsBodyRef0
  sort?: Array<{
    field: string
    direction: 'asc' | 'desc'
  }>
  limit?: number
  cursor?: string
}

type QueryRowsResponseRef0 = {
  id: string
  data: QueryRowsResponseRef1
  createdAt: string
  updatedAt: string
}

type QueryRowsResponseRef1 = Record<string, unknown>

export type QueryRowsResponse = {
  data: Array<QueryRowsResponseRef0>
  nextCursor: string | null
}

/** `POST /api/v2/tables/[tableId]/query/count` */
export type QueryRowsCountParams = {
  tableId: string
}

export type QueryRowsCountQuery = Record<string, unknown>

type QueryRowsCountBodyRef0 =
  | {
      all: Array<
        | QueryRowsCountBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }
  | {
      any: Array<
        | QueryRowsCountBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }

export type QueryRowsCountBody = {
  workspaceId: string
  predicate?: QueryRowsCountBodyRef0
}

type QueryRowsCountResponseRef0 = {
  totalCount: number
}

export type QueryRowsCountResponse = {
  data: QueryRowsCountResponseRef0
}

/** `PATCH /api/v2/files/folders` */
export type RelocateFileFolderQuery = Record<string, unknown>

type RelocateFileFolderBodyRef0 = string

export type RelocateFileFolderBody = {
  workspaceId: string
  path: RelocateFileFolderBodyRef0
  destinationPath: RelocateFileFolderBodyRef0
}

type RelocateFileFolderResponseRef0 = {
  name: string
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
}

export type RelocateFileFolderResponse = {
  data: RelocateFileFolderResponseRef0
}

/** `PATCH /api/v2/knowledge/folders` */
export type RelocateKnowledgeFolderQuery = Record<string, unknown>

type RelocateKnowledgeFolderBodyRef0 = string

export type RelocateKnowledgeFolderBody = {
  workspaceId: string
  path: RelocateKnowledgeFolderBodyRef0
  destinationPath: RelocateKnowledgeFolderBodyRef0
}

type RelocateKnowledgeFolderResponseRef0 = {
  name: string
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
}

export type RelocateKnowledgeFolderResponse = {
  data: RelocateKnowledgeFolderResponseRef0
}

/** `PATCH /api/v2/tables/folders` */
export type RelocateTableFolderQuery = Record<string, unknown>

type RelocateTableFolderBodyRef0 = string

export type RelocateTableFolderBody = {
  workspaceId: string
  path: RelocateTableFolderBodyRef0
  destinationPath: RelocateTableFolderBodyRef0
}

type RelocateTableFolderResponseRef0 = {
  name: string
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
}

export type RelocateTableFolderResponse = {
  data: RelocateTableFolderResponseRef0
}

/** `PATCH /api/v2/workflows/folders` */
export type RelocateWorkflowFolderQuery = Record<string, unknown>

type RelocateWorkflowFolderBodyRef0 = string

export type RelocateWorkflowFolderBody = {
  workspaceId: string
  path: RelocateWorkflowFolderBodyRef0
  destinationPath: RelocateWorkflowFolderBodyRef0
}

type RelocateWorkflowFolderResponseRef0 = {
  name: string
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
  locked: boolean
}

export type RelocateWorkflowFolderResponse = {
  data: RelocateWorkflowFolderResponseRef0
}

/** `PATCH /api/v2/files/[fileId]` */
export type RenameFileParams = {
  fileId: string
}

export type RenameFileQuery = Record<string, unknown>

export type RenameFileBody = {
  workspaceId: string
  name: string
}

type RenameFileResponseRef0 = {
  id: string
  name: string
  size: number
  type: string
  key: string
  folderPath: string
  uploadedByEmail: string
  uploadedAt: string
  updatedAt: string
  deletedAt: string | null
}

export type RenameFileResponse = {
  data: RenameFileResponseRef0
}

/** `POST /api/v2/files/[fileId]/restore` */
export type RestoreFileParams = {
  fileId: string
}

export type RestoreFileQuery = Record<string, unknown>

export type RestoreFileBody = {
  workspaceId: string
}

type RestoreFileResponseRef0 = {
  id: string
  name: string
  size: number
  type: string
  key: string
  folderPath: string
  uploadedByEmail: string
  uploadedAt: string
  updatedAt: string
  deletedAt: string | null
}

export type RestoreFileResponse = {
  data: RestoreFileResponseRef0
}

/** `POST /api/v2/workflows/[id]/runs/[runId]/resume` */
export type ResumeWorkflowParams = {
  id: string
  runId: string
}

export type ResumeWorkflowQuery = Record<string, unknown>

export type ResumeWorkflowBody = {
  contextId: string
  input?: unknown
}

type ResumeWorkflowResponseRef0 = {
  message: string
  code:
    | 'TIMEOUT'
    | 'CANCELLED'
    | 'USAGE_LIMIT_EXCEEDED'
    | 'INVALID_INPUT'
    | 'BLOCK_EXECUTION_FAILED'
    | 'CHILD_WORKFLOW_FAILED'
    | 'EXECUTION_FAILED'
  blockId?: string
  blockName?: string
  blockType?: string
}

type ResumeWorkflowResponseRef1 = {
  runId: string
  workflowId: string
  status: 'completed' | 'failed' | 'paused' | 'cancelled'
  output: unknown
  error: ResumeWorkflowResponseRef0 | null
  startedAt?: string
  endedAt?: string
  durationMs?: number
}

type ResumeWorkflowResponseRef2 = {
  runId: string
  statusUrl: string
  queuePosition?: number
}

export type ResumeWorkflowResponse =
  | {
      data: ResumeWorkflowResponseRef1
    }
  | {
      data: ResumeWorkflowResponseRef2
    }

/** `POST /api/v2/workflows/[id]/rollback` */
export type RollbackWorkflowParams = {
  id: string
}

export type RollbackWorkflowQuery = Record<string, unknown>

export type RollbackWorkflowBody = {
  version?: number
}

type RollbackWorkflowResponseRef0 = {
  deploymentVersionId: string
  version: number
  deployedAt: string
}

type RollbackWorkflowResponseRef1 = {
  id: string
  deploymentVersionId: string
  version: number
  action: 'deploy' | 'activate'
  status: 'preparing' | 'activating' | 'active' | 'failed' | 'superseded'
  isCurrent: boolean
  readiness: RollbackWorkflowResponseRef2
  requestedAt: string
  activatedAt?: string | null
  error?: RollbackWorkflowResponseRef3 | null
}

type RollbackWorkflowResponseRef2 = {
  webhooks: 'pending' | 'ready' | 'not_applicable'
  schedules: 'pending' | 'ready' | 'not_applicable'
  mcp: 'pending' | 'ready' | 'not_applicable'
}

type RollbackWorkflowResponseRef3 = {
  code: string
  message: string
  retryable: boolean
}

type RollbackWorkflowResponseRef4 = {
  id: string
  isDeployed: boolean
  deployedAt: string | null
  warnings: Array<string>
  activeDeployment: RollbackWorkflowResponseRef0 | null
  latestDeploymentAttempt: RollbackWorkflowResponseRef1 | null
  version: number
}

export type RollbackWorkflowResponse = {
  data: RollbackWorkflowResponseRef4
}

/** `POST /api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]` */
export type RunRowEnrichmentParams = {
  tableId: string
  rowId: string
  groupId: string
}

export type RunRowEnrichmentQuery = Record<string, unknown>

export type RunRowEnrichmentBody = {
  workspaceId: string
}

type RunRowEnrichmentResponseRef0 = {
  dispatchId: string | null
}

export type RunRowEnrichmentResponse = {
  data: RunRowEnrichmentResponseRef0
}

/** `POST /api/v2/tables/[tableId]/columns/run` */
export type RunTableColumnParams = {
  tableId: string
}

export type RunTableColumnQuery = Record<string, unknown>

type RunTableColumnBodyRef0 =
  | {
      all: Array<
        | RunTableColumnBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }
  | {
      any: Array<
        | RunTableColumnBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }

export type RunTableColumnBody = {
  workspaceId: string
  groupIds: Array<string>
  runMode?: 'all' | 'incomplete'
  rowIds?: Array<string>
  filter?: RunTableColumnBodyRef0
  excludeRowIds?: Array<string>
  limit?: {
    type: 'rows'
    max: number
  }
}

type RunTableColumnResponseRef0 = {
  dispatchId: string | null
}

export type RunTableColumnResponse = {
  data: RunTableColumnResponseRef0
}

/** `POST /api/v2/knowledge/search` */
export type SearchKnowledgeQuery = Record<string, unknown>

type SearchKnowledgeBodyRef0 = {
  tagName: string
  fieldType?: 'text' | 'number' | 'date' | 'boolean'
  operator?:
    | 'eq'
    | 'neq'
    | 'contains'
    | 'not_contains'
    | 'starts_with'
    | 'ends_with'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'between'
  value: string | number | boolean
  valueTo?: string | number
}

export type SearchKnowledgeBody = {
  workspaceId: string
  knowledgeBaseIds: string | Array<string>
  query?: string
  topK?: number
  tagFilters?: Array<SearchKnowledgeBodyRef0>
  searchMode?: 'vector' | 'hybrid' | null
  rerankerEnabled?: boolean
  rerankerModel?: 'rerank-v4.0-pro' | 'rerank-v4.0-fast' | 'rerank-v3.5'
  rerankerInputCount?: number
}

type SearchKnowledgeResponseRef0 = {
  knowledgeBaseId: string
  documentId: string
  documentName: string | null
  sourceUrl: string | null
  content: string
  chunkIndex: number
  metadata: Record<string, unknown>
  similarity: number
  rerankerScore?: number
}

type SearchKnowledgeResponseRef1 = {
  results: Array<SearchKnowledgeResponseRef0>
  query: string
  knowledgeBaseIds: Array<string>
  topK: number
  totalResults: number
  rerankerStatus: 'not_requested' | 'skipped' | 'unavailable' | 'applied'
}

export type SearchKnowledgeResponse = {
  data: SearchKnowledgeResponseRef1
}

/** `PUT /api/v2/secrets/[name]` */
export type SetSecretParams = {
  name: string
}

export type SetSecretQuery = Record<string, unknown>

export type SetSecretBody = {
  workspaceId: string
  scope: 'workspace' | 'personal'
  value: string
}

type SetSecretResponseRef0 = {
  name: string
  scope: 'workspace' | 'personal'
  role: 'admin' | 'member'
  createdAt: string
  updatedAt: string
}

export type SetSecretResponse = {
  data: SetSecretResponseRef0
}

/** `GET /api/v2/tables/exports/[exportId]/download` */
export type TableExportDownloadParams = {
  exportId: string
}

export type TableExportDownloadQuery = {
  workspaceId: string
}

type TableExportDownloadResponseRef0 = {
  url: string
  fileName: string
  expiresAt: string
}

export type TableExportDownloadResponse = {
  data: TableExportDownloadResponseRef0
}

/** `DELETE /api/v2/workflows/[id]/deploy` */
export type UndeployWorkflowParams = {
  id: string
}

export type UndeployWorkflowQuery = Record<string, unknown>

type UndeployWorkflowResponseRef0 = {
  deploymentVersionId: string
  version: number
  deployedAt: string
}

type UndeployWorkflowResponseRef1 = {
  id: string
  deploymentVersionId: string
  version: number
  action: 'deploy' | 'activate'
  status: 'preparing' | 'activating' | 'active' | 'failed' | 'superseded'
  isCurrent: boolean
  readiness: UndeployWorkflowResponseRef2
  requestedAt: string
  activatedAt?: string | null
  error?: UndeployWorkflowResponseRef3 | null
}

type UndeployWorkflowResponseRef2 = {
  webhooks: 'pending' | 'ready' | 'not_applicable'
  schedules: 'pending' | 'ready' | 'not_applicable'
  mcp: 'pending' | 'ready' | 'not_applicable'
}

type UndeployWorkflowResponseRef3 = {
  code: string
  message: string
  retryable: boolean
}

type UndeployWorkflowResponseRef4 = {
  id: string
  isDeployed: boolean
  deployedAt: string | null
  warnings: Array<string>
  activeDeployment: UndeployWorkflowResponseRef0 | null
  latestDeploymentAttempt: UndeployWorkflowResponseRef1 | null
}

export type UndeployWorkflowResponse = {
  data: UndeployWorkflowResponseRef4
}

/** `PATCH /api/v2/custom-tools/[id]` */
export type UpdateCustomToolParams = {
  id: string
}

export type UpdateCustomToolQuery = Record<string, unknown>

export type UpdateCustomToolBody = {
  workspaceId: string
  title?: string
  schema?: {
    type: 'function'
    function: {
      name: string
      description?: string
      parameters: {
        type: string
        properties: Record<string, unknown>
        required?: Array<string>
      }
    }
  }
  code?: string
}

type UpdateCustomToolResponseRef0 = {
  id: string
  title: string
  schema: {
    type: 'function'
    function: {
      name: string
      description?: string
      parameters: {
        type: string
        properties: Record<string, unknown>
        required?: Array<string>
      }
    }
  }
  code: string
  createdAt: string
  updatedAt: string
}

export type UpdateCustomToolResponse = {
  data: UpdateCustomToolResponseRef0
}

/** `PUT /api/v2/files/[fileId]/content` */
export type UpdateFileContentParams = {
  fileId: string
}

export type UpdateFileContentQuery = Record<string, unknown>

export type UpdateFileContentBody = {
  workspaceId: string
  content: string
  encoding?: 'utf-8' | 'base64'
}

type UpdateFileContentResponseRef0 = {
  id: string
  name: string
  size: number
  type: string
  key: string
  folderPath: string
  uploadedByEmail: string
  uploadedAt: string
  updatedAt: string
  deletedAt: string | null
}

export type UpdateFileContentResponse = {
  data: UpdateFileContentResponseRef0
}

/** `PATCH /api/v2/knowledge/[id]` */
export type UpdateKnowledgeBaseParams = {
  id: string
}

export type UpdateKnowledgeBaseQuery = Record<string, unknown>

type UpdateKnowledgeBaseBodyRef0 = {
  maxSize?: number
  minSize?: number
  overlap?: number
}

type UpdateKnowledgeBaseBodyRef1 = string

export type UpdateKnowledgeBaseBody = {
  workspaceId: string
  name?: string
  description?: string
  chunkingConfig?: UpdateKnowledgeBaseBodyRef0
  folderPath?: UpdateKnowledgeBaseBodyRef1
}

type UpdateKnowledgeBaseResponseRef0 = {
  maxSize: number
  minSize: number
  overlap: number
  strategy?: 'auto' | 'text' | 'regex' | 'recursive' | 'sentence' | 'token'
  strategyOptions?: {
    pattern?: string
    separators?: Array<string>
    recipe?: 'plain' | 'markdown' | 'code'
    strictBoundaries?: boolean
  }
}

type UpdateKnowledgeBaseResponseRef1 = {
  id: string
  name: string
  description: string | null
  tokenCount: number
  embeddingModel: string
  embeddingDimension: number
  chunkingConfig: UpdateKnowledgeBaseResponseRef0
  docCount?: number
  connectorTypes?: Array<string>
  createdAt: string
  updatedAt: string
  ownerEmail: string
  folderPath: string
}

export type UpdateKnowledgeBaseResponse = {
  data: UpdateKnowledgeBaseResponseRef1
}

/** `PATCH /api/v2/knowledge/[id]/documents/[documentId]` */
export type UpdateKnowledgeDocumentParams = {
  id: string
  documentId: string
}

export type UpdateKnowledgeDocumentQuery = Record<string, unknown>

export type UpdateKnowledgeDocumentBody = {
  workspaceId: string
  filename?: string
  enabled?: boolean
  tag1?: string
  tag2?: string
  tag3?: string
  tag4?: string
  tag5?: string
  tag6?: string
  tag7?: string
  number1?: number
  number2?: number
  number3?: number
  number4?: number
  number5?: number
  date1?: string
  date2?: string
  boolean1?: boolean
  boolean2?: boolean
  boolean3?: boolean
  retryProcessing?: true
}

type UpdateKnowledgeDocumentResponseRef0 = {
  id: string
  knowledgeBaseId: string
  filename: string
  fileSize: number
  mimeType: string
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  chunkCount: number
  tokenCount: number
  characterCount: number
  enabled: boolean
  createdAt: string | null
  tags: Record<string, string | number | boolean | null>
}

type UpdateKnowledgeDocumentResponseRef1 = {
  id: string
  queued: true
  processingStatus: string
  message: string
}

export type UpdateKnowledgeDocumentResponse = {
  data: UpdateKnowledgeDocumentResponseRef0 | UpdateKnowledgeDocumentResponseRef1
}

/** `PATCH /api/v2/mcp-servers/[id]` */
export type UpdateMcpServerParams = {
  id: string
}

export type UpdateMcpServerQuery = Record<string, unknown>

export type UpdateMcpServerBody = {
  workspaceId: string
  name?: string
  description?: string
  transport?: 'streamable-http'
  url?: string
  authType?: 'none' | 'headers' | 'oauth'
  headers?: Record<string, string>
  timeout?: number
  retries?: number
  enabled?: boolean
  oauthClientId?: string | null
  oauthClientSecret?: string | null
}

type UpdateMcpServerResponseRef0 = {
  id: string
  name: string
  description?: string
  transport: 'streamable-http'
  authType?: 'none' | 'headers' | 'oauth'
  url?: string
  timeout?: number
  retries?: number
  enabled: boolean
  connectionStatus?: 'connected' | 'disconnected' | 'error'
  lastError?: string | null
  toolCount?: number
  lastToolsRefresh?: string
  lastConnected?: string
  createdAt: string
  updatedAt: string
  oauthClientId?: string
  hasHeaders: boolean
  headerNames: Array<string>
  hasOauthClientSecret: boolean
}

export type UpdateMcpServerResponse = {
  data: UpdateMcpServerResponseRef0
}

/** `PATCH /api/v2/tables/[tableId]/rows` */
export type UpdateRowsByFilterParams = {
  tableId: string
}

export type UpdateRowsByFilterQuery = Record<string, unknown>

type UpdateRowsByFilterBodyRef0 =
  | {
      all: Array<
        | UpdateRowsByFilterBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }
  | {
      any: Array<
        | UpdateRowsByFilterBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }

type UpdateRowsByFilterBodyRef1 = Record<string, unknown>

export type UpdateRowsByFilterBody = {
  workspaceId: string
  filter: UpdateRowsByFilterBodyRef0
  data: UpdateRowsByFilterBodyRef1
  limit?: number
}

type UpdateRowsByFilterResponseRef0 = {
  updatedCount: number
  updatedRowIds: Array<string>
}

export type UpdateRowsByFilterResponse = {
  data: UpdateRowsByFilterResponseRef0
}

/** `PATCH /api/v2/skills/[id]` */
export type UpdateSkillParams = {
  id: string
}

export type UpdateSkillQuery = Record<string, unknown>

export type UpdateSkillBody = {
  workspaceId: string
  name?: string
  description?: string
  content?: string
}

type UpdateSkillResponseRef0 = {
  id: string
  name: string
  description: string
  readOnly: boolean
  createdAt: string
  updatedAt: string
  content: string
}

export type UpdateSkillResponse = {
  data: UpdateSkillResponseRef0
}

/** `PATCH /api/v2/tables/[tableId]` */
export type UpdateTableParams = {
  tableId: string
}

export type UpdateTableQuery = Record<string, unknown>

type UpdateTableBodyRef0 = string

export type UpdateTableBody = {
  workspaceId: string
  name?: string
  description?: string | null
  folderPath?: UpdateTableBodyRef0
}

type UpdateTableResponseRef0 = {
  id: string | null
  type: 'import' | 'delete' | 'export' | 'backfill' | 'update' | null
  status: 'running' | 'ready' | 'failed' | 'canceled'
  rowsProcessed: number
  error: string | null
}

type UpdateTableResponseRef1 = {
  id: string
  name: string
  description: string | null
  ownerEmail: string
  schema: {
    columns: Array<{
      id?: string
      name: string
      type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
      required: boolean
      unique: boolean
      workflowGroupId?: string
      options?: Array<{
        id: string
        name: string
      }>
      multiple?: boolean
      currencyCode?: string
    }>
  }
  rowCount: number
  maxRows: number
  folderPath: string
  locks: {
    schemaLocked: boolean
    insertLocked: boolean
    updateLocked: boolean
    deleteLocked: boolean
  }
  job: UpdateTableResponseRef0 | null
  createdAt: string
  updatedAt: string
}

export type UpdateTableResponse = {
  data: UpdateTableResponseRef1
}

/** `PATCH /api/v2/tables/[tableId]/columns` */
export type UpdateTableColumnParams = {
  tableId: string
}

export type UpdateTableColumnQuery = Record<string, unknown>

export type UpdateTableColumnBody = {
  workspaceId: string
  columnName: string
  updates: {
    name?: string
    type?: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
    required?: boolean
    unique?: boolean
    options?: Array<{
      id: string
      name: string
    }>
    multiple?: boolean
    currencyCode?: string
  }
}

type UpdateTableColumnResponseRef0 = {
  columns: Array<{
    id?: string
    name: string
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
    required: boolean
    unique: boolean
    workflowGroupId?: string
    options?: Array<{
      id: string
      name: string
    }>
    multiple?: boolean
    currencyCode?: string
  }>
}

export type UpdateTableColumnResponse = {
  data: UpdateTableColumnResponseRef0
}

/** `PATCH /api/v2/tables/[tableId]/rows/[rowId]` */
export type UpdateTableRowParams = {
  tableId: string
  rowId: string
}

export type UpdateTableRowQuery = Record<string, unknown>

type UpdateTableRowBodyRef0 = Record<string, unknown>

export type UpdateTableRowBody = {
  workspaceId: string
  data: UpdateTableRowBodyRef0
}

type UpdateTableRowResponseRef0 = Record<string, unknown>

type UpdateTableRowResponseRef1 = {
  id: string
  data: UpdateTableRowResponseRef0
  createdAt: string
  updatedAt: string
}

export type UpdateTableRowResponse = {
  data: UpdateTableRowResponseRef1
}

/** `PATCH /api/v2/tables/[tableId]/views/[viewId]` */
export type UpdateTableViewParams = {
  tableId: string
  viewId: string
}

export type UpdateTableViewQuery = Record<string, unknown>

type UpdateTableViewBodyRef0 =
  | {
      all: Array<
        | UpdateTableViewBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }
  | {
      any: Array<
        | UpdateTableViewBodyRef0
        | {
            field: string
            op:
              | 'eq'
              | 'ne'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
              | 'in'
              | 'nin'
              | 'contains'
              | 'ncontains'
              | 'startsWith'
              | 'endsWith'
              | 'like'
              | 'ilike'
              | 'nlike'
              | 'nilike'
              | 'isEmpty'
              | 'isNotEmpty'
              | 'isNull'
              | 'isNotNull'
            value?: unknown
          }
      >
    }
  | {
      field: string
      op:
        | 'eq'
        | 'ne'
        | 'gt'
        | 'gte'
        | 'lt'
        | 'lte'
        | 'in'
        | 'nin'
        | 'contains'
        | 'ncontains'
        | 'startsWith'
        | 'endsWith'
        | 'like'
        | 'ilike'
        | 'nlike'
        | 'nilike'
        | 'isEmpty'
        | 'isNotEmpty'
        | 'isNull'
        | 'isNotNull'
      value?: unknown
    }

export type UpdateTableViewBody = {
  workspaceId: string
  name?: string
  config?: {
    columnWidths?: Record<string, number>
    columnOrder?: Array<string>
    pinnedColumns?: Array<string>
    hiddenColumns?: Array<string>
    filter?: UpdateTableViewBodyRef0 | null
    sort?: Array<{
      field: string
      direction: 'asc' | 'desc'
    }> | null
  }
  configPatch?: {
    columnWidths?: Record<string, number>
    columnOrder?: Array<string>
    pinnedColumns?: Array<string>
    hiddenColumns?: Array<string>
    filter?: UpdateTableViewBodyRef0 | null
    sort?: Array<{
      field: string
      direction: 'asc' | 'desc'
    }> | null
  }
  isDefault?: boolean
}

type UpdateTableViewResponseRef0 = {
  columnWidths?: Record<string, number>
  columnOrder?: Array<string>
  pinnedColumns?: Array<string>
  hiddenColumns?: Array<string>
  filter?: unknown | null
  sort?: Array<{
    field: string
    direction: 'asc' | 'desc'
  }> | null
}

type UpdateTableViewResponseRef1 = {
  id: string
  tableId: string
  name: string
  config: UpdateTableViewResponseRef0
  isDefault: boolean
  createdByEmail: string | null
  createdAt: string
  updatedAt: string
}

export type UpdateTableViewResponse = {
  data: UpdateTableViewResponseRef1
}

/** `PATCH /api/v2/workflows/[id]` */
export type UpdateWorkflowParams = {
  id: string
}

export type UpdateWorkflowQuery = Record<string, unknown>

type UpdateWorkflowBodyRef0 = string

export type UpdateWorkflowBody = {
  name?: string
  description?: string | null
  folderPath?: UpdateWorkflowBodyRef0
}

type UpdateWorkflowResponseRef0 = {
  id: string
  name: string
  description: string | null
  folderPath: string
  workspaceId: string
  isDeployed: boolean
  deployedAt: string | null
  runCount: number
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
}

export type UpdateWorkflowResponse = {
  data: UpdateWorkflowResponseRef0
}

/** `PATCH /api/v2/tables/[tableId]/groups` */
export type UpdateWorkflowGroupParams = {
  tableId: string
}

export type UpdateWorkflowGroupQuery = Record<string, unknown>

export type UpdateWorkflowGroupBody = {
  workspaceId: string
  groupId: string
  workflowId?: string
  name?: string
  dependencies?: {
    columns?: Array<string>
  }
  outputs?: Array<{
    blockId?: string
    path?: string
    outputId?: string
    columnName: string
  }>
  newOutputColumns?: Array<{
    name: string
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
    required?: boolean
    unique?: boolean
  }>
  mappingUpdates?: Array<{
    columnName: string
    blockId: string
    path: string
  }>
  inputMappings?: Array<{
    inputName: string
    columnName: string
  }>
  deploymentMode?: 'live' | 'deployed'
  type?: 'manual' | 'enrichment'
  autoRun?: boolean
}

type UpdateWorkflowGroupResponseRef0 = {
  id: string
  workflowId: string
  enrichmentId?: string
  name?: string
  type?: 'manual' | 'enrichment'
  dependencies?: {
    columns?: Array<string>
  }
  outputs: Array<{
    blockId: string
    path: string
    outputId?: string
    columnName: string
  }>
  inputMappings?: Array<{
    inputName: string
    columnName: string
  }>
  deploymentMode?: 'live' | 'deployed'
  autoRun?: boolean
}

type UpdateWorkflowGroupResponseRef1 = {
  group: UpdateWorkflowGroupResponseRef0
  columns: Array<{
    id?: string
    name: string
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
    required: boolean
    unique: boolean
    workflowGroupId?: string
    options?: Array<{
      id: string
      name: string
    }>
    multiple?: boolean
    currencyCode?: string
  }>
}

export type UpdateWorkflowGroupResponse = {
  data: UpdateWorkflowGroupResponseRef1
}

/** `POST /api/v2/knowledge/[id]/documents` */
export type UploadKnowledgeDocumentParams = {
  id: string
}

export type UploadKnowledgeDocumentQuery = {
  workspaceId: string
}

type UploadKnowledgeDocumentResponseRef0 = {
  id: string
  knowledgeBaseId: string
  filename: string
  fileSize: number
  mimeType: string
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  chunkCount: number
  tokenCount: number
  characterCount: number
  enabled: boolean
  createdAt: string | null
}

export type UploadKnowledgeDocumentResponse = {
  data: UploadKnowledgeDocumentResponseRef0
}

/** `PATCH /api/v2/files/[fileId]/share` */
export type UpsertFileShareParams = {
  fileId: string
}

export type UpsertFileShareQuery = Record<string, unknown>

export type UpsertFileShareBody = {
  workspaceId: string
  isActive: boolean
  authType?: 'public' | 'password' | 'email' | 'sso'
  password?: string
  allowedEmails?: Array<string>
}

type UpsertFileShareResponseRef0 = {
  id: string
  token: string
  url: string
  isActive: boolean
  resourceType: 'file' | 'folder'
  resourceId: string
  authType: 'public' | 'password' | 'email' | 'sso'
  hasPassword: boolean
  allowedEmails: Array<string>
}

export type UpsertFileShareResponse = {
  data: UpsertFileShareResponseRef0
}

/** `POST /api/v2/tables/[tableId]/rows/upsert` */
export type UpsertTableRowParams = {
  tableId: string
}

export type UpsertTableRowQuery = Record<string, unknown>

type UpsertTableRowBodyRef0 = Record<string, unknown>

export type UpsertTableRowBody = {
  workspaceId: string
  data: UpsertTableRowBodyRef0
  conflictTarget?: string
}

type UpsertTableRowResponseRef0 = Record<string, unknown>

type UpsertTableRowResponseRef1 = {
  id: string
  data: UpsertTableRowResponseRef0
  createdAt: string
  updatedAt: string
}

type UpsertTableRowResponseRef2 = {
  row: UpsertTableRowResponseRef1
  operation: 'insert' | 'update'
}

export type UpsertTableRowResponse = {
  data: UpsertTableRowResponseRef2
}

/**
 * Every v2 operation, keyed by name.
 *
 * `query` and `body` describe each field well enough for the CLI to build a
 * flag for it and coerce the string argv gives back: its kind, whether it is
 * required, its enum values, and its server-side default. A slot the contract
 * does not declare — or one whose shape is a union with no flat field list —
 * is absent, and the runtime falls back to taking it as JSON.
 *
 * `summary` is the operation's one-line description, lifted from the OpenAPI
 * specs so `--help` reuses prose that is already written and already checked.
 */
export const V2_OPERATIONS = {
  abortFileUpload: {
    method: 'DELETE',
    path: '/api/v2/files/uploads/[uploadId]',
    pathParams: ['uploadId'] as const,
    responseMode: 'json',
    summary: 'Abort File Upload',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  abortKnowledgeDocumentUpload: {
    method: 'DELETE',
    path: '/api/v2/knowledge/[id]/documents/uploads/[uploadId]',
    pathParams: ['id', 'uploadId'] as const,
    responseMode: 'json',
    summary: 'Abort Document Upload',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  addTableColumn: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/columns',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Add Column',
    body: {
      workspaceId: { kind: 'string', required: true },
      column: { kind: 'object', required: true },
    },
  },
  addWorkflowGroup: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/groups',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Add Workflow Group',
    body: {
      workspaceId: { kind: 'string', required: true },
      group: { kind: 'object', required: true },
      outputColumns: { kind: 'array', required: true },
      autoRun: { kind: 'boolean', default: false },
    },
  },
  bulkDeleteFiles: {
    method: 'POST',
    path: '/api/v2/files/bulk-delete',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Delete Files',
    body: {
      workspaceId: { kind: 'string', required: true },
      fileIds: { kind: 'array', required: true },
    },
  },
  bulkUpdateKnowledgeDocuments: {
    method: 'PATCH',
    path: '/api/v2/knowledge/[id]/documents',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Bulk Enable or Disable Documents',
    body: {
      workspaceId: { kind: 'string', required: true },
      operation: { kind: 'enum', required: true, values: ['enable', 'disable'] as const },
      documentIds: { kind: 'array' },
      selectAll: { kind: 'boolean' },
      enabledFilter: { kind: 'enum', values: ['all', 'enabled', 'disabled'] as const },
    },
  },
  cancelTableExport: {
    method: 'DELETE',
    path: '/api/v2/tables/exports/[exportId]',
    pathParams: ['exportId'] as const,
    responseMode: 'json',
    summary: 'Cancel Table Export',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  cancelTableImport: {
    method: 'DELETE',
    path: '/api/v2/tables/imports/[importId]',
    pathParams: ['importId'] as const,
    responseMode: 'json',
    summary: 'Cancel Table Import',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  cancelTableRuns: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/cancel-runs',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Cancel Column Runs',
    body: {
      workspaceId: { kind: 'string', required: true },
      scope: { kind: 'enum', required: true, values: ['all', 'row'] as const },
      rowId: { kind: 'string' },
      filter: { kind: 'unknown' },
      excludeRowIds: { kind: 'array' },
    },
  },
  cancelWorkflowRun: {
    method: 'POST',
    path: '/api/v2/workflows/[id]/runs/[runId]/cancel',
    pathParams: ['id', 'runId'] as const,
    responseMode: 'json',
    summary: 'Cancel Workflow Run',
  },
  completeFileUpload: {
    method: 'POST',
    path: '/api/v2/files/uploads/[uploadId]/complete',
    pathParams: ['uploadId'] as const,
    responseMode: 'json',
    summary: 'Complete File Upload',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  completeKnowledgeDocumentUpload: {
    method: 'POST',
    path: '/api/v2/knowledge/[id]/documents/uploads/[uploadId]/complete',
    pathParams: ['id', 'uploadId'] as const,
    responseMode: 'json',
    summary: 'Complete Document Upload',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  completeTableImport: {
    method: 'POST',
    path: '/api/v2/tables/imports/[importId]/complete',
    pathParams: ['importId'] as const,
    responseMode: 'json',
    summary: 'Complete Table Import Upload',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  createCustomTool: {
    method: 'POST',
    path: '/api/v2/custom-tools',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Custom Tool',
    body: {
      workspaceId: { kind: 'string', required: true },
      title: { kind: 'string', required: true },
      schema: { kind: 'object', required: true },
      code: { kind: 'string', required: true },
    },
  },
  createFile: {
    method: 'POST',
    path: '/api/v2/files',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create File',
    body: {
      workspaceId: { kind: 'string', required: true },
      name: { kind: 'string', required: true },
      contentType: { kind: 'string' },
      folderPath: { kind: 'string' },
      content: { kind: 'string', default: '' },
      encoding: { kind: 'enum', values: ['utf-8', 'base64'] as const, default: 'utf-8' },
    },
  },
  createFileFolder: {
    method: 'POST',
    path: '/api/v2/files/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Folder',
    body: {
      workspaceId: { kind: 'string', required: true },
      path: { kind: 'string', required: true },
    },
  },
  createFileUpload: {
    method: 'POST',
    path: '/api/v2/files/uploads',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create File Upload',
    body: {
      workspaceId: { kind: 'string', required: true },
      name: { kind: 'string', required: true },
      contentType: { kind: 'string', required: true },
      size: { kind: 'integer', required: true },
      folderPath: { kind: 'string' },
    },
  },
  createFileUploadPartUrls: {
    method: 'POST',
    path: '/api/v2/files/uploads/[uploadId]/parts',
    pathParams: ['uploadId'] as const,
    responseMode: 'json',
    summary: 'Create File Upload Part URLs',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
    body: {
      partNumbers: { kind: 'array', required: true },
    },
  },
  createKnowledgeBase: {
    method: 'POST',
    path: '/api/v2/knowledge',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Knowledge Base',
    body: {
      workspaceId: { kind: 'string', required: true },
      name: { kind: 'string', required: true },
      description: { kind: 'string' },
      chunkingConfig: { kind: 'object' },
      folderPath: { kind: 'string' },
    },
  },
  createKnowledgeDocumentUpload: {
    method: 'POST',
    path: '/api/v2/knowledge/[id]/documents/uploads',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Create Document Upload',
    body: {
      workspaceId: { kind: 'string', required: true },
      name: { kind: 'string', required: true },
      contentType: { kind: 'string', required: true },
      size: { kind: 'integer', required: true },
      tag1: { kind: 'string' },
      tag2: { kind: 'string' },
      tag3: { kind: 'string' },
      tag4: { kind: 'string' },
      tag5: { kind: 'string' },
      tag6: { kind: 'string' },
      tag7: { kind: 'string' },
      processingOptions: { kind: 'object' },
    },
  },
  createKnowledgeDocumentUploadPartUrls: {
    method: 'POST',
    path: '/api/v2/knowledge/[id]/documents/uploads/[uploadId]/parts',
    pathParams: ['id', 'uploadId'] as const,
    responseMode: 'json',
    summary: 'Create Document Upload Part URLs',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
    body: {
      partNumbers: { kind: 'array', required: true },
    },
  },
  createKnowledgeFolder: {
    method: 'POST',
    path: '/api/v2/knowledge/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Folder',
    body: {
      workspaceId: { kind: 'string', required: true },
      path: { kind: 'string', required: true },
    },
  },
  createMcpServer: {
    method: 'POST',
    path: '/api/v2/mcp-servers',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create MCP Server',
    body: {
      workspaceId: { kind: 'string', required: true },
      name: { kind: 'string', required: true },
      description: { kind: 'string' },
      transport: { kind: 'enum', values: ['streamable-http'] as const, default: 'streamable-http' },
      url: { kind: 'string', required: true },
      authType: { kind: 'enum', values: ['none', 'headers', 'oauth'] as const },
      headers: { kind: 'object' },
      timeout: { kind: 'integer', default: 30000 },
      retries: { kind: 'integer', default: 3 },
      enabled: { kind: 'boolean', default: true },
      oauthClientId: { kind: 'string' },
      oauthClientSecret: { kind: 'string' },
    },
  },
  createSkill: {
    method: 'POST',
    path: '/api/v2/skills',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Skill',
    body: {
      workspaceId: { kind: 'string', required: true },
      name: { kind: 'string', required: true },
      description: { kind: 'string', required: true },
      content: { kind: 'string', required: true },
    },
  },
  createTable: {
    method: 'POST',
    path: '/api/v2/tables',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Table',
    body: {
      name: { kind: 'string', required: true },
      description: { kind: 'string' },
      workspaceId: { kind: 'string', required: true },
      schema: { kind: 'object', required: true },
      folderPath: { kind: 'string' },
    },
  },
  createTableExport: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/exports',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Create Table Export',
    body: {
      workspaceId: { kind: 'string', required: true },
      format: { kind: 'enum', values: ['csv', 'json'] as const, default: 'csv' },
    },
  },
  createTableFolder: {
    method: 'POST',
    path: '/api/v2/tables/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Folder',
    body: {
      workspaceId: { kind: 'string', required: true },
      path: { kind: 'string', required: true },
    },
  },
  createTableImport: {
    method: 'POST',
    path: '/api/v2/tables/imports',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Table Import',
    body: {
      workspaceId: { kind: 'string', required: true },
      source: { kind: 'unknown', required: true },
      target: { kind: 'unknown', required: true },
      mapping: { kind: 'object' },
      createColumns: { kind: 'array' },
      timezone: { kind: 'string' },
    },
  },
  createTableImportPartUrls: {
    method: 'POST',
    path: '/api/v2/tables/imports/[importId]/parts',
    pathParams: ['importId'] as const,
    responseMode: 'json',
    summary: 'Create Table Import Part URLs',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
    body: {
      partNumbers: { kind: 'array', required: true },
    },
  },
  createTableRows: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/rows',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Create Rows',
    body: {
      workspaceId: { kind: 'string', required: true },
    },
    opaqueBody: true,
  },
  createTableView: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/views',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Create View',
    body: {
      workspaceId: { kind: 'string', required: true },
      name: { kind: 'string', required: true },
      config: { kind: 'object', required: true },
    },
  },
  createWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Workflow',
    body: {
      workspaceId: { kind: 'string', required: true },
      name: { kind: 'string', required: true },
      description: { kind: 'string' },
      folderPath: { kind: 'string' },
    },
  },
  createWorkflowFolder: {
    method: 'POST',
    path: '/api/v2/workflows/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Workflow Folder',
    body: {
      workspaceId: { kind: 'string', required: true },
      path: { kind: 'string', required: true },
    },
  },
  deleteCustomTool: {
    method: 'DELETE',
    path: '/api/v2/custom-tools/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Delete Custom Tool',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  deleteFile: {
    method: 'DELETE',
    path: '/api/v2/files/[fileId]',
    pathParams: ['fileId'] as const,
    responseMode: 'json',
    summary: 'Delete File',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  deleteFileFolder: {
    method: 'DELETE',
    path: '/api/v2/files/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Delete Folder',
    query: {
      workspaceId: { kind: 'string', required: true },
      path: { kind: 'string', required: true },
      recursive: {
        kind: 'enum',
        values: [
          'true',
          '1',
          'yes',
          'on',
          'y',
          'enabled',
          'false',
          '0',
          'no',
          'off',
          'n',
          'disabled',
        ] as const,
        default: 'false',
      },
    },
  },
  deleteKnowledgeBase: {
    method: 'DELETE',
    path: '/api/v2/knowledge/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Delete Knowledge Base',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  deleteKnowledgeDocument: {
    method: 'DELETE',
    path: '/api/v2/knowledge/[id]/documents/[documentId]',
    pathParams: ['id', 'documentId'] as const,
    responseMode: 'json',
    summary: 'Delete Document',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  deleteKnowledgeFolder: {
    method: 'DELETE',
    path: '/api/v2/knowledge/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Delete Folder',
    query: {
      workspaceId: { kind: 'string', required: true },
      path: { kind: 'string', required: true },
      recursive: {
        kind: 'enum',
        values: [
          'true',
          '1',
          'yes',
          'on',
          'y',
          'enabled',
          'false',
          '0',
          'no',
          'off',
          'n',
          'disabled',
        ] as const,
        default: 'false',
      },
    },
  },
  deleteMcpServer: {
    method: 'DELETE',
    path: '/api/v2/mcp-servers/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Delete MCP Server',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  deleteSecret: {
    method: 'DELETE',
    path: '/api/v2/secrets/[name]',
    pathParams: ['name'] as const,
    responseMode: 'json',
    summary: 'Delete Secret',
    query: {
      workspaceId: { kind: 'string', required: true },
      scope: { kind: 'enum', required: true, values: ['workspace', 'personal'] as const },
    },
  },
  deleteSkill: {
    method: 'DELETE',
    path: '/api/v2/skills/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Delete Skill',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  deleteTable: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Delete Table',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  deleteTableColumn: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]/columns',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Delete Column',
    body: {
      workspaceId: { kind: 'string', required: true },
      columnName: { kind: 'string', required: true },
    },
  },
  deleteTableFolder: {
    method: 'DELETE',
    path: '/api/v2/tables/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Delete Folder',
    query: {
      workspaceId: { kind: 'string', required: true },
      path: { kind: 'string', required: true },
      recursive: {
        kind: 'enum',
        values: [
          'true',
          '1',
          'yes',
          'on',
          'y',
          'enabled',
          'false',
          '0',
          'no',
          'off',
          'n',
          'disabled',
        ] as const,
        default: 'false',
      },
    },
  },
  deleteTableRow: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]/rows/[rowId]',
    pathParams: ['tableId', 'rowId'] as const,
    responseMode: 'json',
    summary: 'Delete Row',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  deleteTableRows: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]/rows',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Delete Rows',
    body: {
      workspaceId: { kind: 'string', required: true },
      filter: { kind: 'unknown' },
      limit: { kind: 'integer' },
      rowIds: { kind: 'array' },
    },
  },
  deleteTableView: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]/views/[viewId]',
    pathParams: ['tableId', 'viewId'] as const,
    responseMode: 'json',
    summary: 'Delete View',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  deleteWorkflow: {
    method: 'DELETE',
    path: '/api/v2/workflows/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Delete Workflow',
  },
  deleteWorkflowFolder: {
    method: 'DELETE',
    path: '/api/v2/workflows/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Delete Workflow Folder',
    query: {
      workspaceId: { kind: 'string', required: true },
      path: { kind: 'string', required: true },
      recursive: {
        kind: 'enum',
        values: [
          'true',
          '1',
          'yes',
          'on',
          'y',
          'enabled',
          'false',
          '0',
          'no',
          'off',
          'n',
          'disabled',
        ] as const,
        default: 'false',
      },
    },
  },
  deleteWorkflowGroup: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]/groups',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Delete Workflow Group',
    body: {
      workspaceId: { kind: 'string', required: true },
      groupId: { kind: 'string', required: true },
    },
  },
  deployWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[id]/deploy',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Deploy Workflow',
    body: {
      name: { kind: 'string' },
      description: { kind: 'string' },
    },
  },
  downloadFile: {
    method: 'GET',
    path: '/api/v2/files/[fileId]',
    pathParams: ['fileId'] as const,
    responseMode: 'binary',
    summary: 'Download File',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  executeWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[id]/execute',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Execute Workflow',
    body: {
      input: { kind: 'object' },
      async: { kind: 'boolean', default: false },
      executionTimeoutSeconds: { kind: 'integer' },
      stream: { kind: 'boolean', default: false },
      selectedOutputs: { kind: 'array' },
      includeThinking: { kind: 'boolean', default: false },
      includeToolCalls: { kind: 'boolean', default: false },
      includeFileBase64: { kind: 'boolean' },
      base64MaxBytes: { kind: 'integer' },
    },
  },
  exportWorkflow: {
    method: 'GET',
    path: '/api/v2/workflows/[id]/export',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Export Workflow',
  },
  findTableRows: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/rows/find',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Find Rows',
    body: {
      workspaceId: { kind: 'string', required: true },
      q: { kind: 'string', required: true },
      predicate: { kind: 'unknown' },
      sort: { kind: 'array' },
    },
  },
  getAuditLog: {
    method: 'GET',
    path: '/api/v2/audit-logs/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Get Audit Log',
    query: {
      organizationId: { kind: 'string', required: true },
    },
  },
  getBillingStatus: {
    method: 'GET',
    path: '/api/v2/billing/status',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Get Billing Status',
    query: {
      workspaceId: { kind: 'string' },
    },
  },
  getCustomTool: {
    method: 'GET',
    path: '/api/v2/custom-tools/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Get Custom Tool',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  getFile: {
    method: 'GET',
    path: '/api/v2/files/[fileId]/metadata',
    pathParams: ['fileId'] as const,
    responseMode: 'json',
    summary: 'Get File Metadata',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  getFileShare: {
    method: 'GET',
    path: '/api/v2/files/[fileId]/share',
    pathParams: ['fileId'] as const,
    responseMode: 'json',
    summary: 'Get File Share',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  getKnowledgeBase: {
    method: 'GET',
    path: '/api/v2/knowledge/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Get Knowledge Base',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  getKnowledgeDocument: {
    method: 'GET',
    path: '/api/v2/knowledge/[id]/documents/[documentId]',
    pathParams: ['id', 'documentId'] as const,
    responseMode: 'json',
    summary: 'Get Document',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  getLog: {
    method: 'GET',
    path: '/api/v2/logs/[runId]',
    pathParams: ['runId'] as const,
    responseMode: 'json',
    summary: 'Get Log',
  },
  getMcpServer: {
    method: 'GET',
    path: '/api/v2/mcp-servers/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Get MCP Server',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  getSkill: {
    method: 'GET',
    path: '/api/v2/skills/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Get Skill',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  getTable: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Get Table',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  getTableExport: {
    method: 'GET',
    path: '/api/v2/tables/exports/[exportId]',
    pathParams: ['exportId'] as const,
    responseMode: 'json',
    summary: 'Get Table Export',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  getTableImport: {
    method: 'GET',
    path: '/api/v2/tables/imports/[importId]',
    pathParams: ['importId'] as const,
    responseMode: 'json',
    summary: 'Get Table Import',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  getTableRow: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/rows/[rowId]',
    pathParams: ['tableId', 'rowId'] as const,
    responseMode: 'json',
    summary: 'Get Row',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  getTableView: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/views/[viewId]',
    pathParams: ['tableId', 'viewId'] as const,
    responseMode: 'json',
    summary: 'Get View',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  getWorkflow: {
    method: 'GET',
    path: '/api/v2/workflows/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Get Workflow',
  },
  getWorkflowDeployment: {
    method: 'GET',
    path: '/api/v2/workflows/[id]/deployment',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Get Workflow Deployment',
  },
  getWorkflowRun: {
    method: 'GET',
    path: '/api/v2/workflows/[id]/runs/[runId]',
    pathParams: ['id', 'runId'] as const,
    responseMode: 'json',
    summary: 'Get Workflow Run',
    query: {
      includeOutput: { kind: 'boolean' },
      selectedOutputs: { kind: 'string' },
    },
  },
  getWorkflowVersion: {
    method: 'GET',
    path: '/api/v2/workflows/[id]/versions/[version]',
    pathParams: ['id', 'version'] as const,
    responseMode: 'json',
    summary: 'Get Workflow Version',
  },
  getWorkspace: {
    method: 'GET',
    path: '/api/v2/workspaces/[workspaceId]',
    pathParams: ['workspaceId'] as const,
    responseMode: 'json',
    summary: 'Get Workspace',
  },
  importWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/import',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Import Workflow',
    body: {
      workspaceId: { kind: 'string', required: true },
      workflow: { kind: 'unknown', required: true },
      folderPath: { kind: 'string' },
      name: { kind: 'string' },
      description: { kind: 'string' },
    },
  },
  listAuditLogs: {
    method: 'GET',
    path: '/api/v2/audit-logs',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Audit Logs',
    query: {
      action: { kind: 'string' },
      resourceType: { kind: 'string' },
      resourceId: { kind: 'string' },
      workspaceId: { kind: 'string' },
      startDate: { kind: 'string' },
      endDate: { kind: 'string' },
      includeDeparted: { kind: 'boolean' },
      limit: { kind: 'integer', default: 50 },
      cursor: { kind: 'string' },
      organizationId: { kind: 'string', required: true },
      actorEmail: { kind: 'string' },
    },
  },
  listBillingLogs: {
    method: 'GET',
    path: '/api/v2/billing/logs',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Billing Logs',
    query: {
      source: {
        kind: 'enum',
        values: [
          'workflow',
          'wand',
          'sim-chat',
          'mcp_copilot',
          'mothership_block',
          'knowledge-base',
          'voice-input',
          'enrichment',
          'voice-output',
        ] as const,
      },
      workspaceId: { kind: 'string' },
      period: {
        kind: 'enum',
        values: ['1d', '7d', '30d', 'all', 'custom'] as const,
        default: '30d',
      },
      startDate: { kind: 'string' },
      endDate: { kind: 'string' },
      limit: { kind: 'integer', default: 50 },
      cursor: { kind: 'string' },
    },
  },
  listCredentials: {
    method: 'GET',
    path: '/api/v2/credentials',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Credentials',
    query: {
      workspaceId: { kind: 'string', required: true },
      type: { kind: 'enum', values: ['oauth', 'service_account'] as const },
      providerId: { kind: 'string' },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['displayName', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'desc' },
      limit: { kind: 'integer', default: 50 },
      cursor: { kind: 'string' },
    },
  },
  listCustomTools: {
    method: 'GET',
    path: '/api/v2/custom-tools',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Custom Tools',
    query: {
      workspaceId: { kind: 'string', required: true },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['title', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'desc' },
      limit: { kind: 'integer', default: 50 },
      cursor: { kind: 'string' },
    },
  },
  listFileFolders: {
    method: 'GET',
    path: '/api/v2/files/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Folders',
    query: {
      workspaceId: { kind: 'string', required: true },
      parentPath: { kind: 'string' },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'name',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'asc' },
    },
  },
  listFiles: {
    method: 'GET',
    path: '/api/v2/files',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Files',
    query: {
      workspaceId: { kind: 'string', required: true },
      folderPath: { kind: 'string' },
      scope: { kind: 'enum', values: ['active', 'archived'] as const, default: 'active' },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['name', 'size', 'uploadedAt', 'updatedAt'] as const,
        default: 'uploadedAt',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'asc' },
      limit: { kind: 'integer', default: 100 },
      cursor: { kind: 'string' },
    },
  },
  listKnowledgeBases: {
    method: 'GET',
    path: '/api/v2/knowledge',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Knowledge Bases',
    query: {
      workspaceId: { kind: 'string', required: true },
      folderPath: { kind: 'string' },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'asc' },
      limit: { kind: 'integer', default: 50 },
      cursor: { kind: 'string' },
    },
  },
  listKnowledgeDocuments: {
    method: 'GET',
    path: '/api/v2/knowledge/[id]/documents',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'List Documents',
    query: {
      workspaceId: { kind: 'string', required: true },
      limit: { kind: 'integer', default: 50 },
      search: { kind: 'string' },
      enabledFilter: {
        kind: 'enum',
        values: ['all', 'enabled', 'disabled'] as const,
        default: 'all',
      },
      sortBy: {
        kind: 'enum',
        values: [
          'filename',
          'fileSize',
          'tokenCount',
          'chunkCount',
          'uploadedAt',
          'processingStatus',
          'enabled',
        ] as const,
        default: 'uploadedAt',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'desc' },
      cursor: { kind: 'string' },
      tagFilters: { kind: 'string' },
    },
  },
  listKnowledgeFolders: {
    method: 'GET',
    path: '/api/v2/knowledge/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Folders',
    query: {
      workspaceId: { kind: 'string', required: true },
      parentPath: { kind: 'string' },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'name',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'asc' },
    },
  },
  listKnowledgeTags: {
    method: 'GET',
    path: '/api/v2/knowledge/[id]/tags',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'List Tags',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  listLogs: {
    method: 'GET',
    path: '/api/v2/logs',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Logs',
    query: {
      workspaceId: { kind: 'string', required: true },
      workflowIds: { kind: 'string' },
      triggers: { kind: 'string' },
      level: { kind: 'enum', values: ['info', 'error'] as const },
      startDate: { kind: 'string' },
      endDate: { kind: 'string' },
      minDurationMs: { kind: 'integer' },
      maxDurationMs: { kind: 'integer' },
      minCost: { kind: 'number' },
      maxCost: { kind: 'number' },
      model: { kind: 'string' },
      details: { kind: 'enum', values: ['basic', 'full'] as const, default: 'basic' },
      includeTraceSpans: { kind: 'boolean' },
      includeFinalOutput: { kind: 'boolean' },
      limit: { kind: 'integer', default: 100 },
      cursor: { kind: 'string' },
      order: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'desc' },
      runId: { kind: 'string' },
      folderPaths: { kind: 'string' },
    },
  },
  listMcpServers: {
    method: 'GET',
    path: '/api/v2/mcp-servers',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List MCP Servers',
    query: {
      workspaceId: { kind: 'string', required: true },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'desc' },
      limit: { kind: 'integer', default: 50 },
      cursor: { kind: 'string' },
    },
  },
  listMcpServerTools: {
    method: 'GET',
    path: '/api/v2/mcp-servers/[id]/tools',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'List MCP Server Tools',
    query: {
      workspaceId: { kind: 'string', required: true },
      refresh: { kind: 'boolean' },
    },
  },
  listSecrets: {
    method: 'GET',
    path: '/api/v2/secrets',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Secrets',
    query: {
      workspaceId: { kind: 'string', required: true },
      scope: { kind: 'enum', values: ['workspace', 'personal'] as const },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'name',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'asc' },
      limit: { kind: 'integer', default: 50 },
      cursor: { kind: 'string' },
    },
  },
  listSkills: {
    method: 'GET',
    path: '/api/v2/skills',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Skills',
    query: {
      workspaceId: { kind: 'string', required: true },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'desc' },
      limit: { kind: 'integer', default: 50 },
      cursor: { kind: 'string' },
    },
  },
  listTableFolders: {
    method: 'GET',
    path: '/api/v2/tables/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Folders',
    query: {
      workspaceId: { kind: 'string', required: true },
      parentPath: { kind: 'string' },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'name',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'asc' },
    },
  },
  listTableRows: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/rows',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'List Rows',
    query: {
      workspaceId: { kind: 'string', required: true },
      limit: { kind: 'integer', default: 100 },
      cursor: { kind: 'string' },
    },
  },
  listTables: {
    method: 'GET',
    path: '/api/v2/tables',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Tables',
    query: {
      workspaceId: { kind: 'string', required: true },
      folderPath: { kind: 'string' },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'asc' },
      limit: { kind: 'integer', default: 100 },
      cursor: { kind: 'string' },
    },
  },
  listTableViews: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/views',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'List Views',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  listWorkflowFolders: {
    method: 'GET',
    path: '/api/v2/workflows/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Workflow Folders',
    query: {
      workspaceId: { kind: 'string', required: true },
      parentPath: { kind: 'string' },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'name',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'asc' },
    },
  },
  listWorkflowGroups: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/groups',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'List Workflow Groups',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  listWorkflowRuns: {
    method: 'GET',
    path: '/api/v2/workflows/[id]/runs',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'List Workflow Runs',
    query: {
      status: {
        kind: 'enum',
        values: ['pending', 'running', 'completed', 'failed', 'cancelled', 'paused'] as const,
      },
      trigger: { kind: 'string' },
      startDate: { kind: 'string' },
      endDate: { kind: 'string' },
      limit: { kind: 'integer', default: 50 },
      cursor: { kind: 'string' },
      order: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'desc' },
    },
  },
  listWorkflows: {
    method: 'GET',
    path: '/api/v2/workflows',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Workflows',
    query: {
      workspaceId: { kind: 'string', required: true },
      folderPath: { kind: 'string' },
      deployedOnly: { kind: 'boolean' },
      limit: { kind: 'integer', default: 50 },
      cursor: { kind: 'string' },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['position', 'name', 'createdAt', 'updatedAt', 'runCount'] as const,
        default: 'position',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'asc' },
    },
  },
  listWorkflowVersions: {
    method: 'GET',
    path: '/api/v2/workflows/[id]/versions',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'List Workflow Versions',
    query: {
      limit: { kind: 'integer', default: 50 },
      cursor: { kind: 'string' },
    },
  },
  listWorkspaceMembers: {
    method: 'GET',
    path: '/api/v2/workspaces/[workspaceId]/members',
    pathParams: ['workspaceId'] as const,
    responseMode: 'json',
    summary: 'List Workspace Members',
    query: {
      limit: { kind: 'integer', default: 50 },
      cursor: { kind: 'string' },
    },
  },
  moveFileItems: {
    method: 'POST',
    path: '/api/v2/files/move',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Move Files',
    body: {
      workspaceId: { kind: 'string', required: true },
      fileIds: { kind: 'array', required: true },
      targetFolderPath: { kind: 'string' },
    },
  },
  queryRows: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/query',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Query Rows',
    body: {
      workspaceId: { kind: 'string', required: true },
      predicate: { kind: 'unknown' },
      sort: { kind: 'array' },
      limit: { kind: 'integer' },
      cursor: { kind: 'string' },
    },
  },
  queryRowsCount: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/query/count',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Count Rows',
    body: {
      workspaceId: { kind: 'string', required: true },
      predicate: { kind: 'unknown' },
    },
  },
  relocateFileFolder: {
    method: 'PATCH',
    path: '/api/v2/files/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Rename or Move Folder',
    body: {
      workspaceId: { kind: 'string', required: true },
      path: { kind: 'string', required: true },
      destinationPath: { kind: 'string', required: true },
    },
  },
  relocateKnowledgeFolder: {
    method: 'PATCH',
    path: '/api/v2/knowledge/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Rename or Move Folder',
    body: {
      workspaceId: { kind: 'string', required: true },
      path: { kind: 'string', required: true },
      destinationPath: { kind: 'string', required: true },
    },
  },
  relocateTableFolder: {
    method: 'PATCH',
    path: '/api/v2/tables/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Rename or Move Folder',
    body: {
      workspaceId: { kind: 'string', required: true },
      path: { kind: 'string', required: true },
      destinationPath: { kind: 'string', required: true },
    },
  },
  relocateWorkflowFolder: {
    method: 'PATCH',
    path: '/api/v2/workflows/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Rename or Move Workflow Folder',
    body: {
      workspaceId: { kind: 'string', required: true },
      path: { kind: 'string', required: true },
      destinationPath: { kind: 'string', required: true },
    },
  },
  renameFile: {
    method: 'PATCH',
    path: '/api/v2/files/[fileId]',
    pathParams: ['fileId'] as const,
    responseMode: 'json',
    summary: 'Rename File',
    body: {
      workspaceId: { kind: 'string', required: true },
      name: { kind: 'string', required: true },
    },
  },
  restoreFile: {
    method: 'POST',
    path: '/api/v2/files/[fileId]/restore',
    pathParams: ['fileId'] as const,
    responseMode: 'json',
    summary: 'Restore File',
    body: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  resumeWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[id]/runs/[runId]/resume',
    pathParams: ['id', 'runId'] as const,
    responseMode: 'json',
    summary: 'Resume Workflow Run',
    body: {
      contextId: { kind: 'string', required: true },
      input: { kind: 'unknown' },
    },
  },
  rollbackWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[id]/rollback',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Rollback Workflow',
    body: {
      version: { kind: 'integer' },
    },
  },
  runRowEnrichment: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]',
    pathParams: ['tableId', 'rowId', 'groupId'] as const,
    responseMode: 'json',
    summary: 'Run Enrichment For One Row',
    body: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  runTableColumn: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/columns/run',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Run Column Groups',
    body: {
      workspaceId: { kind: 'string', required: true },
      groupIds: { kind: 'array', required: true },
      runMode: { kind: 'enum', values: ['all', 'incomplete'] as const, default: 'all' },
      rowIds: { kind: 'array' },
      filter: { kind: 'unknown' },
      excludeRowIds: { kind: 'array' },
      limit: { kind: 'object' },
    },
  },
  searchKnowledge: {
    method: 'POST',
    path: '/api/v2/knowledge/search',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Search Knowledge',
    body: {
      workspaceId: { kind: 'string', required: true },
      knowledgeBaseIds: { kind: 'unknown', required: true },
      query: { kind: 'string' },
      topK: { kind: 'number', default: 10 },
      tagFilters: { kind: 'array' },
      searchMode: { kind: 'enum', default: 'vector' },
      rerankerEnabled: { kind: 'boolean' },
      rerankerModel: {
        kind: 'enum',
        values: ['rerank-v4.0-pro', 'rerank-v4.0-fast', 'rerank-v3.5'] as const,
        default: 'rerank-v4.0-fast',
      },
      rerankerInputCount: { kind: 'integer' },
    },
  },
  setSecret: {
    method: 'PUT',
    path: '/api/v2/secrets/[name]',
    pathParams: ['name'] as const,
    responseMode: 'json',
    summary: 'Set Secret',
    body: {
      workspaceId: { kind: 'string', required: true },
      scope: { kind: 'enum', required: true, values: ['workspace', 'personal'] as const },
      value: { kind: 'string', required: true },
    },
  },
  tableExportDownload: {
    method: 'GET',
    path: '/api/v2/tables/exports/[exportId]/download',
    pathParams: ['exportId'] as const,
    responseMode: 'json',
    summary: 'Download Table Export',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  undeployWorkflow: {
    method: 'DELETE',
    path: '/api/v2/workflows/[id]/deploy',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Undeploy Workflow',
  },
  updateCustomTool: {
    method: 'PATCH',
    path: '/api/v2/custom-tools/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Update Custom Tool',
    body: {
      workspaceId: { kind: 'string', required: true },
      title: { kind: 'string' },
      schema: { kind: 'object' },
      code: { kind: 'string' },
    },
  },
  updateFileContent: {
    method: 'PUT',
    path: '/api/v2/files/[fileId]/content',
    pathParams: ['fileId'] as const,
    responseMode: 'json',
    summary: 'Replace File Content',
    body: {
      workspaceId: { kind: 'string', required: true },
      content: { kind: 'string', required: true },
      encoding: { kind: 'enum', values: ['utf-8', 'base64'] as const, default: 'utf-8' },
    },
  },
  updateKnowledgeBase: {
    method: 'PATCH',
    path: '/api/v2/knowledge/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Update Knowledge Base',
    body: {
      workspaceId: { kind: 'string', required: true },
      name: { kind: 'string' },
      description: { kind: 'string' },
      chunkingConfig: { kind: 'object' },
      folderPath: { kind: 'string' },
    },
  },
  updateKnowledgeDocument: {
    method: 'PATCH',
    path: '/api/v2/knowledge/[id]/documents/[documentId]',
    pathParams: ['id', 'documentId'] as const,
    responseMode: 'json',
    summary: 'Update Document',
    body: {
      workspaceId: { kind: 'string', required: true },
      filename: { kind: 'string' },
      enabled: { kind: 'boolean' },
      tag1: { kind: 'string' },
      tag2: { kind: 'string' },
      tag3: { kind: 'string' },
      tag4: { kind: 'string' },
      tag5: { kind: 'string' },
      tag6: { kind: 'string' },
      tag7: { kind: 'string' },
      number1: { kind: 'number' },
      number2: { kind: 'number' },
      number3: { kind: 'number' },
      number4: { kind: 'number' },
      number5: { kind: 'number' },
      date1: { kind: 'string' },
      date2: { kind: 'string' },
      boolean1: { kind: 'boolean' },
      boolean2: { kind: 'boolean' },
      boolean3: { kind: 'boolean' },
      retryProcessing: { kind: 'boolean' },
    },
  },
  updateMcpServer: {
    method: 'PATCH',
    path: '/api/v2/mcp-servers/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Update MCP Server',
    body: {
      workspaceId: { kind: 'string', required: true },
      name: { kind: 'string' },
      description: { kind: 'string' },
      transport: { kind: 'enum', values: ['streamable-http'] as const, default: 'streamable-http' },
      url: { kind: 'string' },
      authType: { kind: 'enum', values: ['none', 'headers', 'oauth'] as const },
      headers: { kind: 'object' },
      timeout: { kind: 'integer', default: 30000 },
      retries: { kind: 'integer', default: 3 },
      enabled: { kind: 'boolean', default: true },
      oauthClientId: { kind: 'string' },
      oauthClientSecret: { kind: 'string' },
    },
  },
  updateRowsByFilter: {
    method: 'PATCH',
    path: '/api/v2/tables/[tableId]/rows',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Update Rows by Filter',
    body: {
      workspaceId: { kind: 'string', required: true },
      filter: { kind: 'unknown', required: true },
      data: { kind: 'object', required: true },
      limit: { kind: 'integer' },
    },
  },
  updateSkill: {
    method: 'PATCH',
    path: '/api/v2/skills/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Update Skill',
    body: {
      workspaceId: { kind: 'string', required: true },
      name: { kind: 'string' },
      description: { kind: 'string' },
      content: { kind: 'string' },
    },
  },
  updateTable: {
    method: 'PATCH',
    path: '/api/v2/tables/[tableId]',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Update Table',
    body: {
      workspaceId: { kind: 'string', required: true },
      name: { kind: 'string' },
      description: { kind: 'string' },
      folderPath: { kind: 'string' },
    },
  },
  updateTableColumn: {
    method: 'PATCH',
    path: '/api/v2/tables/[tableId]/columns',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Update Column',
    body: {
      workspaceId: { kind: 'string', required: true },
      columnName: { kind: 'string', required: true },
      updates: { kind: 'object', required: true },
    },
  },
  updateTableRow: {
    method: 'PATCH',
    path: '/api/v2/tables/[tableId]/rows/[rowId]',
    pathParams: ['tableId', 'rowId'] as const,
    responseMode: 'json',
    summary: 'Update Row',
    body: {
      workspaceId: { kind: 'string', required: true },
      data: { kind: 'object', required: true },
    },
  },
  updateTableView: {
    method: 'PATCH',
    path: '/api/v2/tables/[tableId]/views/[viewId]',
    pathParams: ['tableId', 'viewId'] as const,
    responseMode: 'json',
    summary: 'Update View',
    body: {
      workspaceId: { kind: 'string', required: true },
      name: { kind: 'string' },
      config: { kind: 'object' },
      configPatch: { kind: 'object' },
      isDefault: { kind: 'boolean' },
    },
  },
  updateWorkflow: {
    method: 'PATCH',
    path: '/api/v2/workflows/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Update Workflow',
    body: {
      name: { kind: 'string' },
      description: { kind: 'string' },
      folderPath: { kind: 'string' },
    },
  },
  updateWorkflowGroup: {
    method: 'PATCH',
    path: '/api/v2/tables/[tableId]/groups',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Update Workflow Group',
    body: {
      workspaceId: { kind: 'string', required: true },
      groupId: { kind: 'string', required: true },
      workflowId: { kind: 'string' },
      name: { kind: 'string' },
      dependencies: { kind: 'object' },
      outputs: { kind: 'array' },
      newOutputColumns: { kind: 'array' },
      mappingUpdates: { kind: 'array' },
      inputMappings: { kind: 'array' },
      deploymentMode: { kind: 'enum', values: ['live', 'deployed'] as const },
      type: { kind: 'enum', values: ['manual', 'enrichment'] as const },
      autoRun: { kind: 'boolean' },
    },
  },
  uploadKnowledgeDocument: {
    method: 'POST',
    path: '/api/v2/knowledge/[id]/documents',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Upload Document',
    query: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  upsertFileShare: {
    method: 'PATCH',
    path: '/api/v2/files/[fileId]/share',
    pathParams: ['fileId'] as const,
    responseMode: 'json',
    summary: 'Enable or Disable File Share',
    body: {
      workspaceId: { kind: 'string', required: true },
      isActive: { kind: 'boolean', required: true },
      authType: { kind: 'enum', values: ['public', 'password', 'email', 'sso'] as const },
      password: { kind: 'string' },
      allowedEmails: { kind: 'array' },
    },
  },
  upsertTableRow: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/rows/upsert',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Upsert Row',
    body: {
      workspaceId: { kind: 'string', required: true },
      data: { kind: 'object', required: true },
      conflictTarget: { kind: 'string' },
    },
  },
} as const

export type V2OperationName = keyof typeof V2_OPERATIONS
