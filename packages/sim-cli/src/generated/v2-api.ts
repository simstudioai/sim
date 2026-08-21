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
    | 'already_cancelled'
    | 'already_completed'
    | 'already_failed'
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

/** `POST /api/v2/credentials/connections` */
export type CreateCredentialConnectionQuery = Record<string, unknown>

export type CreateCredentialConnectionBody =
  | {
      workspaceId: string
      providerId: string
      displayName: string
    }
  | {
      workspaceId: string
      credentialId: string
    }

type CreateCredentialConnectionResponseRef0 = {
  authorizationUrl: string
  expiresAt: string
}

export type CreateCredentialConnectionResponse = {
  data: CreateCredentialConnectionResponseRef0
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

/** `POST /api/v2/knowledge/[id]/connectors` */
export type CreateKnowledgeConnectorParams = {
  id: string
}

export type CreateKnowledgeConnectorQuery = Record<string, unknown>

export type CreateKnowledgeConnectorBody = {
  workspaceId: string
  connectorType: string
  credentialId?: string
  apiKey?: string
  sourceConfig: Record<string, unknown>
  syncIntervalMinutes?: number
}

type CreateKnowledgeConnectorResponseRef0 = {
  id: string
  knowledgeBaseId: string
  connectorType: string
  credentialId: string | null
  sourceConfig: Record<string, unknown>
  syncMode: string
  syncIntervalMinutes: number
  status: 'active' | 'paused' | 'syncing' | 'error' | 'disabled'
  lastSyncAt: string | null
  lastSyncError: string | null
  lastSyncDocCount: number | null
  nextSyncAt: string | null
  consecutiveFailures: number
  createdAt: string
  updatedAt: string
}

export type CreateKnowledgeConnectorResponse = {
  data: CreateKnowledgeConnectorResponseRef0
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

/** `POST /api/v2/credentials` */
export type CreateServiceAccountCredentialQuery = Record<string, unknown>

export type CreateServiceAccountCredentialBody = {
  workspaceId: string
  type: 'service_account'
  providerId: string
  displayName?: string
  description?: string
  id?: string
  credentials: string
}

type CreateServiceAccountCredentialResponseRef0 = {
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

export type CreateServiceAccountCredentialResponse = {
  data: CreateServiceAccountCredentialResponseRef0
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

/** `DELETE /api/v2/credentials/[credentialId]` */
export type DeleteCredentialParams = {
  credentialId: string
}

export type DeleteCredentialQuery = {
  workspaceId: string
}

type DeleteCredentialResponseRef0 = {
  id: string
  deleted: true
}

export type DeleteCredentialResponse = {
  data: DeleteCredentialResponseRef0
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

/** `DELETE /api/v2/knowledge/[id]/connectors/[connectorId]` */
export type DeleteKnowledgeConnectorParams = {
  id: string
  connectorId: string
}

export type DeleteKnowledgeConnectorQuery = {
  workspaceId: string
  deleteDocuments?: boolean
}

type DeleteKnowledgeConnectorResponseRef0 = {
  id: string
  deleted: true
  documentsDeleted: number
  documentsKept: number
}

export type DeleteKnowledgeConnectorResponse = {
  data: DeleteKnowledgeConnectorResponseRef0
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
  scope?: 'active' | 'archived'
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

/** `GET /api/v2/knowledge/[id]/connectors/[connectorId]` */
export type GetKnowledgeConnectorParams = {
  id: string
  connectorId: string
}

export type GetKnowledgeConnectorQuery = {
  workspaceId: string
}

type GetKnowledgeConnectorResponseRef0 = {
  id: string
  connectorId: string
  status: string
  startedAt: string
  completedAt: string | null
  docsAdded: number
  docsUpdated: number
  docsDeleted: number
  docsUnchanged: number
  docsFailed: number
  errorMessage: string | null
}

type GetKnowledgeConnectorResponseRef1 = {
  id: string
  knowledgeBaseId: string
  connectorType: string
  credentialId: string | null
  sourceConfig: Record<string, unknown>
  syncMode: string
  syncIntervalMinutes: number
  status: 'active' | 'paused' | 'syncing' | 'error' | 'disabled'
  lastSyncAt: string | null
  lastSyncError: string | null
  lastSyncDocCount: number | null
  nextSyncAt: string | null
  consecutiveFailures: number
  createdAt: string
  updatedAt: string
  syncLogs: Array<GetKnowledgeConnectorResponseRef0>
}

export type GetKnowledgeConnectorResponse = {
  data: GetKnowledgeConnectorResponseRef1
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

/** `POST /api/v2/skills/[id]/editors` */
export type GrantSkillEditorParams = {
  id: string
}

export type GrantSkillEditorQuery = Record<string, unknown>

export type GrantSkillEditorBody = {
  workspaceId: string
  email: string
}

type GrantSkillEditorResponseRef0 = {
  email: string
  name: string | null
  image: string | null
  isWorkspaceAdmin: boolean
}

export type GrantSkillEditorResponse = {
  data: GrantSkillEditorResponseRef0
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

/** `GET /api/v2/credentials/providers` */
export type ListCredentialProvidersQuery = {
  workspaceId: string
  search?: string
}

type ListCredentialProvidersResponseRef0 =
  | {
      type: 'oauth'
      serviceId: string
      name: string
      description: string
      providerFamily: string
      available: boolean
      supportsReconnect: boolean
      authorizationOptions: Array<{
        providerId: string
        label: string
      }>
    }
  | {
      type: 'service_account'
      serviceId: string
      name: string
      description: string
      providerFamily: string
      available: boolean
      providerId: string
      docsUrl: string
      helpText?: string
      requiresClientGeneratedCredentialId: boolean
      fields: Array<{
        id: string
        label: string
        placeholder: string
        required: boolean
        secret: boolean
        multiline: boolean
        requiredForAuthMethods?: Array<string>
        options?: Array<{
          value: string
          label: string
        }>
        hint?: string
      }>
    }

export type ListCredentialProvidersResponse = {
  data: Array<ListCredentialProvidersResponseRef0>
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

/** `GET /api/v2/knowledge/[id]/connectors/[connectorId]/documents` */
export type ListKnowledgeConnectorDocumentsParams = {
  id: string
  connectorId: string
}

export type ListKnowledgeConnectorDocumentsQuery = {
  workspaceId: string
  includeExcluded?: boolean
  limit?: number
  cursor?: string
}

type ListKnowledgeConnectorDocumentsResponseRef0 = {
  id: string
  filename: string
  externalId: string | null
  sourceUrl: string | null
  enabled: boolean
  userExcluded: boolean
  createdAt: string
  processingStatus: string
}

export type ListKnowledgeConnectorDocumentsResponse = {
  data: Array<ListKnowledgeConnectorDocumentsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/knowledge/[id]/connectors` */
export type ListKnowledgeConnectorsParams = {
  id: string
}

export type ListKnowledgeConnectorsQuery = {
  workspaceId: string
  sortBy?: 'connectorType' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListKnowledgeConnectorsResponseRef0 = {
  id: string
  knowledgeBaseId: string
  connectorType: string
  credentialId: string | null
  sourceConfig: Record<string, unknown>
  syncMode: string
  syncIntervalMinutes: number
  status: 'active' | 'paused' | 'syncing' | 'error' | 'disabled'
  lastSyncAt: string | null
  lastSyncError: string | null
  lastSyncDocCount: number | null
  nextSyncAt: string | null
  consecutiveFailures: number
  createdAt: string
  updatedAt: string
}

export type ListKnowledgeConnectorsResponse = {
  data: Array<ListKnowledgeConnectorsResponseRef0>
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
  description: string | null
  role: 'admin' | 'member'
  createdAt: string
  updatedAt: string
}

export type ListSecretsResponse = {
  data: Array<ListSecretsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/skills/[id]/editors` */
export type ListSkillEditorsParams = {
  id: string
}

export type ListSkillEditorsQuery = {
  workspaceId: string
  sortBy?: 'email' | 'name'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListSkillEditorsResponseRef0 = {
  email: string
  name: string | null
  image: string | null
  isWorkspaceAdmin: boolean
}

export type ListSkillEditorsResponse = {
  data: Array<ListSkillEditorsResponseRef0>
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

/** `GET /api/v2/workspaces` */
export type ListWorkspacesQuery = {
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListWorkspacesResponseRef0 = {
  id: string
  name: string
  color: string
  logoUrl: string | null
  memberCount: number
  createdAt: string
  updatedAt: string
}

export type ListWorkspacesResponse = {
  data: Array<ListWorkspacesResponseRef0>
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

/** `DELETE /api/v2/skills/[id]/editors` */
export type RevokeSkillEditorParams = {
  id: string
}

export type RevokeSkillEditorQuery = {
  workspaceId: string
  email: string
}

type RevokeSkillEditorResponseRef0 = {
  email: string
  revoked: true
}

export type RevokeSkillEditorResponse = {
  data: RevokeSkillEditorResponseRef0
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
  description?: string | null
}

type SetSecretResponseRef0 = {
  name: string
  scope: 'workspace' | 'personal'
  description: string | null
  role: 'admin' | 'member'
  createdAt: string
  updatedAt: string
}

export type SetSecretResponse = {
  data: SetSecretResponseRef0
}

/** `POST /api/v2/knowledge/[id]/connectors/[connectorId]/sync` */
export type SyncKnowledgeConnectorParams = {
  id: string
  connectorId: string
}

export type SyncKnowledgeConnectorQuery = Record<string, unknown>

export type SyncKnowledgeConnectorBody = {
  workspaceId: string
  rehydrate?: boolean
}

type SyncKnowledgeConnectorResponseRef0 = {
  id: string
  syncTriggered: true
}

export type SyncKnowledgeConnectorResponse = {
  data: SyncKnowledgeConnectorResponseRef0
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

/** `PATCH /api/v2/knowledge/[id]/connectors/[connectorId]` */
export type UpdateKnowledgeConnectorParams = {
  id: string
  connectorId: string
}

export type UpdateKnowledgeConnectorQuery = Record<string, unknown>

export type UpdateKnowledgeConnectorBody = {
  workspaceId: string
  sourceConfig?: Record<string, unknown>
  syncIntervalMinutes?: number
  status?: 'active' | 'paused'
}

type UpdateKnowledgeConnectorResponseRef0 = {
  id: string
  knowledgeBaseId: string
  connectorType: string
  credentialId: string | null
  sourceConfig: Record<string, unknown>
  syncMode: string
  syncIntervalMinutes: number
  status: 'active' | 'paused' | 'syncing' | 'error' | 'disabled'
  lastSyncAt: string | null
  lastSyncError: string | null
  lastSyncDocCount: number | null
  nextSyncAt: string | null
  consecutiveFailures: number
  createdAt: string
  updatedAt: string
}

export type UpdateKnowledgeConnectorResponse = {
  data: UpdateKnowledgeConnectorResponseRef0
}

/** `PATCH /api/v2/knowledge/[id]/connectors/[connectorId]/documents` */
export type UpdateKnowledgeConnectorDocumentsParams = {
  id: string
  connectorId: string
}

export type UpdateKnowledgeConnectorDocumentsQuery = Record<string, unknown>

export type UpdateKnowledgeConnectorDocumentsBody = {
  workspaceId: string
  operation: 'restore' | 'exclude'
  documentIds: Array<string>
}

type UpdateKnowledgeConnectorDocumentsResponseRef0 = {
  operation: 'restore' | 'exclude'
  updatedCount: number
  documentIds: Array<string>
}

export type UpdateKnowledgeConnectorDocumentsResponse = {
  data: UpdateKnowledgeConnectorDocumentsResponseRef0
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
    pathParamDocs: { uploadId: 'Upload session identifier.' },
    responseMode: 'json',
    summary: 'Abort File Upload',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the upload session.',
      },
    },
  },
  abortKnowledgeDocumentUpload: {
    method: 'DELETE',
    path: '/api/v2/knowledge/[id]/documents/uploads/[uploadId]',
    pathParams: ['id', 'uploadId'] as const,
    pathParamDocs: {
      id: 'Unique knowledge base identifier.',
      uploadId: 'Upload session identifier returned when the upload was created.',
    },
    responseMode: 'json',
    summary: 'Abort Document Upload',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
    },
  },
  addTableColumn: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/columns',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Add Column',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the table.' },
      column: { kind: 'object', required: true, describe: 'Column definition to add.' },
    },
  },
  addWorkflowGroup: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/groups',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Add Workflow Group',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      group: {
        kind: 'object',
        required: true,
        describe: 'Workflow or enrichment producer definition.',
      },
      outputColumns: {
        kind: 'array',
        required: true,
        describe: 'Columns created for producer outputs.',
      },
      autoRun: {
        kind: 'boolean',
        default: false,
        describe: 'Whether to schedule existing rows after group creation.',
      },
    },
  },
  bulkDeleteFiles: {
    method: 'POST',
    path: '/api/v2/files/bulk-delete',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Delete Files',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace containing the files.' },
      fileIds: { kind: 'array', required: true, describe: 'File identifiers to update.' },
    },
  },
  bulkUpdateKnowledgeDocuments: {
    method: 'PATCH',
    path: '/api/v2/knowledge/[id]/documents',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'Bulk Enable or Disable Documents',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      operation: {
        kind: 'enum',
        required: true,
        values: ['enable', 'disable'] as const,
        describe: 'Whether the selected documents become enabled or disabled for search.',
      },
      documentIds: { kind: 'array', describe: 'Documents to update, by identifier.' },
      selectAll: {
        kind: 'boolean',
        describe:
          'Update every document in the knowledge base instead of an explicit list, narrowed by `enabledFilter`.',
      },
      enabledFilter: {
        kind: 'enum',
        values: ['all', 'enabled', 'disabled'] as const,
        describe: 'With `selectAll`, restrict the update to documents in this state.',
      },
    },
  },
  cancelTableExport: {
    method: 'DELETE',
    path: '/api/v2/tables/exports/[exportId]',
    pathParams: ['exportId'] as const,
    pathParamDocs: { exportId: 'Unique table-export identifier.' },
    responseMode: 'json',
    summary: 'Cancel Table Export',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the transfer resource.',
      },
    },
  },
  cancelTableImport: {
    method: 'DELETE',
    path: '/api/v2/tables/imports/[importId]',
    pathParams: ['importId'] as const,
    pathParamDocs: { importId: 'Unique table-import identifier.' },
    responseMode: 'json',
    summary: 'Cancel Table Import',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the transfer resource.',
      },
    },
  },
  cancelTableRuns: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/cancel-runs',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Cancel Column Runs',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      scope: {
        kind: 'enum',
        required: true,
        values: ['all', 'row'] as const,
        describe: 'Whether to cancel across the table or one row.',
      },
      rowId: { kind: 'string', describe: 'Row whose runs should be canceled for row scope.' },
      filter: {
        kind: 'unknown',
        describe:
          'Recursive predicate tree. Each group node is exactly one non-empty `all` or `any` array whose members are further groups or `{ field, op, value }` conditions; the root must be a group, not a bare condition. At most 100 members per group, 10 levels of nesting, and 500 nodes in total. The negating operators include nulls: `ne`, `nin`, `ncontains`, `nlike`, and `nilike` match rows whose column is null or absent, so "not X" is not the complement of "X" over a nullable column. That holds for every column type, multi-select included. To exclude nulls, `all`-combine the negation with `isNotEmpty` (multi-select) or `isNotNull`. Comparison: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`. Membership: `in`, `nin` (array operand). Emptiness: `isEmpty`, `isNotEmpty`, `isNull`, `isNotNull` (no operand). Substring, always case-insensitive, operand matched literally: `contains`, `ncontains`, `startsWith`, `endsWith`. Pattern: `like`/`nlike` (case-sensitive), `ilike`/`nilike` (case-insensitive). **`*` is the only wildcard** and stands for any run of characters; `%`, `_`, and backslash match themselves. Use `like: "Hi*"`, not `like: "Hi%"`. A `select` column compares by option id and restricts its operators: single-select accepts `eq`, `ne`, `in`, `nin`; multi-select accepts `contains`, `ncontains`. Option names are accepted as operands and resolved to ids.',
      },
      excludeRowIds: { kind: 'array', describe: 'Rows excluded from an all-scope cancellation.' },
    },
  },
  cancelWorkflowRun: {
    method: 'POST',
    path: '/api/v2/workflows/[id]/runs/[runId]/cancel',
    pathParams: ['id', 'runId'] as const,
    pathParamDocs: { id: 'Unique workflow identifier.', runId: 'Unique workflow run identifier.' },
    responseMode: 'json',
    summary: 'Cancel Workflow Run',
  },
  completeFileUpload: {
    method: 'POST',
    path: '/api/v2/files/uploads/[uploadId]/complete',
    pathParams: ['uploadId'] as const,
    pathParamDocs: { uploadId: 'Upload session identifier.' },
    responseMode: 'json',
    summary: 'Complete File Upload',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the upload session.',
      },
    },
  },
  completeKnowledgeDocumentUpload: {
    method: 'POST',
    path: '/api/v2/knowledge/[id]/documents/uploads/[uploadId]/complete',
    pathParams: ['id', 'uploadId'] as const,
    pathParamDocs: {
      id: 'Unique knowledge base identifier.',
      uploadId: 'Upload session identifier returned when the upload was created.',
    },
    responseMode: 'json',
    summary: 'Complete Document Upload',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
    },
  },
  completeTableImport: {
    method: 'POST',
    path: '/api/v2/tables/imports/[importId]/complete',
    pathParams: ['importId'] as const,
    pathParamDocs: { importId: 'Unique table-import identifier.' },
    responseMode: 'json',
    summary: 'Complete Table Import Upload',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the transfer resource.',
      },
    },
  },
  createCredentialConnection: {
    method: 'POST',
    path: '/api/v2/credentials/connections',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Credential Connection',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that will own the credential.',
      },
    },
    opaqueBody: true,
  },
  createCustomTool: {
    method: 'POST',
    path: '/api/v2/custom-tools',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Custom Tool',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace in which to create the custom tool.',
      },
      title: {
        kind: 'string',
        required: true,
        describe: 'Display title, unique within the workspace.',
      },
      schema: {
        kind: 'object',
        required: true,
        describe: 'OpenAI-style function declaration describing the callable tool surface.',
      },
      code: {
        kind: 'string',
        required: true,
        describe: 'Tool implementation executed in the sandboxed function runtime.',
      },
    },
  },
  createFile: {
    method: 'POST',
    path: '/api/v2/files',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create File',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace in which to create the file.',
      },
      name: {
        kind: 'string',
        required: true,
        describe:
          'File name, including its extension. Path separators and dot segments are rejected.',
      },
      contentType: {
        kind: 'string',
        describe: 'MIME type. When omitted, it is inferred from the file extension.',
      },
      folderPath: {
        kind: 'string',
        describe: 'Canonical containing-folder path. Omit for the workspace root.',
      },
      content: {
        kind: 'string',
        default: '',
        describe:
          'Initial file content. Omit or send an empty string for a zero-byte file. The 70,000,000-character bound guards the JSON envelope; the decoded bytes must be at most 50 MiB, and a longer base64 payload is rejected with `413`. Use an upload session for anything larger.',
      },
      encoding: {
        kind: 'enum',
        values: ['utf-8', 'base64'] as const,
        default: 'utf-8',
        describe: 'Encoding of the content field.',
      },
    },
  },
  createFileFolder: {
    method: 'POST',
    path: '/api/v2/files/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Folder',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace in which to create the folder.',
      },
      path: { kind: 'string', required: true, describe: 'Path of the folder to create.' },
    },
  },
  createFileUpload: {
    method: 'POST',
    path: '/api/v2/files/uploads',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create File Upload',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace in which the file will be registered.',
      },
      name: { kind: 'string', required: true, describe: 'File name, including its extension.' },
      contentType: { kind: 'string', required: true, describe: 'MIME type of the uploaded file.' },
      size: { kind: 'integer', required: true, describe: 'Exact file size in bytes.' },
      folderPath: {
        kind: 'string',
        describe: 'Canonical destination folder path. Omit for the workspace root.',
      },
    },
  },
  createFileUploadPartUrls: {
    method: 'POST',
    path: '/api/v2/files/uploads/[uploadId]/parts',
    pathParams: ['uploadId'] as const,
    pathParamDocs: { uploadId: 'Upload session identifier.' },
    responseMode: 'json',
    summary: 'Create File Upload Part URLs',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the upload session.',
      },
    },
    body: {
      partNumbers: {
        kind: 'array',
        required: true,
        describe: 'Multipart part numbers for which signed URLs should be created.',
      },
    },
  },
  createKnowledgeBase: {
    method: 'POST',
    path: '/api/v2/knowledge',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Knowledge Base',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace in which to create the knowledge base.',
      },
      name: { kind: 'string', required: true, describe: 'Human-readable knowledge base name.' },
      description: { kind: 'string', describe: 'Optional knowledge base description.' },
      chunkingConfig: {
        kind: 'object',
        describe: 'Chunking configuration; defaults are applied when omitted.',
      },
      folderPath: {
        kind: 'string',
        describe: 'Containing folder path; omission creates the knowledge base at the root.',
      },
    },
  },
  createKnowledgeConnector: {
    method: 'POST',
    path: '/api/v2/knowledge/[id]/connectors',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'Create Knowledge Connector',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      connectorType: { kind: 'string', required: true, describe: 'Registered connector type.' },
      credentialId: {
        kind: 'string',
        describe: 'OAuth credential identifier for connectors that require OAuth.',
      },
      apiKey: {
        kind: 'string',
        describe: 'Write-only API key for connectors that use API-key authentication.',
      },
      sourceConfig: {
        kind: 'object',
        required: true,
        describe: 'Connector-specific source selection and filtering configuration.',
      },
      syncIntervalMinutes: {
        kind: 'integer',
        default: 1440,
        describe: 'Scheduled synchronization interval in minutes; zero disables scheduling.',
      },
    },
  },
  createKnowledgeDocumentUpload: {
    method: 'POST',
    path: '/api/v2/knowledge/[id]/documents/uploads',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'Create Document Upload',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      name: {
        kind: 'string',
        required: true,
        describe: 'Filename recorded on the knowledge document.',
      },
      contentType: {
        kind: 'string',
        required: true,
        describe: 'Supported MIME type for the document.',
      },
      size: { kind: 'integer', required: true, describe: 'Exact file size in bytes.' },
      tag1: { kind: 'string', describe: 'Value for tag slot 1.' },
      tag2: { kind: 'string', describe: 'Value for tag slot 2.' },
      tag3: { kind: 'string', describe: 'Value for tag slot 3.' },
      tag4: { kind: 'string', describe: 'Value for tag slot 4.' },
      tag5: { kind: 'string', describe: 'Value for tag slot 5.' },
      tag6: { kind: 'string', describe: 'Value for tag slot 6.' },
      tag7: { kind: 'string', describe: 'Value for tag slot 7.' },
      processingOptions: { kind: 'object', describe: 'Optional processing recipe and language.' },
    },
  },
  createKnowledgeDocumentUploadPartUrls: {
    method: 'POST',
    path: '/api/v2/knowledge/[id]/documents/uploads/[uploadId]/parts',
    pathParams: ['id', 'uploadId'] as const,
    pathParamDocs: {
      id: 'Unique knowledge base identifier.',
      uploadId: 'Upload session identifier returned when the upload was created.',
    },
    responseMode: 'json',
    summary: 'Create Document Upload Part URLs',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
    },
    body: {
      partNumbers: {
        kind: 'array',
        required: true,
        describe: 'Multipart part numbers for which signed URLs should be created.',
      },
    },
  },
  createKnowledgeFolder: {
    method: 'POST',
    path: '/api/v2/knowledge/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Folder',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace in which to create the folder.',
      },
      path: { kind: 'string', required: true, describe: 'Path of the folder to create.' },
    },
  },
  createMcpServer: {
    method: 'POST',
    path: '/api/v2/mcp-servers',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create MCP Server',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace in which to register the server.',
      },
      name: { kind: 'string', required: true, describe: 'Server display name.' },
      description: { kind: 'string', describe: 'Optional server description.' },
      transport: {
        kind: 'enum',
        values: ['streamable-http'] as const,
        default: 'streamable-http',
        describe:
          'Transport used to communicate with the server. Applied server-side as `streamable-http` when omitted on create.',
      },
      url: {
        kind: 'string',
        required: true,
        describe:
          'Absolute HTTP or HTTPS endpoint URL without `{{ENV_VAR}}` references. It determines server identity and is immutable: delete and recreate the server to change endpoints.',
      },
      authType: {
        kind: 'enum',
        values: ['none', 'headers', 'oauth'] as const,
        describe:
          'Authentication method. When omitted, and no `headers` are sent, registration probes the endpoint once to classify it, falling back to `headers` when the probe fails or the server does not advertise OAuth. A server publishing RFC 9728 metadata is therefore stored as `oauth`, and headers configured afterwards will not authenticate — send this field explicitly to pin the method.',
      },
      headers: {
        kind: 'object',
        describe:
          'Write-only request headers sent to the server. Replaced wholesale rather than merged on update: sending this field drops every stored header it does not repeat.',
      },
      timeout: {
        kind: 'integer',
        default: 30000,
        describe:
          'Per-request timeout in milliseconds. Applied server-side as 30000 when omitted on create.',
      },
      retries: {
        kind: 'integer',
        default: 3,
        describe: 'Number of retries per request. Applied server-side as 3 when omitted on create.',
      },
      enabled: {
        kind: 'boolean',
        default: true,
        describe:
          'Whether the server tools are available to workflows. Applied server-side as true when omitted on create.',
      },
      oauthClientId: {
        kind: 'string',
        describe:
          'Pre-registered OAuth client identifier. Changing it on update revokes the stored OAuth grant and forces reauthorization.',
      },
      oauthClientSecret: {
        kind: 'string',
        describe:
          'Write-only pre-registered OAuth client secret. Sending it on update as null or a new value revokes the stored OAuth grant and forces reauthorization, as does switching away from OAuth authentication.',
      },
    },
  },
  createServiceAccountCredential: {
    method: 'POST',
    path: '/api/v2/credentials',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Service-Account Credential',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that will own the credential.',
      },
      type: {
        kind: 'string',
        required: true,
        describe: 'Service-account credential discriminator.',
      },
      providerId: {
        kind: 'string',
        required: true,
        describe: 'Exact service-account provider ID returned by provider discovery.',
      },
      displayName: {
        kind: 'string',
        describe: 'Optional name; providers may derive one from the verified account identity.',
      },
      description: { kind: 'string', describe: 'Optional credential description.' },
      id: {
        kind: 'string',
        describe: 'Required only when provider discovery requests a client-generated ID.',
      },
      credentials: {
        kind: 'string',
        required: true,
        describe:
          'Write-only JSON object string containing the fields declared by credential-provider discovery.',
      },
    },
  },
  createSkill: {
    method: 'POST',
    path: '/api/v2/skills',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Skill',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace in which to create the skill.',
      },
      name: {
        kind: 'string',
        required: true,
        describe:
          'Kebab-case name, unique within the workspace and not reserved by a built-in skill.',
      },
      description: {
        kind: 'string',
        required: true,
        describe: 'One-line summary of when the skill applies.',
      },
      content: {
        kind: 'string',
        required: true,
        describe: 'Skill body containing the instructions given to the agent.',
      },
    },
  },
  createTable: {
    method: 'POST',
    path: '/api/v2/tables',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Table',
    body: {
      name: { kind: 'string', required: true, describe: 'Table name.' },
      description: { kind: 'string', describe: 'Optional table description.' },
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      schema: { kind: 'object', required: true, describe: 'Initial table column definitions.' },
      folderPath: { kind: 'string', describe: 'Folder in which to create the table.' },
    },
  },
  createTableExport: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/exports',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Create Table Export',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      format: {
        kind: 'enum',
        values: ['csv', 'json'] as const,
        default: 'csv',
        describe: 'Export file format.',
      },
    },
  },
  createTableFolder: {
    method: 'POST',
    path: '/api/v2/tables/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Folder',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace in which to create the folder.',
      },
      path: { kind: 'string', required: true, describe: 'Path of the folder to create.' },
    },
  },
  createTableImport: {
    method: 'POST',
    path: '/api/v2/tables/imports',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Table Import',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      source: { kind: 'unknown', required: true, describe: 'CSV source for the import.' },
      target: { kind: 'unknown', required: true, describe: 'New or existing table import target.' },
      mapping: { kind: 'object', describe: 'CSV headers mapped to existing table columns.' },
      createColumns: {
        kind: 'array',
        describe: 'CSV headers for which new columns should be created.',
      },
      timezone: { kind: 'string', describe: 'IANA timezone used to interpret local date values.' },
    },
  },
  createTableImportPartUrls: {
    method: 'POST',
    path: '/api/v2/tables/imports/[importId]/parts',
    pathParams: ['importId'] as const,
    pathParamDocs: { importId: 'Unique table-import identifier.' },
    responseMode: 'json',
    summary: 'Create Table Import Part URLs',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the transfer resource.',
      },
    },
    body: {
      partNumbers: {
        kind: 'array',
        required: true,
        describe: 'Multipart part numbers for which signed URLs should be created.',
      },
    },
  },
  createTableRows: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/rows',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Create Rows',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
    },
    opaqueBody: true,
  },
  createTableView: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/views',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Create View',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the table.' },
      name: { kind: 'string', required: true, describe: 'Saved-view display name.' },
      config: {
        kind: 'object',
        required: true,
        describe: 'Saved filter, sort, and column-layout configuration.',
      },
    },
  },
  createWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Workflow',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace in which to create the workflow.',
      },
      name: { kind: 'string', required: true, describe: 'Workflow name.' },
      description: { kind: 'string', describe: 'Optional workflow description.' },
      folderPath: {
        kind: 'string',
        describe:
          'Folder path. A missing leading slash is normalized before validation. Segments are percent-encoded, so a folder shown as "New folder" is `/New%20folder`: everything outside `A-Z a-z 0-9 - _ . ~` is escaped as uppercase hex, and only that exact encoding is accepted. A trailing slash, an empty segment, and a literal `.` or `..` segment are rejected. At most 64 segments and 4096 encoded bytes.',
      },
    },
  },
  createWorkflowFolder: {
    method: 'POST',
    path: '/api/v2/workflows/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Workflow Folder',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace in which to create the folder.',
      },
      path: { kind: 'string', required: true, describe: 'Path of the folder to create.' },
    },
  },
  deleteCredential: {
    method: 'DELETE',
    path: '/api/v2/credentials/[credentialId]',
    pathParams: ['credentialId'] as const,
    pathParamDocs: { credentialId: 'Credential to disconnect.' },
    responseMode: 'json',
    summary: 'Disconnect Credential',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace expected to own the credential.',
      },
    },
  },
  deleteCustomTool: {
    method: 'DELETE',
    path: '/api/v2/custom-tools/[id]',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique custom tool identifier.' },
    responseMode: 'json',
    summary: 'Delete Custom Tool',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the custom tool.',
      },
    },
  },
  deleteFile: {
    method: 'DELETE',
    path: '/api/v2/files/[fileId]',
    pathParams: ['fileId'] as const,
    pathParamDocs: { fileId: 'File identifier.' },
    responseMode: 'json',
    summary: 'Delete File',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the file.' },
    },
  },
  deleteFileFolder: {
    method: 'DELETE',
    path: '/api/v2/files/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Delete Folder',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace containing the folder.' },
      path: { kind: 'string', required: true, describe: 'Path of the folder to delete.' },
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
        describe:
          "Delete the folder's nested files and folders too. An empty folder deletes either way; a non-empty one needs this. The listed spellings are the whole accepted vocabulary and are case-sensitive; any other value is rejected.",
      },
    },
  },
  deleteKnowledgeBase: {
    method: 'DELETE',
    path: '/api/v2/knowledge/[id]',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'Delete Knowledge Base',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
    },
  },
  deleteKnowledgeConnector: {
    method: 'DELETE',
    path: '/api/v2/knowledge/[id]/connectors/[connectorId]',
    pathParams: ['id', 'connectorId'] as const,
    pathParamDocs: {
      id: 'Knowledge base that owns the connector.',
      connectorId: 'Connector selected for the operation.',
    },
    responseMode: 'json',
    summary: 'Delete Knowledge Connector',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      deleteDocuments: {
        kind: 'boolean',
        describe: 'Also permanently delete documents produced by this connector.',
      },
    },
  },
  deleteKnowledgeDocument: {
    method: 'DELETE',
    path: '/api/v2/knowledge/[id]/documents/[documentId]',
    pathParams: ['id', 'documentId'] as const,
    pathParamDocs: {
      id: 'Unique knowledge base identifier.',
      documentId: 'Unique knowledge document identifier.',
    },
    responseMode: 'json',
    summary: 'Delete Document',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
    },
  },
  deleteKnowledgeFolder: {
    method: 'DELETE',
    path: '/api/v2/knowledge/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Delete Folder',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace containing the folder.' },
      path: { kind: 'string', required: true, describe: 'Path of the folder to delete.' },
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
        describe:
          "Delete the folder's nested files and folders too. An empty folder deletes either way; a non-empty one needs this. The listed spellings are the whole accepted vocabulary and are case-sensitive; any other value is rejected.",
      },
    },
  },
  deleteMcpServer: {
    method: 'DELETE',
    path: '/api/v2/mcp-servers/[id]',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique MCP server identifier.' },
    responseMode: 'json',
    summary: 'Delete MCP Server',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the MCP server.',
      },
    },
  },
  deleteSecret: {
    method: 'DELETE',
    path: '/api/v2/secrets/[name]',
    pathParams: ['name'] as const,
    pathParamDocs: { name: 'Secret to create, replace, or delete.' },
    responseMode: 'json',
    summary: 'Delete Secret',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe:
          'Workspace the request is authorized against. A workspace secret is deleted from it; a personal secret is deleted for the caller in all of their workspaces.',
      },
      scope: {
        kind: 'enum',
        required: true,
        values: ['workspace', 'personal'] as const,
        describe:
          'Whether the secret belongs to the workspace or to the caller. A personal secret belongs to the caller across every workspace, not to one workspace.',
      },
    },
  },
  deleteSkill: {
    method: 'DELETE',
    path: '/api/v2/skills/[id]',
    pathParams: ['id'] as const,
    pathParamDocs: {
      id: 'Unique skill identifier. A built-in skill is `builtin-` followed by its name, for example `builtin-research`.',
    },
    responseMode: 'json',
    summary: 'Delete Skill',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the skill.' },
    },
  },
  deleteTable: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Delete Table',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the table.' },
    },
  },
  deleteTableColumn: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]/columns',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Delete Column',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      columnName: { kind: 'string', required: true, describe: 'Name of the column to delete.' },
    },
  },
  deleteTableFolder: {
    method: 'DELETE',
    path: '/api/v2/tables/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Delete Folder',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace containing the folder.' },
      path: { kind: 'string', required: true, describe: 'Path of the folder to delete.' },
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
        describe:
          "Delete the folder's nested files and folders too. An empty folder deletes either way; a non-empty one needs this. The listed spellings are the whole accepted vocabulary and are case-sensitive; any other value is rejected.",
      },
    },
  },
  deleteTableRow: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]/rows/[rowId]',
    pathParams: ['tableId', 'rowId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.', rowId: 'Unique table row identifier.' },
    responseMode: 'json',
    summary: 'Delete Row',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the table.' },
    },
  },
  deleteTableRows: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]/rows',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Delete Rows',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      filter: {
        kind: 'unknown',
        describe:
          'Recursive predicate tree. Each group node is exactly one non-empty `all` or `any` array whose members are further groups or `{ field, op, value }` conditions; the root must be a group, not a bare condition. At most 100 members per group, 10 levels of nesting, and 500 nodes in total. The negating operators include nulls: `ne`, `nin`, `ncontains`, `nlike`, and `nilike` match rows whose column is null or absent, so "not X" is not the complement of "X" over a nullable column. That holds for every column type, multi-select included. To exclude nulls, `all`-combine the negation with `isNotEmpty` (multi-select) or `isNotNull`. Comparison: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`. Membership: `in`, `nin` (array operand). Emptiness: `isEmpty`, `isNotEmpty`, `isNull`, `isNotNull` (no operand). Substring, always case-insensitive, operand matched literally: `contains`, `ncontains`, `startsWith`, `endsWith`. Pattern: `like`/`nlike` (case-sensitive), `ilike`/`nilike` (case-insensitive). **`*` is the only wildcard** and stands for any run of characters; `%`, `_`, and backslash match themselves. Use `like: "Hi*"`, not `like: "Hi%"`. A `select` column compares by option id and restricts its operators: single-select accepts `eq`, `ne`, `in`, `nin`; multi-select accepts `contains`, `ncontains`. Option names are accepted as operands and resolved to ids.',
      },
      limit: { kind: 'integer', describe: 'Maximum matching rows to delete.' },
      rowIds: { kind: 'array', describe: 'Explicit row identifiers to delete.' },
    },
  },
  deleteTableView: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]/views/[viewId]',
    pathParams: ['tableId', 'viewId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.', viewId: 'Unique saved-view identifier.' },
    responseMode: 'json',
    summary: 'Delete View',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the table.' },
    },
  },
  deleteWorkflow: {
    method: 'DELETE',
    path: '/api/v2/workflows/[id]',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique workflow identifier.' },
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
      workspaceId: { kind: 'string', required: true, describe: 'Workspace containing the folder.' },
      path: { kind: 'string', required: true, describe: 'Path of the folder to delete.' },
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
        describe:
          "Delete the folder's nested files and folders too. An empty folder deletes either way; a non-empty one needs this. The listed spellings are the whole accepted vocabulary and are case-sensitive; any other value is rejected.",
      },
    },
  },
  deleteWorkflowGroup: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]/groups',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Delete Workflow Group',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      groupId: { kind: 'string', required: true, describe: 'Workflow group to delete.' },
    },
  },
  deployWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[id]/deploy',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Deploy Workflow',
    body: {
      name: { kind: 'string', describe: 'Optional label for the deployment version.' },
      description: {
        kind: 'string',
        describe: 'Optional release note for the deployment version.',
      },
    },
  },
  downloadFile: {
    method: 'GET',
    path: '/api/v2/files/[fileId]',
    pathParams: ['fileId'] as const,
    pathParamDocs: { fileId: 'File identifier.' },
    responseMode: 'binary',
    summary: 'Download File',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the file.' },
    },
  },
  executeWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[id]/execute',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Execute Workflow',
    body: {
      input: {
        kind: 'object',
        describe: 'Workflow input keyed by deployed trigger input-field name.',
      },
      async: {
        kind: 'boolean',
        default: false,
        describe:
          'Queue the run and return a 202 receipt when true. Requires an API key, cannot be combined with `stream`, and rejects all streaming and output-shaping options (`selectedOutputs`, `includeThinking`, `includeToolCalls`, `includeFileBase64`, `base64MaxBytes`).',
      },
      executionTimeoutSeconds: {
        kind: 'integer',
        describe:
          "Requested server-side timeout for an asynchronous run, in seconds. An upper bound, not the effective timeout: the run uses the smaller of this value and the plan's execution timeout, so requesting more than the plan allows silently yields the plan timeout. Rejected with `400` unless `async` is true.",
      },
      stream: {
        kind: 'boolean',
        default: false,
        describe:
          'Return Server-Sent Events instead of JSON when true. Cannot be combined with `async`.',
      },
      selectedOutputs: {
        kind: 'array',
        describe:
          'Block output references to include in a streamed response. Rejected when `async` is true.',
      },
      includeThinking: {
        kind: 'boolean',
        default: false,
        describe:
          'Include model reasoning events in an agent-event stream. Requires `stream: true` and the `X-Sim-Stream-Protocol: agent-events-v1` request header, and is rejected when `async` is true.',
      },
      includeToolCalls: {
        kind: 'boolean',
        default: false,
        describe:
          'Include tool-call events in an agent-event stream. Requires `stream: true` and the `X-Sim-Stream-Protocol: agent-events-v1` request header, and is rejected when `async` is true.',
      },
      includeFileBase64: {
        kind: 'boolean',
        describe: 'Inline eligible output files as base64 content. Rejected when `async` is true.',
      },
      base64MaxBytes: {
        kind: 'integer',
        describe:
          'Maximum total bytes of file content to inline as base64. Rejected when `async` is true.',
      },
    },
  },
  exportWorkflow: {
    method: 'GET',
    path: '/api/v2/workflows/[id]/export',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Export Workflow',
  },
  findTableRows: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/rows/find',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Find Rows',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      q: { kind: 'string', required: true, describe: 'Case-insensitive cell substring to find.' },
      predicate: {
        kind: 'unknown',
        describe:
          'Recursive predicate tree. Each group node is exactly one non-empty `all` or `any` array whose members are further groups or `{ field, op, value }` conditions; the root must be a group, not a bare condition. At most 100 members per group, 10 levels of nesting, and 500 nodes in total. The negating operators include nulls: `ne`, `nin`, `ncontains`, `nlike`, and `nilike` match rows whose column is null or absent, so "not X" is not the complement of "X" over a nullable column. That holds for every column type, multi-select included. To exclude nulls, `all`-combine the negation with `isNotEmpty` (multi-select) or `isNotNull`. Comparison: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`. Membership: `in`, `nin` (array operand). Emptiness: `isEmpty`, `isNotEmpty`, `isNull`, `isNotNull` (no operand). Substring, always case-insensitive, operand matched literally: `contains`, `ncontains`, `startsWith`, `endsWith`. Pattern: `like`/`nlike` (case-sensitive), `ilike`/`nilike` (case-insensitive). **`*` is the only wildcard** and stands for any run of characters; `%`, `_`, and backslash match themselves. Use `like: "Hi*"`, not `like: "Hi%"`. A `select` column compares by option id and restricts its operators: single-select accepts `eq`, `ne`, `in`, `nin`; multi-select accepts `contains`, `ncontains`. Option names are accepted as operands and resolved to ids.',
      },
      sort: { kind: 'array', describe: 'Ordered table-row sort specification.' },
    },
  },
  getAuditLog: {
    method: 'GET',
    path: '/api/v2/audit-logs/[id]',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Audit-log entry identifier.' },
    responseMode: 'json',
    summary: 'Get Audit Log',
    query: {
      organizationId: {
        kind: 'string',
        required: true,
        describe: 'Organization whose audit-log entry should be returned.',
      },
    },
  },
  getBillingStatus: {
    method: 'GET',
    path: '/api/v2/billing/status',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Get Billing Status',
    query: {
      workspaceId: {
        kind: 'string',
        describe:
          'Workspace whose payer should be resolved. Workspace API keys are pinned to their own workspace.',
      },
    },
  },
  getCustomTool: {
    method: 'GET',
    path: '/api/v2/custom-tools/[id]',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique custom tool identifier.' },
    responseMode: 'json',
    summary: 'Get Custom Tool',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the custom tool.',
      },
    },
  },
  getFile: {
    method: 'GET',
    path: '/api/v2/files/[fileId]/metadata',
    pathParams: ['fileId'] as const,
    pathParamDocs: { fileId: 'File identifier.' },
    responseMode: 'json',
    summary: 'Get File Metadata',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the file.' },
      scope: {
        kind: 'enum',
        values: ['active', 'archived'] as const,
        default: 'active',
        describe:
          'Which lifecycle set to read from: `active` (default) resolves live files only and returns `404` for a file a `DELETE` soft-deleted; `archived` also resolves soft-deleted files, so metadata stays readable before `POST /files/{fileId}/restore`. Authorization is identical for both.',
      },
    },
  },
  getFileShare: {
    method: 'GET',
    path: '/api/v2/files/[fileId]/share',
    pathParams: ['fileId'] as const,
    pathParamDocs: { fileId: 'File identifier.' },
    responseMode: 'json',
    summary: 'Get File Share',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the file.' },
    },
  },
  getKnowledgeBase: {
    method: 'GET',
    path: '/api/v2/knowledge/[id]',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'Get Knowledge Base',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
    },
  },
  getKnowledgeConnector: {
    method: 'GET',
    path: '/api/v2/knowledge/[id]/connectors/[connectorId]',
    pathParams: ['id', 'connectorId'] as const,
    pathParamDocs: {
      id: 'Knowledge base that owns the connector.',
      connectorId: 'Connector selected for the operation.',
    },
    responseMode: 'json',
    summary: 'Get Knowledge Connector',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
    },
  },
  getKnowledgeDocument: {
    method: 'GET',
    path: '/api/v2/knowledge/[id]/documents/[documentId]',
    pathParams: ['id', 'documentId'] as const,
    pathParamDocs: {
      id: 'Unique knowledge base identifier.',
      documentId: 'Unique knowledge document identifier.',
    },
    responseMode: 'json',
    summary: 'Get Document',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
    },
  },
  getLog: {
    method: 'GET',
    path: '/api/v2/logs/[runId]',
    pathParams: ['runId'] as const,
    pathParamDocs: { runId: 'Unique workflow run identifier.' },
    responseMode: 'json',
    summary: 'Get Log',
  },
  getMcpServer: {
    method: 'GET',
    path: '/api/v2/mcp-servers/[id]',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique MCP server identifier.' },
    responseMode: 'json',
    summary: 'Get MCP Server',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the MCP server.',
      },
    },
  },
  getSkill: {
    method: 'GET',
    path: '/api/v2/skills/[id]',
    pathParams: ['id'] as const,
    pathParamDocs: {
      id: 'Unique skill identifier. A built-in skill is `builtin-` followed by its name, for example `builtin-research`.',
    },
    responseMode: 'json',
    summary: 'Get Skill',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the skill.' },
    },
  },
  getTable: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Get Table',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the table.' },
    },
  },
  getTableExport: {
    method: 'GET',
    path: '/api/v2/tables/exports/[exportId]',
    pathParams: ['exportId'] as const,
    pathParamDocs: { exportId: 'Unique table-export identifier.' },
    responseMode: 'json',
    summary: 'Get Table Export',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the transfer resource.',
      },
    },
  },
  getTableImport: {
    method: 'GET',
    path: '/api/v2/tables/imports/[importId]',
    pathParams: ['importId'] as const,
    pathParamDocs: { importId: 'Unique table-import identifier.' },
    responseMode: 'json',
    summary: 'Get Table Import',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the transfer resource.',
      },
    },
  },
  getTableRow: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/rows/[rowId]',
    pathParams: ['tableId', 'rowId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.', rowId: 'Unique table row identifier.' },
    responseMode: 'json',
    summary: 'Get Row',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the table.' },
    },
  },
  getTableView: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/views/[viewId]',
    pathParams: ['tableId', 'viewId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.', viewId: 'Unique saved-view identifier.' },
    responseMode: 'json',
    summary: 'Get View',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the table.' },
    },
  },
  getWorkflow: {
    method: 'GET',
    path: '/api/v2/workflows/[id]',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Get Workflow',
  },
  getWorkflowDeployment: {
    method: 'GET',
    path: '/api/v2/workflows/[id]/deployment',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Get Workflow Deployment',
  },
  getWorkflowRun: {
    method: 'GET',
    path: '/api/v2/workflows/[id]/runs/[runId]',
    pathParams: ['id', 'runId'] as const,
    pathParamDocs: { id: 'Unique workflow identifier.', runId: 'Unique workflow run identifier.' },
    responseMode: 'json',
    summary: 'Get Workflow Run',
    query: {
      includeOutput: {
        kind: 'boolean',
        describe:
          'Include the final workflow output when true. It does not gate `blockOutputs`, which `selectedOutputs` selects on its own.',
      },
      selectedOutputs: {
        kind: 'string',
        describe:
          'Comma-separated block output references to include, as `blockId` or `blockId.path`. Block *names* are not resolved here — unlike the execute request, this resource reads a recorded run and matches ids only, so a name selects nothing and yields an empty `blockOutputs`.',
      },
    },
  },
  getWorkflowVersion: {
    method: 'GET',
    path: '/api/v2/workflows/[id]/versions/[version]',
    pathParams: ['id', 'version'] as const,
    pathParamDocs: { id: 'Unique workflow identifier.', version: 'Numeric deployment version.' },
    responseMode: 'json',
    summary: 'Get Workflow Version',
  },
  getWorkspace: {
    method: 'GET',
    path: '/api/v2/workspaces/[workspaceId]',
    pathParams: ['workspaceId'] as const,
    pathParamDocs: { workspaceId: 'Workspace to retrieve.' },
    responseMode: 'json',
    summary: 'Get Workspace',
  },
  grantSkillEditor: {
    method: 'POST',
    path: '/api/v2/skills/[id]/editors',
    pathParams: ['id'] as const,
    pathParamDocs: {
      id: 'Unique skill identifier. A built-in skill is `builtin-` followed by its name, for example `builtin-research`.',
    },
    responseMode: 'json',
    summary: 'Grant Skill Editor',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the skill.' },
      email: {
        kind: 'string',
        required: true,
        describe: 'Email address of a current workspace member.',
      },
    },
  },
  importWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/import',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Import Workflow',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace in which to import the workflow.',
      },
      workflow: {
        kind: 'unknown',
        required: true,
        describe:
          'Workflow export object, bare workflow state, or JSON string containing either form.',
      },
      folderPath: {
        kind: 'string',
        describe: 'Destination folder path; omit for the workspace root.',
      },
      name: { kind: 'string', describe: 'Override for the imported workflow name.' },
      description: { kind: 'string', describe: 'Override for the imported workflow description.' },
    },
  },
  listAuditLogs: {
    method: 'GET',
    path: '/api/v2/audit-logs',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Audit Logs',
    query: {
      action: { kind: 'string', describe: 'Filter by exact action name.' },
      resourceType: {
        kind: 'string',
        describe:
          'Filter by resource type. Accepts a comma-separated set; members are trimmed and deduplicated, and member order affects neither the result nor the cursor.',
      },
      resourceId: { kind: 'string', describe: 'Filter by exact resource identifier.' },
      workspaceId: { kind: 'string', describe: 'Filter to actions in one workspace.' },
      startDate: {
        kind: 'string',
        describe:
          'Only include runs started at or after this UTC ISO 8601 timestamp, e.g. `2026-08-06T00:00:00Z`. A date without a time, or a timestamp carrying a UTC offset instead of `Z`, is rejected, as is year `0000`, which names no storable instant.',
      },
      endDate: {
        kind: 'string',
        describe:
          'Only include runs started at or before this UTC ISO 8601 timestamp, e.g. `2026-08-06T00:00:00Z`. A date without a time, or a timestamp carrying a UTC offset instead of `Z`, is rejected, as is year `0000`, which names no storable instant.',
      },
      includeDeparted: {
        kind: 'boolean',
        describe: 'Include actions by users who have left the organization.',
      },
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum audit entries to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
      organizationId: {
        kind: 'string',
        required: true,
        describe: 'Organization whose audit trail should be queried.',
      },
      actorEmail: { kind: 'string', describe: 'Filter by actor email address.' },
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
        describe: 'Restrict results to one usage source.',
      },
      workspaceId: {
        kind: 'string',
        describe: 'Restrict results to one workspace whose payer the caller can inspect.',
      },
      period: {
        kind: 'enum',
        values: ['1d', '7d', '30d', 'all', 'custom'] as const,
        default: '30d',
        describe:
          'Relative window, all history, or a custom date range. `startDate` and `endDate` are accepted only with `custom`; every other value computes its own window.',
      },
      startDate: {
        kind: 'string',
        describe:
          'Only include usage events recorded at or after this UTC ISO 8601 timestamp, e.g. `2026-08-06T00:00:00Z`. Requires `period=custom`. A date without a time, or a timestamp carrying a UTC offset instead of `Z`, is rejected, as is year `0000`, which names no storable instant.',
      },
      endDate: {
        kind: 'string',
        describe:
          'Only include usage events recorded at or before this UTC ISO 8601 timestamp, e.g. `2026-08-06T00:00:00Z`. Requires `period=custom`, and defaults to now when omitted. A date without a time, or a timestamp carrying a UTC offset instead of `Z`, is rejected, as is year `0000`, which names no storable instant.',
      },
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum usage events per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listCredentialProviders: {
    method: 'GET',
    path: '/api/v2/credentials/providers',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Credential Providers',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe:
          'Workspace used to evaluate credential-provider availability and integration policy.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the credential provider name.',
      },
    },
  },
  listCredentials: {
    method: 'GET',
    path: '/api/v2/credentials',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Credentials',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace whose credentials should be listed.',
      },
      type: {
        kind: 'enum',
        values: ['oauth', 'service_account'] as const,
        describe: 'Restrict results to this credential type.',
      },
      providerId: {
        kind: 'string',
        describe: 'Restrict results to credentials for this integration provider.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the credential display name.',
      },
      sortBy: {
        kind: 'enum',
        values: ['displayName', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
        describe: 'Field used to sort the result.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'desc',
        describe: 'Sort direction.',
      },
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum credentials to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listCustomTools: {
    method: 'GET',
    path: '/api/v2/custom-tools',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Custom Tools',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the custom tool.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the tool title.',
      },
      sortBy: {
        kind: 'enum',
        values: ['title', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
        describe: 'Field used to sort the result.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'desc',
        describe: 'Sort direction.',
      },
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum custom tools to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listFileFolders: {
    method: 'GET',
    path: '/api/v2/files/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Folders',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace whose folders should be listed.',
      },
      parentPath: {
        kind: 'string',
        describe: 'Restrict results to direct children of this parent path.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the folder name.',
      },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'name',
        describe:
          'Field used to sort the result. Sorting by `name` is case-sensitive and follows the storage collation, so do not rely on a case-insensitive order.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'asc',
        describe: 'Sort direction.',
      },
    },
  },
  listFiles: {
    method: 'GET',
    path: '/api/v2/files',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Files',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace whose files should be listed.',
      },
      folderPath: {
        kind: 'string',
        describe:
          'Restrict results to files inside this folder — its direct children, or its whole subtree when `recursive` is true. A path that names no folder narrows the result to nothing, so the response is an empty page rather than an error.',
      },
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
        describe:
          'Whether the folder filter includes files in subfolders. Defaults to true when a search is set, false otherwise, so listing a folder shows that folder while searching one looks through everything in it. Ignored when no folder filter is set, which already spans the workspace. The listed spellings are the whole accepted vocabulary and are case-sensitive; any other value is rejected.',
      },
      scope: {
        kind: 'enum',
        values: ['active', 'archived'] as const,
        default: 'active',
        describe:
          'Which lifecycle set to list: `active` (default) for live files, `archived` for files a `DELETE` soft-deleted. `folderPath` resolves against active folders only, so pairing it with `scope=archived` returns an empty page when the containing folder was archived too.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the file name.',
      },
      sortBy: {
        kind: 'enum',
        values: ['name', 'size', 'uploadedAt', 'updatedAt'] as const,
        default: 'uploadedAt',
        describe:
          'Field used to sort the result. Sorting by `name` is case-sensitive and follows the storage collation, so do not rely on a case-insensitive order.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'asc',
        describe: 'Sort direction.',
      },
      limit: {
        kind: 'integer',
        default: 100,
        describe:
          'Maximum files per page. Values outside 1–1000 are truncated and clamped into that range rather than rejected. Defaults to 100.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listKnowledgeBases: {
    method: 'GET',
    path: '/api/v2/knowledge',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Knowledge Bases',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace whose knowledge bases should be listed.',
      },
      folderPath: {
        kind: 'string',
        describe:
          'Restrict results to knowledge bases in this folder. A path that names no folder narrows the result to nothing, so the response is an empty page rather than an error.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the resource name.',
      },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
        describe:
          'Field used to sort the result. Sorting by `name` is case-sensitive and follows the storage collation, so do not rely on a case-insensitive order.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'asc',
        describe: 'Sort direction.',
      },
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum knowledge bases to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listKnowledgeConnectorDocuments: {
    method: 'GET',
    path: '/api/v2/knowledge/[id]/connectors/[connectorId]/documents',
    pathParams: ['id', 'connectorId'] as const,
    pathParamDocs: {
      id: 'Knowledge base that owns the connector.',
      connectorId: 'Connector selected for the operation.',
    },
    responseMode: 'json',
    summary: 'List Knowledge Connector Documents',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      includeExcluded: {
        kind: 'boolean',
        describe: 'Include documents explicitly excluded by a user.',
      },
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum connector documents to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listKnowledgeConnectors: {
    method: 'GET',
    path: '/api/v2/knowledge/[id]/connectors',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'List Knowledge Connectors',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      sortBy: {
        kind: 'enum',
        values: ['connectorType', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
        describe: 'Field used to sort the result.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'desc',
        describe: 'Sort direction.',
      },
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum connectors to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listKnowledgeDocuments: {
    method: 'GET',
    path: '/api/v2/knowledge/[id]/documents',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'List Documents',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum documents to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the document filename.',
      },
      enabledFilter: {
        kind: 'enum',
        values: ['all', 'enabled', 'disabled'] as const,
        default: 'all',
        describe: 'Filter by whether documents are enabled for search.',
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
        describe:
          'Field used to sort the result. Sorting by `filename` is case-sensitive and follows the storage collation, so do not rely on a case-insensitive order.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'desc',
        describe: 'Sort direction.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
      tagFilters: {
        kind: 'string',
        describe:
          'A JSON-encoded array of at most 10 tag filters, using the same display-name shape as knowledge search: `[{"tagName":"category","operator":"eq","value":"billing"}]`. Every filter must hold, including two that name the same tag. A name that is not defined in this knowledge base is rejected, never ignored.',
      },
    },
  },
  listKnowledgeFolders: {
    method: 'GET',
    path: '/api/v2/knowledge/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Folders',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace whose folders should be listed.',
      },
      parentPath: {
        kind: 'string',
        describe: 'Restrict results to direct children of this parent path.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the folder name.',
      },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'name',
        describe:
          'Field used to sort the result. Sorting by `name` is case-sensitive and follows the storage collation, so do not rely on a case-insensitive order.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'asc',
        describe: 'Sort direction.',
      },
    },
  },
  listKnowledgeTags: {
    method: 'GET',
    path: '/api/v2/knowledge/[id]/tags',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'List Tags',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
    },
  },
  listLogs: {
    method: 'GET',
    path: '/api/v2/logs',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Logs',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace whose execution logs should be returned.',
      },
      workflowIds: {
        kind: 'string',
        describe: 'Comma-separated workflow identifiers to include. An empty entry is rejected.',
      },
      triggers: {
        kind: 'string',
        describe:
          'Comma-separated trigger types to include. An empty entry is rejected. Values are matched exactly and are case-sensitive — every recorded trigger is lowercase, so `API` matches nothing while `api` matches. The vocabulary is open: it covers the core trigger types (`manual`, `api`, `schedule`, `chat`, `webhook`, `mcp`, `copilot`, `workflow`, `custom_block`) and the provider id of any webhook trigger (`slack`, `gmail`, `github`, …), so an unrecognized member is not rejected — it selects no runs. The literal value `all` is a sentinel that disables this filter entirely, so a list containing it returns runs of every trigger type; no real trigger type is named `all`.',
      },
      level: {
        kind: 'enum',
        values: ['info', 'error'] as const,
        describe: 'Severity level to include.',
      },
      startDate: {
        kind: 'string',
        describe:
          'Only include runs started at or after this UTC ISO 8601 timestamp, e.g. `2026-08-06T00:00:00Z`. A date without a time, or a timestamp carrying a UTC offset instead of `Z`, is rejected, as is year `0000`, which names no storable instant.',
      },
      endDate: {
        kind: 'string',
        describe:
          'Only include runs started at or before this UTC ISO 8601 timestamp, e.g. `2026-08-06T00:00:00Z`. A date without a time, or a timestamp carrying a UTC offset instead of `Z`, is rejected, as is year `0000`, which names no storable instant.',
      },
      minDurationMs: {
        kind: 'integer',
        describe:
          'Minimum total execution duration in milliseconds. Whole milliseconds from 0 to 2147483647; the stored duration is a 32-bit integer, so a fractional or out-of-range bound is rejected.',
      },
      maxDurationMs: {
        kind: 'integer',
        describe:
          'Maximum total execution duration in milliseconds. Whole milliseconds from 0 to 2147483647; the stored duration is a 32-bit integer, so a fractional or out-of-range bound is rejected.',
      },
      minCost: {
        kind: 'number',
        describe:
          'Minimum execution cost in USD, from 0 to 1000000. A run is never charged a negative amount, so a negative bound is rejected rather than treated as a filter that matches every run.',
      },
      maxCost: {
        kind: 'number',
        describe:
          'Maximum execution cost in USD, from 0 to 1000000. A run is never charged a negative amount, so a negative bound is rejected rather than treated as a filter that matches every run.',
      },
      model: { kind: 'string', describe: 'AI model used during execution.' },
      details: {
        kind: 'enum',
        values: ['basic', 'full'] as const,
        default: 'basic',
        describe:
          'Response detail level. `full` adds the `workflow` summary to every item. `includeTraceSpans=true` and `includeFinalOutput=true` each imply `full`, so either one adds `workflow` even when `details=basic` is sent explicitly.',
      },
      includeTraceSpans: {
        kind: 'boolean',
        describe:
          'Whether to include block-level trace spans. Implies `details=full`. Spans are pruned on their own retention schedule, so a run whose spans have aged out returns `traceSpans: []` rather than an error.',
      },
      includeFinalOutput: {
        kind: 'boolean',
        describe:
          'Whether to include the final workflow output. Implies `details=full`, so the `workflow` summary is present regardless of what `details` is set to.',
      },
      limit: {
        kind: 'integer',
        default: 100,
        describe:
          'Maximum log entries per page. Values outside 1–1000 are truncated and clamped into that range rather than rejected. Defaults to 100.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
      order: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'desc',
        describe:
          'Sort direction by execution start time. This list is sortable only by execution start time, so it takes `order` in place of `sortBy`/`sortOrder`, which it rejects.',
      },
      runId: { kind: 'string', describe: 'Exact run identifier to match.' },
      folderPaths: {
        kind: 'string',
        describe:
          'Comma-separated workflow folder paths to include. A path that names no folder narrows the result to nothing, so the response is an empty page rather than an error.',
      },
    },
  },
  listMcpServers: {
    method: 'GET',
    path: '/api/v2/mcp-servers',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List MCP Servers',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the MCP server.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the server name.',
      },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
        describe:
          'Field used to sort the result. Sorting by `name` is case-sensitive and follows the storage collation, so do not rely on a case-insensitive order.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'desc',
        describe: 'Sort direction.',
      },
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum MCP servers to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listMcpServerTools: {
    method: 'GET',
    path: '/api/v2/mcp-servers/[id]/tools',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique MCP server identifier.' },
    responseMode: 'json',
    summary: 'List MCP Server Tools',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the MCP server.',
      },
      refresh: {
        kind: 'boolean',
        describe:
          'Bypass the short-lived per-workspace tool cache and reconnect under your own credentials. A cached result reflects whichever workspace member last ran discovery, so this is the only way to pick up a tool added since then; it costs a live round trip.',
      },
    },
  },
  listSecrets: {
    method: 'GET',
    path: '/api/v2/secrets',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Secrets',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace whose secret metadata should be listed.',
      },
      scope: {
        kind: 'enum',
        values: ['workspace', 'personal'] as const,
        describe: 'Restrict results to one ownership scope.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the secret name.',
      },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'name',
        describe:
          'Field used to sort the result. Sorting by `name` is case-sensitive and follows the storage collation, so do not rely on a case-insensitive order.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'asc',
        describe: 'Sort direction.',
      },
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum secrets to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listSkillEditors: {
    method: 'GET',
    path: '/api/v2/skills/[id]/editors',
    pathParams: ['id'] as const,
    pathParamDocs: {
      id: 'Unique skill identifier. A built-in skill is `builtin-` followed by its name, for example `builtin-research`.',
    },
    responseMode: 'json',
    summary: 'List Skill Editors',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the skill.' },
      sortBy: {
        kind: 'enum',
        values: ['email', 'name'] as const,
        default: 'email',
        describe:
          'Field used to sort the result. Sorting by `name` is case-sensitive and follows the storage collation, so do not rely on a case-insensitive order.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'asc',
        describe: 'Sort direction.',
      },
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum skill editors to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listSkills: {
    method: 'GET',
    path: '/api/v2/skills',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Skills',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the skill.' },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the skill name.',
      },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
        describe:
          'Field used to sort the result. Sorting by `name` is case-sensitive and follows the storage collation, so do not rely on a case-insensitive order.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'desc',
        describe: 'Sort direction.',
      },
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum skills to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listTableFolders: {
    method: 'GET',
    path: '/api/v2/tables/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Folders',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace whose folders should be listed.',
      },
      parentPath: {
        kind: 'string',
        describe: 'Restrict results to direct children of this parent path.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the folder name.',
      },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'name',
        describe:
          'Field used to sort the result. Sorting by `name` is case-sensitive and follows the storage collation, so do not rely on a case-insensitive order.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'asc',
        describe: 'Sort direction.',
      },
    },
  },
  listTableRows: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/rows',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'List Rows',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the table.' },
      limit: {
        kind: 'integer',
        default: 100,
        describe:
          'Maximum rows to return per page. Must be a whole number from 1 to 1000. Defaults to 100.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listTables: {
    method: 'GET',
    path: '/api/v2/tables',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Tables',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace whose tables should be listed.',
      },
      folderPath: {
        kind: 'string',
        describe:
          'Restrict results to tables in this folder. A path that names no folder narrows the result to nothing, so the response is an empty page rather than an error.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the resource name.',
      },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
        describe:
          'Field used to sort the result. Sorting by `name` is case-sensitive and follows the storage collation, so do not rely on a case-insensitive order.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'asc',
        describe: 'Sort direction.',
      },
      limit: {
        kind: 'integer',
        default: 100,
        describe:
          'Maximum tables to return per page. Values outside 1–1000 are truncated and clamped into that range rather than rejected. Defaults to 100.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listTableViews: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/views',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'List Views',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the table.' },
    },
  },
  listWorkflowFolders: {
    method: 'GET',
    path: '/api/v2/workflows/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Workflow Folders',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace whose folders should be listed.',
      },
      parentPath: {
        kind: 'string',
        describe: 'Restrict results to direct children of this parent path.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the folder name.',
      },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'name',
        describe:
          'Field used to sort the result. Sorting by `name` is case-sensitive and follows the storage collation, so do not rely on a case-insensitive order.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'asc',
        describe: 'Sort direction.',
      },
    },
  },
  listWorkflowGroups: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/groups',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'List Workflow Groups',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the table.' },
    },
  },
  listWorkflowRuns: {
    method: 'GET',
    path: '/api/v2/workflows/[id]/runs',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'List Workflow Runs',
    query: {
      status: {
        kind: 'enum',
        values: ['pending', 'running', 'completed', 'failed', 'cancelled', 'paused'] as const,
        describe: 'Filter by run status.',
      },
      trigger: { kind: 'string', describe: 'Filter by trigger type.' },
      startDate: {
        kind: 'string',
        describe:
          'Only include runs started at or after this UTC ISO 8601 timestamp, e.g. `2026-08-06T00:00:00Z`. A date without a time, or a timestamp carrying a UTC offset instead of `Z`, is rejected, as is year `0000`, which names no storable instant.',
      },
      endDate: {
        kind: 'string',
        describe:
          'Only include runs started at or before this UTC ISO 8601 timestamp, e.g. `2026-08-06T00:00:00Z`. A date without a time, or a timestamp carrying a UTC offset instead of `Z`, is rejected, as is year `0000`, which names no storable instant.',
      },
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum workflow runs to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
      order: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'desc',
        describe:
          'Sort direction by run start time. This list is sortable only by run start time, so it takes `order` in place of `sortBy`/`sortOrder`, which it rejects.',
      },
    },
  },
  listWorkflows: {
    method: 'GET',
    path: '/api/v2/workflows',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Workflows',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace whose workflows should be listed.',
      },
      folderPath: {
        kind: 'string',
        describe:
          'Restrict results to workflows in this folder path. A path that names no folder narrows the result to nothing, so the response is an empty page rather than an error.',
      },
      deployedOnly: {
        kind: 'boolean',
        describe: 'Return only workflows with an active deployment when true.',
      },
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum workflows to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the resource name.',
      },
      sortBy: {
        kind: 'enum',
        values: ['position', 'name', 'createdAt', 'updatedAt', 'runCount'] as const,
        default: 'position',
        describe:
          'Field used to sort the result. Sorting by `name` is case-sensitive and follows the storage collation, so do not rely on a case-insensitive order.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'asc',
        describe: 'Sort direction.',
      },
    },
  },
  listWorkflowVersions: {
    method: 'GET',
    path: '/api/v2/workflows/[id]/versions',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'List Workflow Versions',
    query: {
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum deployment versions to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listWorkspaceMembers: {
    method: 'GET',
    path: '/api/v2/workspaces/[workspaceId]/members',
    pathParams: ['workspaceId'] as const,
    pathParamDocs: { workspaceId: 'Workspace to retrieve.' },
    responseMode: 'json',
    summary: 'List Workspace Members',
    query: {
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum members to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listWorkspaces: {
    method: 'GET',
    path: '/api/v2/workspaces',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Workspaces',
    query: {
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
        describe:
          'Field used to sort the result. Sorting by `name` is case-sensitive and follows the storage collation, so do not rely on a case-insensitive order.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'desc',
        describe: 'Sort direction.',
      },
      limit: {
        kind: 'integer',
        default: 50,
        describe:
          'Maximum workspaces to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  moveFileItems: {
    method: 'POST',
    path: '/api/v2/files/move',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Move Files',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace containing the files.' },
      fileIds: { kind: 'array', required: true, describe: 'File identifiers to update.' },
      targetFolderPath: {
        kind: 'string',
        describe: 'Destination folder path. Omit to move files to the workspace root.',
      },
    },
  },
  queryRows: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/query',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Query Rows',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      predicate: {
        kind: 'unknown',
        describe:
          'A single `{ field, op, value }` condition or a recursive `all`/`any` group; either form is normalized to a grouped predicate after validation. At most 100 members per group, 10 levels of nesting, and 500 nodes in total. The negating operators include nulls: `ne`, `nin`, `ncontains`, `nlike`, and `nilike` match rows whose column is null or absent, so "not X" is not the complement of "X" over a nullable column. That holds for every column type, multi-select included. To exclude nulls, `all`-combine the negation with `isNotEmpty` (multi-select) or `isNotNull`. Comparison: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`. Membership: `in`, `nin` (array operand). Emptiness: `isEmpty`, `isNotEmpty`, `isNull`, `isNotNull` (no operand). Substring, always case-insensitive, operand matched literally: `contains`, `ncontains`, `startsWith`, `endsWith`. Pattern: `like`/`nlike` (case-sensitive), `ilike`/`nilike` (case-insensitive). **`*` is the only wildcard** and stands for any run of characters; `%`, `_`, and backslash match themselves. Use `like: "Hi*"`, not `like: "Hi%"`. A `select` column compares by option id and restricts its operators: single-select accepts `eq`, `ne`, `in`, `nin`; multi-select accepts `contains`, `ncontains`. Option names are accepted as operands and resolved to ids.',
      },
      sort: { kind: 'array', describe: 'Ordered table-row sort specification.' },
      limit: {
        kind: 'integer',
        describe: 'Maximum rows to return; zero requests an unbounded result.',
      },
      cursor: { kind: 'string', describe: 'Opaque cursor returned by the previous query page.' },
    },
  },
  queryRowsCount: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/query/count',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Count Rows',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      predicate: {
        kind: 'unknown',
        describe:
          'A single `{ field, op, value }` condition or a recursive `all`/`any` group; either form is normalized to a grouped predicate after validation. At most 100 members per group, 10 levels of nesting, and 500 nodes in total. The negating operators include nulls: `ne`, `nin`, `ncontains`, `nlike`, and `nilike` match rows whose column is null or absent, so "not X" is not the complement of "X" over a nullable column. That holds for every column type, multi-select included. To exclude nulls, `all`-combine the negation with `isNotEmpty` (multi-select) or `isNotNull`. Comparison: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`. Membership: `in`, `nin` (array operand). Emptiness: `isEmpty`, `isNotEmpty`, `isNull`, `isNotNull` (no operand). Substring, always case-insensitive, operand matched literally: `contains`, `ncontains`, `startsWith`, `endsWith`. Pattern: `like`/`nlike` (case-sensitive), `ilike`/`nilike` (case-insensitive). **`*` is the only wildcard** and stands for any run of characters; `%`, `_`, and backslash match themselves. Use `like: "Hi*"`, not `like: "Hi%"`. A `select` column compares by option id and restricts its operators: single-select accepts `eq`, `ne`, `in`, `nin`; multi-select accepts `contains`, `ncontains`. Option names are accepted as operands and resolved to ids.',
      },
    },
  },
  relocateFileFolder: {
    method: 'PATCH',
    path: '/api/v2/files/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Rename or Move Folder',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace containing the folder.' },
      path: { kind: 'string', required: true, describe: 'Current folder path.' },
      destinationPath: {
        kind: 'string',
        required: true,
        describe: 'New full path for the folder and its descendants.',
      },
    },
  },
  relocateKnowledgeFolder: {
    method: 'PATCH',
    path: '/api/v2/knowledge/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Rename or Move Folder',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace containing the folder.' },
      path: { kind: 'string', required: true, describe: 'Current folder path.' },
      destinationPath: {
        kind: 'string',
        required: true,
        describe: 'New full path for the folder and its descendants.',
      },
    },
  },
  relocateTableFolder: {
    method: 'PATCH',
    path: '/api/v2/tables/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Rename or Move Folder',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace containing the folder.' },
      path: { kind: 'string', required: true, describe: 'Current folder path.' },
      destinationPath: {
        kind: 'string',
        required: true,
        describe: 'New full path for the folder and its descendants.',
      },
    },
  },
  relocateWorkflowFolder: {
    method: 'PATCH',
    path: '/api/v2/workflows/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Rename or Move Workflow Folder',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace containing the folder.' },
      path: { kind: 'string', required: true, describe: 'Current folder path.' },
      destinationPath: {
        kind: 'string',
        required: true,
        describe: 'New full path for the folder and its descendants.',
      },
    },
  },
  renameFile: {
    method: 'PATCH',
    path: '/api/v2/files/[fileId]',
    pathParams: ['fileId'] as const,
    pathParamDocs: { fileId: 'File identifier.' },
    responseMode: 'json',
    summary: 'Rename File',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the file.' },
      name: { kind: 'string', required: true, describe: 'New file name, including its extension.' },
    },
  },
  restoreFile: {
    method: 'POST',
    path: '/api/v2/files/[fileId]/restore',
    pathParams: ['fileId'] as const,
    pathParamDocs: { fileId: 'File identifier.' },
    responseMode: 'json',
    summary: 'Restore File',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the archived file.',
      },
    },
  },
  resumeWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[id]/runs/[runId]/resume',
    pathParams: ['id', 'runId'] as const,
    pathParamDocs: { id: 'Unique workflow identifier.', runId: 'Unique workflow run identifier.' },
    responseMode: 'json',
    summary: 'Resume Workflow Run',
    body: {
      contextId: {
        kind: 'string',
        required: true,
        describe: 'Human-in-the-loop pause-context identifier.',
      },
      input: { kind: 'unknown', describe: 'Input supplied to the paused workflow block.' },
    },
  },
  revokeSkillEditor: {
    method: 'DELETE',
    path: '/api/v2/skills/[id]/editors',
    pathParams: ['id'] as const,
    pathParamDocs: {
      id: 'Unique skill identifier. A built-in skill is `builtin-` followed by its name, for example `builtin-research`.',
    },
    responseMode: 'json',
    summary: 'Revoke Skill Editor',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the skill.' },
      email: {
        kind: 'string',
        required: true,
        describe: 'Email address of a current workspace member.',
      },
    },
  },
  rollbackWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[id]/rollback',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Rollback Workflow',
    body: {
      version: {
        kind: 'integer',
        describe: 'Deployment version to reactivate. Omit to select the previous active version.',
      },
    },
  },
  runRowEnrichment: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]',
    pathParams: ['tableId', 'rowId', 'groupId'] as const,
    pathParamDocs: {
      tableId: 'Unique table identifier.',
      rowId: 'Unique table row identifier.',
      groupId: 'Workflow or enrichment group to run.',
    },
    responseMode: 'json',
    summary: 'Run Enrichment For One Row',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
    },
  },
  runTableColumn: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/columns/run',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Run Column Groups',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      groupIds: {
        kind: 'array',
        required: true,
        describe: 'Workflow or enrichment groups to run.',
      },
      runMode: {
        kind: 'enum',
        values: ['all', 'incomplete'] as const,
        default: 'all',
        describe: 'Whether to run all or only incomplete cells.',
      },
      rowIds: { kind: 'array', describe: 'Explicit row subset to run.' },
      filter: {
        kind: 'unknown',
        describe:
          'Recursive predicate tree. Each group node is exactly one non-empty `all` or `any` array whose members are further groups or `{ field, op, value }` conditions; the root must be a group, not a bare condition. At most 100 members per group, 10 levels of nesting, and 500 nodes in total. The negating operators include nulls: `ne`, `nin`, `ncontains`, `nlike`, and `nilike` match rows whose column is null or absent, so "not X" is not the complement of "X" over a nullable column. That holds for every column type, multi-select included. To exclude nulls, `all`-combine the negation with `isNotEmpty` (multi-select) or `isNotNull`. Comparison: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`. Membership: `in`, `nin` (array operand). Emptiness: `isEmpty`, `isNotEmpty`, `isNull`, `isNotNull` (no operand). Substring, always case-insensitive, operand matched literally: `contains`, `ncontains`, `startsWith`, `endsWith`. Pattern: `like`/`nlike` (case-sensitive), `ilike`/`nilike` (case-insensitive). **`*` is the only wildcard** and stands for any run of characters; `%`, `_`, and backslash match themselves. Use `like: "Hi*"`, not `like: "Hi%"`. A `select` column compares by option id and restricts its operators: single-select accepts `eq`, `ne`, `in`, `nin`; multi-select accepts `contains`, `ncontains`. Option names are accepted as operands and resolved to ids.',
      },
      excludeRowIds: { kind: 'array', describe: 'Rows excluded from a select-all run scope.' },
      limit: { kind: 'object', describe: 'Optional cap on eligible rows to run.' },
    },
  },
  searchKnowledge: {
    method: 'POST',
    path: '/api/v2/knowledge/search',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Search Knowledge',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge bases.',
      },
      knowledgeBaseIds: {
        kind: 'unknown',
        required: true,
        describe: 'One knowledge base identifier or an array of up to 20 identifiers.',
      },
      query: {
        kind: 'string',
        describe:
          "Natural-language query; required when tag filters are omitted. At most 32768 characters — longer text exceeds the embedding model's per-input token ceiling and would be truncated before the billed search ran.",
      },
      topK: {
        kind: 'number',
        default: 10,
        describe:
          'Maximum number of search results to return. Must be a whole number between 1 and 100; the boundary schema only bounds the range, so a fractional value is admitted here and then rejected with 400 during search.',
      },
      tagFilters: {
        kind: 'array',
        describe:
          'Structured tag filters, at most 10 of them. Every filter must hold, including two that name the same tag: repeating one tag narrows the result rather than widening it, matching `GET /api/v2/knowledge/{id}/documents`. To match either of two values for one tag, issue a search per value. Each filtered tag must resolve to the same slot and field type in every knowledge base selected; one missing from any of them, or defined inconsistently across them, is rejected rather than ignored, and those knowledge bases must be searched separately. List the available names with `GET /api/v2/knowledge/{id}/tags`.',
      },
      searchMode: {
        kind: 'enum',
        default: 'vector',
        describe:
          'Retrieval strategy: vector is semantic-only, while hybrid also runs full-text search.',
      },
      rerankerEnabled: {
        kind: 'boolean',
        describe:
          'Re-order retrieved chunks with a reranking model before truncating to `topK`. Ignored for a tag-only search, and billed as an additional search unit. Reranking is best-effort — a provider failure falls back to vector ordering, so check `rerankerStatus` on the response.',
      },
      rerankerModel: {
        kind: 'enum',
        values: ['rerank-v4.0-pro', 'rerank-v4.0-fast', 'rerank-v3.5'] as const,
        default: 'rerank-v4.0-fast',
        describe:
          'Reranking model to use when `rerankerEnabled` is true. Defaults to `rerank-v4.0-fast`.',
      },
      rerankerInputCount: {
        kind: 'integer',
        describe:
          'How many candidate chunks to retrieve before reranking. Defaults to four times `topK`, capped at 100. A larger pool costs more retrieval work but gives the reranker more to choose from.',
      },
    },
  },
  setSecret: {
    method: 'PUT',
    path: '/api/v2/secrets/[name]',
    pathParams: ['name'] as const,
    pathParamDocs: { name: 'Secret to create, replace, or delete.' },
    responseMode: 'json',
    summary: 'Set Secret',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe:
          'Workspace the request is authorized against. A workspace secret is written to it; a personal secret is written to the caller and is available in all of their workspaces.',
      },
      scope: {
        kind: 'enum',
        required: true,
        values: ['workspace', 'personal'] as const,
        describe:
          'Whether the secret belongs to the workspace or to the caller. A personal secret belongs to the caller across every workspace, not to one workspace.',
      },
      value: {
        kind: 'string',
        required: true,
        describe: 'Write-only secret value. It is never returned.',
      },
      description: {
        kind: 'string',
        describe:
          'What the secret is for, shown to teammates. Workspace scope only — sending it for a personal secret is rejected. Omit it to leave an existing description untouched; send null or an empty string to clear one.',
      },
    },
  },
  syncKnowledgeConnector: {
    method: 'POST',
    path: '/api/v2/knowledge/[id]/connectors/[connectorId]/sync',
    pathParams: ['id', 'connectorId'] as const,
    pathParamDocs: {
      id: 'Knowledge base that owns the connector.',
      connectorId: 'Connector selected for the operation.',
    },
    responseMode: 'json',
    summary: 'Sync Knowledge Connector',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      rehydrate: {
        kind: 'boolean',
        default: false,
        describe: 'Re-fetch and re-index every existing connector document.',
      },
    },
  },
  tableExportDownload: {
    method: 'GET',
    path: '/api/v2/tables/exports/[exportId]/download',
    pathParams: ['exportId'] as const,
    pathParamDocs: { exportId: 'Unique table-export identifier.' },
    responseMode: 'json',
    summary: 'Download Table Export',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the transfer resource.',
      },
    },
  },
  undeployWorkflow: {
    method: 'DELETE',
    path: '/api/v2/workflows/[id]/deploy',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Undeploy Workflow',
  },
  updateCustomTool: {
    method: 'PATCH',
    path: '/api/v2/custom-tools/[id]',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique custom tool identifier.' },
    responseMode: 'json',
    summary: 'Update Custom Tool',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the custom tool.',
      },
      title: { kind: 'string', describe: 'New display title for the tool.' },
      schema: { kind: 'object', describe: 'Replacement function declaration.' },
      code: { kind: 'string', describe: 'Replacement tool implementation.' },
    },
  },
  updateFileContent: {
    method: 'PUT',
    path: '/api/v2/files/[fileId]/content',
    pathParams: ['fileId'] as const,
    pathParamDocs: { fileId: 'File identifier.' },
    responseMode: 'json',
    summary: 'Replace File Content',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the file.' },
      content: {
        kind: 'string',
        required: true,
        describe:
          'Complete replacement content for the file. The 70,000,000-character bound guards the JSON envelope; the decoded bytes must be at most 50 MiB, and a longer base64 payload is rejected with `413`.',
      },
      encoding: {
        kind: 'enum',
        values: ['utf-8', 'base64'] as const,
        default: 'utf-8',
        describe: 'Encoding of the content field.',
      },
    },
  },
  updateKnowledgeBase: {
    method: 'PATCH',
    path: '/api/v2/knowledge/[id]',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'Update Knowledge Base',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      name: { kind: 'string', describe: 'New knowledge base name.' },
      description: { kind: 'string', describe: 'New knowledge base description.' },
      chunkingConfig: { kind: 'object', describe: 'New document chunking configuration.' },
      folderPath: { kind: 'string', describe: 'New containing-folder path.' },
    },
  },
  updateKnowledgeConnector: {
    method: 'PATCH',
    path: '/api/v2/knowledge/[id]/connectors/[connectorId]',
    pathParams: ['id', 'connectorId'] as const,
    pathParamDocs: {
      id: 'Knowledge base that owns the connector.',
      connectorId: 'Connector selected for the operation.',
    },
    responseMode: 'json',
    summary: 'Update Knowledge Connector',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      sourceConfig: {
        kind: 'object',
        describe: 'Replacement source selection and filtering configuration.',
      },
      syncIntervalMinutes: {
        kind: 'integer',
        describe: 'New scheduled synchronization interval in minutes.',
      },
      status: {
        kind: 'enum',
        values: ['active', 'paused'] as const,
        describe: 'New connector state.',
      },
    },
  },
  updateKnowledgeConnectorDocuments: {
    method: 'PATCH',
    path: '/api/v2/knowledge/[id]/connectors/[connectorId]/documents',
    pathParams: ['id', 'connectorId'] as const,
    pathParamDocs: {
      id: 'Knowledge base that owns the connector.',
      connectorId: 'Connector selected for the operation.',
    },
    responseMode: 'json',
    summary: 'Update Knowledge Connector Documents',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      operation: {
        kind: 'enum',
        required: true,
        values: ['restore', 'exclude'] as const,
        describe: 'Whether to restore or exclude the selected documents.',
      },
      documentIds: {
        kind: 'array',
        required: true,
        describe: 'Connector document identifiers to update.',
      },
    },
  },
  updateKnowledgeDocument: {
    method: 'PATCH',
    path: '/api/v2/knowledge/[id]/documents/[documentId]',
    pathParams: ['id', 'documentId'] as const,
    pathParamDocs: {
      id: 'Unique knowledge base identifier.',
      documentId: 'Unique knowledge document identifier.',
    },
    responseMode: 'json',
    summary: 'Update Document',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      filename: { kind: 'string', describe: 'New filename for the document.' },
      enabled: {
        kind: 'boolean',
        describe: 'Whether the document participates in search. Disabling keeps it indexed.',
      },
      tag1: { kind: 'string', describe: 'New value for tag slot 1.' },
      tag2: { kind: 'string', describe: 'New value for tag slot 2.' },
      tag3: { kind: 'string', describe: 'New value for tag slot 3.' },
      tag4: { kind: 'string', describe: 'New value for tag slot 4.' },
      tag5: { kind: 'string', describe: 'New value for tag slot 5.' },
      tag6: { kind: 'string', describe: 'New value for tag slot 6.' },
      tag7: { kind: 'string', describe: 'New value for tag slot 7.' },
      number1: { kind: 'number', describe: 'New value for number tag slot 1.' },
      number2: { kind: 'number', describe: 'New value for number tag slot 2.' },
      number3: { kind: 'number', describe: 'New value for number tag slot 3.' },
      number4: { kind: 'number', describe: 'New value for number tag slot 4.' },
      number5: { kind: 'number', describe: 'New value for number tag slot 5.' },
      date1: { kind: 'string', describe: 'New value for date tag slot 1, formatted YYYY-MM-DD.' },
      date2: { kind: 'string', describe: 'New value for date tag slot 2, formatted YYYY-MM-DD.' },
      boolean1: { kind: 'boolean', describe: 'New value for boolean tag slot 1.' },
      boolean2: { kind: 'boolean', describe: 'New value for boolean tag slot 2.' },
      boolean3: { kind: 'boolean', describe: 'New value for boolean tag slot 3.' },
      retryProcessing: {
        kind: 'boolean',
        describe:
          'Requeue a failed or stuck document for processing. Send it alone — no other field may accompany it — and it answers with a queue acknowledgement rather than the document.',
      },
    },
  },
  updateMcpServer: {
    method: 'PATCH',
    path: '/api/v2/mcp-servers/[id]',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique MCP server identifier.' },
    responseMode: 'json',
    summary: 'Update MCP Server',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the MCP server.',
      },
      name: { kind: 'string', describe: 'Server display name.' },
      description: { kind: 'string', describe: 'Optional server description.' },
      transport: {
        kind: 'enum',
        values: ['streamable-http'] as const,
        default: 'streamable-http',
        describe:
          'Transport used to communicate with the server. Applied server-side as `streamable-http` when omitted on create.',
      },
      url: {
        kind: 'string',
        describe:
          'Immutable server URL. When provided, it must equal the current URL; use delete and create to change endpoints.',
      },
      authType: {
        kind: 'enum',
        values: ['none', 'headers', 'oauth'] as const,
        describe:
          'Authentication method. When omitted, and no `headers` are sent, registration probes the endpoint once to classify it, falling back to `headers` when the probe fails or the server does not advertise OAuth. A server publishing RFC 9728 metadata is therefore stored as `oauth`, and headers configured afterwards will not authenticate — send this field explicitly to pin the method.',
      },
      headers: {
        kind: 'object',
        describe:
          'Write-only request headers sent to the server. Replaced wholesale rather than merged on update: sending this field drops every stored header it does not repeat.',
      },
      timeout: {
        kind: 'integer',
        default: 30000,
        describe:
          'Per-request timeout in milliseconds. Applied server-side as 30000 when omitted on create.',
      },
      retries: {
        kind: 'integer',
        default: 3,
        describe: 'Number of retries per request. Applied server-side as 3 when omitted on create.',
      },
      enabled: {
        kind: 'boolean',
        default: true,
        describe:
          'Whether the server tools are available to workflows. Applied server-side as true when omitted on create.',
      },
      oauthClientId: {
        kind: 'string',
        describe:
          'Pre-registered OAuth client identifier. Changing it on update revokes the stored OAuth grant and forces reauthorization.',
      },
      oauthClientSecret: {
        kind: 'string',
        describe:
          'Write-only pre-registered OAuth client secret. Sending it on update as null or a new value revokes the stored OAuth grant and forces reauthorization, as does switching away from OAuth authentication.',
      },
    },
  },
  updateRowsByFilter: {
    method: 'PATCH',
    path: '/api/v2/tables/[tableId]/rows',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Update Rows by Filter',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      filter: {
        kind: 'unknown',
        required: true,
        describe:
          'Recursive predicate tree. Each group node is exactly one non-empty `all` or `any` array whose members are further groups or `{ field, op, value }` conditions; the root must be a group, not a bare condition. At most 100 members per group, 10 levels of nesting, and 500 nodes in total. The negating operators include nulls: `ne`, `nin`, `ncontains`, `nlike`, and `nilike` match rows whose column is null or absent, so "not X" is not the complement of "X" over a nullable column. That holds for every column type, multi-select included. To exclude nulls, `all`-combine the negation with `isNotEmpty` (multi-select) or `isNotNull`. Comparison: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`. Membership: `in`, `nin` (array operand). Emptiness: `isEmpty`, `isNotEmpty`, `isNull`, `isNotNull` (no operand). Substring, always case-insensitive, operand matched literally: `contains`, `ncontains`, `startsWith`, `endsWith`. Pattern: `like`/`nlike` (case-sensitive), `ilike`/`nilike` (case-insensitive). **`*` is the only wildcard** and stands for any run of characters; `%`, `_`, and backslash match themselves. Use `like: "Hi*"`, not `like: "Hi%"`. A `select` column compares by option id and restricts its operators: single-select accepts `eq`, `ne`, `in`, `nin`; multi-select accepts `contains`, `ncontains`. Option names are accepted as operands and resolved to ids.',
      },
      data: {
        kind: 'object',
        required: true,
        describe: 'Row-data patch applied to every matching row.',
      },
      limit: { kind: 'integer', describe: 'Maximum matching rows to update.' },
    },
  },
  updateSkill: {
    method: 'PATCH',
    path: '/api/v2/skills/[id]',
    pathParams: ['id'] as const,
    pathParamDocs: {
      id: 'Unique skill identifier. A built-in skill is `builtin-` followed by its name, for example `builtin-research`.',
    },
    responseMode: 'json',
    summary: 'Update Skill',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the skill.' },
      name: { kind: 'string', describe: 'New kebab-case skill name.' },
      description: { kind: 'string', describe: 'New one-line summary of when the skill applies.' },
      content: { kind: 'string', describe: 'Replacement skill body.' },
    },
  },
  updateTable: {
    method: 'PATCH',
    path: '/api/v2/tables/[tableId]',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Update Table',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      name: { kind: 'string', describe: 'Replacement table name.' },
      description: {
        kind: 'string',
        describe: 'Replacement table description, or null to clear it.',
      },
      folderPath: {
        kind: 'string',
        describe:
          'Folder path. A missing leading slash is normalized before validation. Segments are percent-encoded, so a folder shown as "New folder" is `/New%20folder`: everything outside `A-Z a-z 0-9 - _ . ~` is escaped as uppercase hex, and only that exact encoding is accepted. A trailing slash, an empty segment, and a literal `.` or `..` segment are rejected. At most 64 segments and 4096 encoded bytes.',
      },
    },
  },
  updateTableColumn: {
    method: 'PATCH',
    path: '/api/v2/tables/[tableId]/columns',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Update Column',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the table.' },
      columnName: {
        kind: 'string',
        required: true,
        describe: 'Current name of the column to update.',
      },
      updates: { kind: 'object', required: true, describe: 'Mutable column fields.' },
    },
  },
  updateTableRow: {
    method: 'PATCH',
    path: '/api/v2/tables/[tableId]/rows/[rowId]',
    pathParams: ['tableId', 'rowId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.', rowId: 'Unique table row identifier.' },
    responseMode: 'json',
    summary: 'Update Row',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      data: {
        kind: 'object',
        required: true,
        describe: 'Partial row-data patch keyed by column name.',
      },
    },
  },
  updateTableView: {
    method: 'PATCH',
    path: '/api/v2/tables/[tableId]/views/[viewId]',
    pathParams: ['tableId', 'viewId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.', viewId: 'Unique saved-view identifier.' },
    responseMode: 'json',
    summary: 'Update View',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the table.' },
      name: { kind: 'string', describe: 'Replacement saved-view display name.' },
      config: { kind: 'object', describe: 'Complete replacement saved-view configuration.' },
      configPatch: {
        kind: 'object',
        describe: 'Saved-view configuration fields to shallow-merge.',
      },
      isDefault: {
        kind: 'boolean',
        describe: 'Whether to promote this view to the table default.',
      },
    },
  },
  updateWorkflow: {
    method: 'PATCH',
    path: '/api/v2/workflows/[id]',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Update Workflow',
    body: {
      name: { kind: 'string', describe: 'Replacement workflow name.' },
      description: {
        kind: 'string',
        describe: 'Replacement workflow description; null clears it.',
      },
      folderPath: {
        kind: 'string',
        describe: 'Destination folder path; `/` moves the workflow to the workspace root.',
      },
    },
  },
  updateWorkflowGroup: {
    method: 'PATCH',
    path: '/api/v2/tables/[tableId]/groups',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Update Workflow Group',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      groupId: { kind: 'string', required: true, describe: 'Workflow group to update.' },
      workflowId: { kind: 'string', describe: 'Replacement backing workflow identifier.' },
      name: { kind: 'string', describe: 'Replacement workflow-group display name.' },
      dependencies: { kind: 'object', describe: 'Replacement input dependencies.' },
      outputs: { kind: 'array', describe: 'Replacement producer outputs.' },
      newOutputColumns: { kind: 'array', describe: 'Columns to add for new outputs.' },
      mappingUpdates: { kind: 'array', describe: 'Existing output-column mapping changes.' },
      inputMappings: { kind: 'array', describe: 'Replacement workflow input mappings.' },
      deploymentMode: {
        kind: 'enum',
        values: ['live', 'deployed'] as const,
        describe: 'Replacement workflow execution mode.',
      },
      type: {
        kind: 'enum',
        values: ['manual', 'enrichment'] as const,
        describe:
          "Workflow-group producer type. Must match the group's stored type — a group's producer cannot be changed after creation.",
      },
      autoRun: { kind: 'boolean', describe: 'Replacement automatic-run setting.' },
    },
  },
  uploadKnowledgeDocument: {
    method: 'POST',
    path: '/api/v2/knowledge/[id]/documents',
    pathParams: ['id'] as const,
    pathParamDocs: { id: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'Upload Document',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
    },
  },
  upsertFileShare: {
    method: 'PATCH',
    path: '/api/v2/files/[fileId]/share',
    pathParams: ['fileId'] as const,
    pathParamDocs: { fileId: 'File identifier.' },
    responseMode: 'json',
    summary: 'Enable or Disable File Share',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the file.' },
      isActive: {
        kind: 'boolean',
        required: true,
        describe:
          'Whether the share should resolve. Disabling preserves the token and the whole access configuration, so re-enabling restores the share as it was; enabling rewrites the credentials the resulting mode does not use.',
      },
      authType: {
        kind: 'enum',
        values: ['public', 'password', 'email', 'sso'] as const,
        describe:
          'How access to the share is gated. The stored mode is kept when omitted. Enabling `public` clears the stored password and empties `allowedEmails`; `password` empties `allowedEmails`; `email` and `sso` clear the stored password.',
      },
      password: {
        kind: 'string',
        describe:
          'Password for a password-gated share. Kept when omitted; enabling `password` with neither a supplied nor a stored password is a 400.',
      },
      allowedEmails: {
        kind: 'array',
        describe:
          'Allowed addresses or `@domain` patterns for email and SSO shares. Kept when omitted; enabling `email` or `sso` with an empty resulting list is a 400.',
      },
    },
  },
  upsertTableRow: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/rows/upsert',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Upsert Row',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      data: {
        kind: 'object',
        required: true,
        describe:
          'Complete set of row cells keyed by column name. On the update branch this REPLACES the matched row: any column not present here is cleared, unlike the merging `PATCH /api/v2/tables/{tableId}/rows/{rowId}`.',
      },
      conflictTarget: { kind: 'string', describe: 'Unique column used to detect a conflict.' },
    },
  },
} as const

export type V2OperationName = keyof typeof V2_OPERATIONS
