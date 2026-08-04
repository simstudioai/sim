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

export type AbortFileUploadResponse = {
  data: {
    id: string
    status: 'uploading' | 'finalizing' | 'completed' | 'failed' | 'aborted' | 'expired'
    name: string
    contentType: string
    size: number
    partSize: number
    partCount: number
    uploadToken: string
    expiresAt: string
    error: string | null
    file: {
      id: string
      name: string
      size: number
      type: string
      key: string
      folderId: string | null
      folderPath: string | null
      uploadedBy: string
      uploadedAt: string
      updatedAt: string
    } | null
  }
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

export type AbortKnowledgeDocumentUploadResponse = {
  data: {
    id: string
    knowledgeBaseId: string
    status: 'uploading' | 'finalizing' | 'completed' | 'failed' | 'aborted' | 'expired'
    name: string
    contentType: string
    size: number
    partSize: number
    partCount: number
    uploadToken: string
    expiresAt: string
    error: string | null
    document: {
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
    } | null
  }
}

/** `POST /api/v2/tables/[tableId]/columns` */
export type AddTableColumnParams = {
  tableId: string
}

export type AddTableColumnBody = {
  workspaceId: string
  column: {
    id?: string
    name: string
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
    required?: boolean
    unique?: boolean
    position?: number
    options?: Array<{
      id: string
      name: string
    }>
    multiple?: boolean
    currencyCode?: string
  }
}

export type AddTableColumnResponse = {
  data: {
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
      currencyCode?: unknown
    }>
  }
}

/** `POST /api/v2/tables/[tableId]/groups` */
export type AddWorkflowGroupParams = {
  tableId: string
}

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

export type AddWorkflowGroupResponse = {
  data: {
    group: {
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
      currencyCode?: unknown
    }>
  }
}

/** `POST /api/v2/files/bulk-archive` */
export type BulkArchiveFileItemsBody = {
  workspaceId: string
  fileIds?: Array<string>
  folderIds?: Array<string>
}

export type BulkArchiveFileItemsResponse = {
  data: {
    deletedItems: {
      files: number
      folders: number
    }
  }
}

/** `DELETE /api/v2/tables/exports/[exportId]` */
export type CancelTableExportParams = {
  exportId: string
}

export type CancelTableExportQuery = {
  workspaceId: string
}

export type CancelTableExportResponse = {
  data: {
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

export type CancelTableImportResponse = {
  data: {
    id: string
    workspaceId: string
    status: 'uploading' | 'queued' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired'
    source:
      | {
          type: 'upload'
          name: string
          contentType: string
          size: number
        }
      | {
          type: 'workspace_file'
          fileId: string
        }
    target:
      | {
          type: 'new'
          name: string
          folderId?: string
        }
      | {
          type: 'existing'
          tableId: string
          mode: 'append' | 'replace'
        }
    tableId: string | null
    rowsProcessed: number
    error: string | null
    upload: {
      uploadToken: string
      partSize: number
      partCount: number
      expiresAt: string
    } | null
    createdAt: string
    updatedAt: string
    completedAt: string | null
  }
}

/** `POST /api/v2/tables/[tableId]/cancel-runs` */
export type CancelTableRunsParams = {
  tableId: string
}

export type CancelTableRunsBody = {
  workspaceId: string
  scope: 'all' | 'row'
  rowId?: string
  filter?: unknown
  excludeRowIds?: Array<string>
}

export type CancelTableRunsResponse = {
  data: {
    cancelled: number
  }
}

/** `POST /api/v2/workflows/[id]/executions/[executionId]/cancel` */
export type CancelWorkflowExecutionParams = {
  id: string
  executionId: string
}

export type CancelWorkflowExecutionResponse = {
  data: {
    success: boolean
    executionId: string
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
}

/** `POST /api/v2/files/uploads/[uploadId]/complete` */
export type CompleteFileUploadParams = {
  uploadId: string
}

export type CompleteFileUploadQuery = {
  workspaceId: string
}

export type CompleteFileUploadBody = {
  parts: Array<{
    partNumber: number
    etag?: string
  }>
}

export type CompleteFileUploadHeaders = {
  'upload-token': string
}

export type CompleteFileUploadResponse = {
  data: {
    id: string
    status: 'uploading' | 'finalizing' | 'completed' | 'failed' | 'aborted' | 'expired'
    name: string
    contentType: string
    size: number
    partSize: number
    partCount: number
    uploadToken: string
    expiresAt: string
    error: string | null
    file: {
      id: string
      name: string
      size: number
      type: string
      key: string
      folderId: string | null
      folderPath: string | null
      uploadedBy: string
      uploadedAt: string
      updatedAt: string
    } | null
  }
}

/** `POST /api/v2/knowledge/[id]/documents/uploads/[uploadId]/complete` */
export type CompleteKnowledgeDocumentUploadParams = {
  id: string
  uploadId: string
}

export type CompleteKnowledgeDocumentUploadQuery = {
  workspaceId: string
}

export type CompleteKnowledgeDocumentUploadBody = {
  parts: Array<{
    partNumber: number
    etag?: string
  }>
}

export type CompleteKnowledgeDocumentUploadHeaders = {
  'upload-token': string
}

export type CompleteKnowledgeDocumentUploadResponse = {
  data: {
    id: string
    knowledgeBaseId: string
    status: 'uploading' | 'finalizing' | 'completed' | 'failed' | 'aborted' | 'expired'
    name: string
    contentType: string
    size: number
    partSize: number
    partCount: number
    uploadToken: string
    expiresAt: string
    error: string | null
    document: {
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
    } | null
  }
}

/** `POST /api/v2/tables/imports/[importId]/complete` */
export type CompleteTableImportParams = {
  importId: string
}

export type CompleteTableImportQuery = {
  workspaceId: string
}

export type CompleteTableImportBody = {
  parts: Array<{
    partNumber: number
    etag?: string
  }>
}

export type CompleteTableImportHeaders = {
  'upload-token': string
}

export type CompleteTableImportResponse = {
  data: {
    id: string
    workspaceId: string
    status: 'uploading' | 'queued' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired'
    source:
      | {
          type: 'upload'
          name: string
          contentType: string
          size: number
        }
      | {
          type: 'workspace_file'
          fileId: string
        }
    target:
      | {
          type: 'new'
          name: string
          folderId?: string
        }
      | {
          type: 'existing'
          tableId: string
          mode: 'append' | 'replace'
        }
    tableId: string | null
    rowsProcessed: number
    error: string | null
    upload: {
      uploadToken: string
      partSize: number
      partCount: number
      expiresAt: string
    } | null
    createdAt: string
    updatedAt: string
    completedAt: string | null
  }
}

/** `POST /api/v2/credentials` */
export type CreateCredentialBody = {
  workspaceId: string
  type: 'env_workspace' | 'env_personal' | 'service_account'
  displayName?: string
  description?: string
  providerId?: string
  envKey?: string
  serviceAccountJson?: string
  signingSecret?: string
  botToken?: string
  apiToken?: string
  domain?: string
  clientId?: string
  clientSecret?: string
  orgId?: string
}

export type CreateCredentialResponse = {
  data: {
    credential: {
      id: string
      type: 'oauth' | 'env_workspace' | 'env_personal' | 'service_account'
      displayName: string
      description: string | null
      providerId: string | null
      accountId: string | null
      envKey: string | null
      hasServiceAccountKey: boolean
      role: 'admin' | 'member'
      createdAt: string
      updatedAt: string
    }
  }
}

/** `POST /api/v2/custom-tools` */
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

export type CreateCustomToolResponse = {
  data: {
    customTool: {
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
  }
}

/** `POST /api/v2/files/uploads` */
export type CreateFileUploadBody = {
  workspaceId: string
  name: string
  contentType: string
  size: number
  folderId?: string
}

export type CreateFileUploadResponse = {
  data: {
    id: string
    status: 'uploading' | 'finalizing' | 'completed' | 'failed' | 'aborted' | 'expired'
    name: string
    contentType: string
    size: number
    partSize: number
    partCount: number
    uploadToken: string
    expiresAt: string
    error: string | null
    file: {
      id: string
      name: string
      size: number
      type: string
      key: string
      folderId: string | null
      folderPath: string | null
      uploadedBy: string
      uploadedAt: string
      updatedAt: string
    } | null
  }
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

export type CreateFileUploadPartUrlsResponse = {
  data: {
    parts: Array<{
      partNumber: number
      url: string
      headers: Record<string, string>
      expiresAt: string
    }>
  }
}

/** `POST /api/v2/folders` */
export type CreateFolderBody = {
  workspaceId: string
  resourceType: 'workflow' | 'knowledge_base' | 'table'
  name: string
  parentId?: string | null
  sortOrder?: number
}

export type CreateFolderResponse = {
  data: {
    folder: {
      id: string
      resourceType: 'workflow' | 'file' | 'knowledge_base' | 'table'
      name: string
      parentId: string | null
      locked: boolean
      sortOrder: number
      createdAt: string
      updatedAt: string
      deletedAt: string | null
    }
  }
}

/** `POST /api/v2/knowledge` */
export type CreateKnowledgeBaseBody = {
  workspaceId: string
  name: string
  description?: string
  chunkingConfig?: {
    maxSize?: number
    minSize?: number
    overlap?: number
  }
}

export type CreateKnowledgeBaseResponse = {
  data: {
    knowledgeBase: {
      id: string
      name: string
      description: string | null
      tokenCount: number
      embeddingModel: string
      embeddingDimension: number
      chunkingConfig: {
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
      docCount?: number
      connectorTypes?: Array<string>
      createdAt: string
      updatedAt: string
    }
  }
}

/** `POST /api/v2/knowledge/[id]/documents/uploads` */
export type CreateKnowledgeDocumentUploadParams = {
  id: string
}

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

export type CreateKnowledgeDocumentUploadResponse = {
  data: {
    id: string
    knowledgeBaseId: string
    status: 'uploading' | 'finalizing' | 'completed' | 'failed' | 'aborted' | 'expired'
    name: string
    contentType: string
    size: number
    partSize: number
    partCount: number
    uploadToken: string
    expiresAt: string
    error: string | null
    document: {
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
    } | null
  }
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

export type CreateKnowledgeDocumentUploadPartUrlsResponse = {
  data: {
    parts: Array<{
      partNumber: number
      url: string
      headers: Record<string, string>
      expiresAt: string
    }>
  }
}

/** `POST /api/v2/mcp-servers` */
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

export type CreateMcpServerResponse = {
  data: {
    mcpServer: {
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
  }
}

/** `POST /api/v2/skills` */
export type CreateSkillBody = {
  workspaceId: string
  name: string
  description: string
  content: string
}

export type CreateSkillResponse = {
  data: {
    skill: {
      id: string
      name: string
      description: string
      readOnly: boolean
      createdAt: string
      updatedAt: string
      content: string
    }
  }
}

/** `POST /api/v2/tables` */
export type CreateTableBody = {
  name: string
  description?: string
  schema: {
    columns: Array<{
      id?: string
      name: string
      type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'
      required?: boolean
      unique?: boolean
      workflowGroupId?: string
      options?: Array<{
        id: string
        name: string
      }>
      multiple?: boolean
      currencyCode?: string
    }>
  }
  workspaceId: string
  folderId?: string | null
}

export type CreateTableResponse = {
  data: {
    table: {
      id: string
      name: string
      description: string | null
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
          currencyCode?: unknown
        }>
      }
      rowCount: number
      maxRows: number
      folderId: string | null
      locks: {
        schemaLocked: boolean
        insertLocked: boolean
        updateLocked: boolean
        deleteLocked: boolean
      }
      job: {
        id: string | null
        type: 'import' | 'delete' | 'export' | 'backfill' | 'update' | null
        status: 'running' | 'ready' | 'failed' | 'canceled'
        rowsProcessed: number
        error: string | null
      } | null
      createdAt: string
      updatedAt: string
    }
  }
}

/** `POST /api/v2/tables/[tableId]/exports` */
export type CreateTableExportParams = {
  tableId: string
}

export type CreateTableExportBody = {
  workspaceId: string
  format?: 'csv' | 'json'
}

export type CreateTableExportResponse = {
  data: {
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
}

/** `POST /api/v2/tables/imports` */
export type CreateTableImportBody = {
  workspaceId: string
  source:
    | {
        type: 'upload'
        name: string
        contentType: string
        size: number
      }
    | {
        type: 'workspace_file'
        fileId: string
      }
  target:
    | {
        type: 'new'
        name: string
        folderId?: string
      }
    | {
        type: 'existing'
        tableId: string
        mode: 'append' | 'replace'
      }
  mapping?: unknown
  createColumns?: unknown
  timezone?: string
}

export type CreateTableImportResponse = {
  data: {
    id: string
    workspaceId: string
    status: 'uploading' | 'queued' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired'
    source:
      | {
          type: 'upload'
          name: string
          contentType: string
          size: number
        }
      | {
          type: 'workspace_file'
          fileId: string
        }
    target:
      | {
          type: 'new'
          name: string
          folderId?: string
        }
      | {
          type: 'existing'
          tableId: string
          mode: 'append' | 'replace'
        }
    tableId: string | null
    rowsProcessed: number
    error: string | null
    upload: {
      uploadToken: string
      partSize: number
      partCount: number
      expiresAt: string
    } | null
    createdAt: string
    updatedAt: string
    completedAt: string | null
  }
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

export type CreateTableImportPartUrlsResponse = {
  data: {
    parts: Array<{
      partNumber: number
      url: string
      headers: Record<string, string>
      expiresAt: string
    }>
  }
}

/** `POST /api/v2/tables/[tableId]/rows` */
export type CreateTableRowsParams = {
  tableId: string
}

export type CreateTableRowsBody =
  | {
      workspaceId: string
      rows: Array<unknown>
    }
  | {
      workspaceId: string
      data: unknown
      afterRowId?: string
      beforeRowId?: string
    }

export type CreateTableRowsResponse =
  | {
      data: {
        row: {
          id: string
          data: Record<string, unknown>
          createdAt: string
          updatedAt: string
        }
      }
    }
  | {
      data: {
        rows: Array<{
          id: string
          data: Record<string, unknown>
          createdAt: string
          updatedAt: string
        }>
        insertedCount: number
      }
    }

/** `POST /api/v2/tables/[tableId]/views` */
export type CreateTableViewParams = {
  tableId: string
}

export type CreateTableViewBody = {
  workspaceId: string
  name: string
  config: {
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
}

type CreateTableViewResponseRef0 =
  | {
      all: Array<
        | CreateTableViewResponseRef0
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
        | CreateTableViewResponseRef0
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

export type CreateTableViewResponse = {
  data: {
    view: {
      id: string
      tableId: string
      name: string
      config: {
        columnWidths?: Record<string, number>
        columnOrder?: Array<string>
        pinnedColumns?: Array<string>
        hiddenColumns?: Array<string>
        filter?: CreateTableViewResponseRef0 | null
        sort?: Array<{
          field: string
          direction: 'asc' | 'desc'
        }> | null
      }
      isDefault: boolean
      createdBy: string | null
      createdAt: string
      updatedAt: string
    }
  }
}

/** `POST /api/v2/workflows` */
export type CreateWorkflowBody = {
  workspaceId: string
  name: string
  description?: string | null
  folderId?: string | null
}

export type CreateWorkflowResponse = {
  data: {
    id: string
    name: string
    description: string | null
    folderId: string | null
    workspaceId: string
    isDeployed: boolean
    deployedAt: string | null
    runCount: number
    lastRunAt: string | null
    createdAt: string
    updatedAt: string
  }
}

/** `DELETE /api/v2/credentials/[id]` */
export type DeleteCredentialParams = {
  id: string
}

export type DeleteCredentialQuery = {
  workspaceId: string
}

export type DeleteCredentialResponse = {
  data: {
    id: string
    deleted: true
  }
}

/** `DELETE /api/v2/custom-tools/[id]` */
export type DeleteCustomToolParams = {
  id: string
}

export type DeleteCustomToolQuery = {
  workspaceId: string
}

export type DeleteCustomToolResponse = {
  data: {
    id: string
    deleted: true
  }
}

/** `DELETE /api/v2/files/[fileId]` */
export type DeleteFileParams = {
  fileId: string
}

export type DeleteFileQuery = {
  workspaceId: string
}

export type DeleteFileResponse = {
  data: {
    id: string
    deleted: true
  }
}

/** `DELETE /api/v2/folders/[id]` */
export type DeleteFolderParams = {
  id: string
}

export type DeleteFolderQuery = {
  workspaceId: string
  resourceType: 'workflow' | 'knowledge_base' | 'table'
}

export type DeleteFolderResponse = {
  data: {
    id: string
    deleted: true
    deletedItems?: {
      folders: number
      workflows?: number
      files?: number
      knowledgeBases?: number
      tables?: number
    }
  }
}

/** `DELETE /api/v2/knowledge/[id]` */
export type DeleteKnowledgeBaseParams = {
  id: string
}

export type DeleteKnowledgeBaseQuery = {
  workspaceId: string
}

export type DeleteKnowledgeBaseResponse = {
  data: {
    id: string
    deleted: true
  }
}

/** `DELETE /api/v2/knowledge/[id]/documents/[documentId]` */
export type DeleteKnowledgeDocumentParams = {
  id: string
  documentId: string
}

export type DeleteKnowledgeDocumentQuery = {
  workspaceId: string
}

export type DeleteKnowledgeDocumentResponse = {
  data: {
    id: string
    deleted: true
  }
}

/** `DELETE /api/v2/mcp-servers/[id]` */
export type DeleteMcpServerParams = {
  id: string
}

export type DeleteMcpServerQuery = {
  workspaceId: string
}

export type DeleteMcpServerResponse = {
  data: {
    id: string
    deleted: true
  }
}

/** `DELETE /api/v2/skills/[id]` */
export type DeleteSkillParams = {
  id: string
}

export type DeleteSkillQuery = {
  workspaceId: string
}

export type DeleteSkillResponse = {
  data: {
    id: string
    deleted: true
  }
}

/** `DELETE /api/v2/tables/[tableId]` */
export type DeleteTableParams = {
  tableId: string
}

export type DeleteTableQuery = {
  workspaceId: string
}

export type DeleteTableResponse = {
  data: {
    id: string
  }
}

/** `DELETE /api/v2/tables/[tableId]/columns` */
export type DeleteTableColumnParams = {
  tableId: string
}

export type DeleteTableColumnBody = {
  workspaceId: string
  columnName: string
}

export type DeleteTableColumnResponse = {
  data: {
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
      currencyCode?: unknown
    }>
  }
}

/** `DELETE /api/v2/tables/[tableId]/rows/[rowId]` */
export type DeleteTableRowParams = {
  tableId: string
  rowId: string
}

export type DeleteTableRowQuery = {
  workspaceId: string
}

export type DeleteTableRowResponse = {
  data: {
    deletedCount: number
    deletedRowIds: Array<string>
  }
}

/** `DELETE /api/v2/tables/[tableId]/rows` */
export type DeleteTableRowsParams = {
  tableId: string
}

export type DeleteTableRowsBody = {
  workspaceId: string
  filter?: unknown
  limit?: number
  rowIds?: Array<string>
}

export type DeleteTableRowsResponse = {
  data: {
    deletedCount: number
    deletedRowIds: Array<string>
    requestedCount?: number
    missingRowIds?: Array<string>
  }
}

/** `DELETE /api/v2/tables/[tableId]/views/[viewId]` */
export type DeleteTableViewParams = {
  tableId: string
  viewId: string
}

export type DeleteTableViewQuery = {
  workspaceId: string
}

export type DeleteTableViewResponse = {
  data: {
    id: string
  }
}

/** `DELETE /api/v2/workflows/[id]` */
export type DeleteWorkflowParams = {
  id: string
}

export type DeleteWorkflowResponse = {
  data: {
    id: string
    deleted: true
  }
}

/** `DELETE /api/v2/tables/[tableId]/groups` */
export type DeleteWorkflowGroupParams = {
  tableId: string
}

export type DeleteWorkflowGroupBody = {
  workspaceId: string
  groupId: string
}

export type DeleteWorkflowGroupResponse = {
  data: {
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
      currencyCode?: unknown
    }>
  }
}

/** `POST /api/v2/workflows/[id]/deploy` */
export type DeployWorkflowParams = {
  id: string
}

export type DeployWorkflowResponse = {
  data: {
    id: string
    isDeployed: boolean
    deployedAt: string | null
    warnings: Array<string>
    activeDeployment: {
      deploymentVersionId: string
      version: number
      deployedAt: string
    } | null
    latestDeploymentAttempt: {
      id: string
      deploymentVersionId: string
      version: number
      action: 'deploy' | 'activate'
      status: 'preparing' | 'activating' | 'active' | 'failed' | 'superseded'
      isCurrent: boolean
      readiness: {
        webhooks: 'pending' | 'ready' | 'not_applicable'
        schedules: 'pending' | 'ready' | 'not_applicable'
        mcp: 'pending' | 'ready' | 'not_applicable'
      }
      requestedAt: string
      activatedAt?: string | null
      error?: {
        code: string
        message: string
        retryable: boolean
      } | null
    } | null
    version?: number
  }
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

export type ExecuteWorkflowBody = {
  input?: Record<string, unknown>
  async?: boolean
  stream?: boolean
  selectedOutputs?: Array<string>
  includeThinking?: boolean
  includeToolCalls?: boolean
  includeFileBase64?: boolean
  base64MaxBytes?: number
}

export type ExecuteWorkflowResponse = {
  data: {
    executionId: string
    workflowId: string
    status: 'completed' | 'failed' | 'paused' | 'cancelled'
    output: unknown
    error: {
      message: string
      code:
        | 'TIMEOUT'
        | 'CANCELLED'
        | 'USAGE_LIMIT_EXCEEDED'
        | 'INVALID_INPUT'
        | 'BLOCK_EXECUTION_FAILED'
        | 'CHILD_WORKFLOW_FAILED'
        | 'OUTPUT_TOO_LARGE'
        | 'EXECUTION_FAILED'
      blockId?: string
      blockName?: string
      blockType?: string
    } | null
    startedAt?: string
    endedAt?: string
    durationMs?: number
  }
}

/** `GET /api/v2/workflows/[id]/export` */
export type ExportWorkflowParams = {
  id: string
}

export type ExportWorkflowResponse = {
  data: {
    version: '1.0'
    exportedAt: string
    workflow: {
      id: string
      name: string
      description: string | null
      workspaceId: string | null
      folderId: string | null
    }
    state: {
      blocks: Record<
        string,
        {
          id: string
          type: string
          name: string
          position: {
            x: number
            y: number
          }
          subBlocks: Record<
            string,
            {
              id: string
              type: string
              value: unknown
            }
          >
          outputs: Record<string, unknown>
          enabled: boolean
          horizontalHandles?: boolean
          height?: number
          advancedMode?: boolean
          triggerMode?: boolean
          data?: {
            parentId?: string
            extent?: 'parent'
            width?: number
            height?: number
            collection?: unknown
            count?: number
            loopType?: 'for' | 'forEach' | 'while' | 'doWhile'
            whileCondition?: string
            doWhileCondition?: string
            parallelType?: 'collection' | 'count'
            batchSize?: number
            type?: string
            canonicalModes?: Record<string, 'basic' | 'advanced'>
          }
          locked?: boolean
        }
      >
      edges: Array<{
        id: string
        source: string
        target: string
        sourceHandle: unknown
        targetHandle: unknown
        type?: string
        animated?: boolean
        style?: Record<string, unknown>
        data?: Record<string, unknown>
        label?: string
        labelStyle?: Record<string, unknown>
        labelShowBg?: boolean
        labelBgStyle?: Record<string, unknown>
        labelBgPadding?: unknown[]
        labelBgBorderRadius?: number
        markerStart?: string
        markerEnd?: string
      }>
      loops?: Record<
        string,
        {
          id: string
          nodes: Array<string>
          iterations: number
          loopType: 'for' | 'forEach' | 'while' | 'doWhile'
          forEachItems?: Array<unknown> | Record<string, unknown> | string
          whileCondition?: string
          doWhileCondition?: string
          enabled?: boolean
          locked?: boolean
        }
      >
      parallels?: Record<
        string,
        {
          id: string
          nodes: Array<string>
          distribution?: Array<unknown> | Record<string, unknown> | string
          count?: number
          parallelType?: 'count' | 'collection'
          batchSize?: number
          enabled?: boolean
          locked?: boolean
        }
      >
      variables?: Record<
        string,
        {
          id: string
          name: string
          type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'plain'
          value: unknown
        }
      >
      metadata?: {
        name?: string
        description?: string
        sortOrder?: number
        exportedAt?: string
      }
    }
  }
}

/** `POST /api/v2/tables/[tableId]/rows/find` */
export type FindTableRowsParams = {
  tableId: string
}

export type FindTableRowsBody = {
  workspaceId: string
  q: string
  predicate?: unknown
  sort?: Array<{
    field: string
    direction: 'asc' | 'desc'
  }>
}

export type FindTableRowsResponse = {
  data: {
    matches: Array<{
      ordinal: number
      rowId: string
      column: string
    }>
    truncated: boolean
  }
}

/** `GET /api/v2/audit-logs/[id]` */
export type GetAuditLogParams = {
  id: string
}

export type GetAuditLogResponse = {
  data: {
    id: string
    workspaceId: string | null
    actorId: string | null
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
}

/** `GET /api/v2/credentials/[id]` */
export type GetCredentialParams = {
  id: string
}

export type GetCredentialQuery = {
  workspaceId: string
}

export type GetCredentialResponse = {
  data: {
    credential: {
      id: string
      type: 'oauth' | 'env_workspace' | 'env_personal' | 'service_account'
      displayName: string
      description: string | null
      providerId: string | null
      accountId: string | null
      envKey: string | null
      hasServiceAccountKey: boolean
      role: 'admin' | 'member'
      createdAt: string
      updatedAt: string
    }
  }
}

/** `GET /api/v2/custom-tools/[id]` */
export type GetCustomToolParams = {
  id: string
}

export type GetCustomToolQuery = {
  workspaceId: string
}

export type GetCustomToolResponse = {
  data: {
    customTool: {
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
  }
}

/** `GET /api/v2/logs/executions/[executionId]` */
export type GetExecutionParams = {
  executionId: string
}

export type GetExecutionResponse = {
  data: {
    executionId: string
    workflowId: string | null
    workflowState: unknown
    executionMetadata: {
      trigger: string
      startedAt: string
      endedAt: string | null
      totalDurationMs: number | null
      cost: {
        total: number
      } | null
    }
  }
}

/** `GET /api/v2/files/[fileId]/share` */
export type GetFileShareParams = {
  fileId: string
}

export type GetFileShareQuery = {
  workspaceId: string
}

export type GetFileShareResponse = {
  data: {
    share: {
      id: string
      token: string
      url: string
      isActive: boolean
      resourceType: 'file' | 'folder'
      resourceId: string
      authType: 'public' | 'password' | 'email' | 'sso'
      hasPassword: boolean
      allowedEmails: Array<string>
    } | null
  }
}

/** `GET /api/v2/folders/[id]` */
export type GetFolderParams = {
  id: string
}

export type GetFolderQuery = {
  workspaceId: string
  resourceType: 'workflow' | 'knowledge_base' | 'table'
}

export type GetFolderResponse = {
  data: {
    folder: {
      id: string
      resourceType: 'workflow' | 'file' | 'knowledge_base' | 'table'
      name: string
      parentId: string | null
      locked: boolean
      sortOrder: number
      createdAt: string
      updatedAt: string
      deletedAt: string | null
    }
  }
}

/** `GET /api/v2/knowledge/[id]` */
export type GetKnowledgeBaseParams = {
  id: string
}

export type GetKnowledgeBaseQuery = {
  workspaceId: string
}

export type GetKnowledgeBaseResponse = {
  data: {
    knowledgeBase: {
      id: string
      name: string
      description: string | null
      tokenCount: number
      embeddingModel: string
      embeddingDimension: number
      chunkingConfig: {
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
      docCount?: number
      connectorTypes?: Array<string>
      createdAt: string
      updatedAt: string
    }
  }
}

/** `GET /api/v2/knowledge/[id]/documents/[documentId]` */
export type GetKnowledgeDocumentParams = {
  id: string
  documentId: string
}

export type GetKnowledgeDocumentQuery = {
  workspaceId: string
}

export type GetKnowledgeDocumentResponse = {
  data: {
    document: {
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
      processingError: string | null
      processingStartedAt: string | null
      processingCompletedAt: string | null
      connectorId: string | null
      connectorType: string | null
      sourceUrl: string | null
    }
  }
}

/** `GET /api/v2/logs/[id]` */
export type GetLogParams = {
  id: string
}

export type GetLogResponse = {
  data: {
    id: string
    workflowId: string | null
    executionId: string
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
      folderId: string | null
      userId: string | null
      workspaceId: string | null
      createdAt: string | null
      updatedAt: string | null
      deleted: boolean
    }
    executionData: unknown
    cost: {
      total: number
    } | null
    createdAt: string
  }
}

/** `GET /api/v2/mcp-servers/[id]` */
export type GetMcpServerParams = {
  id: string
}

export type GetMcpServerQuery = {
  workspaceId: string
}

export type GetMcpServerResponse = {
  data: {
    mcpServer: {
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
  }
}

/** `GET /api/v2/skills/[id]` */
export type GetSkillParams = {
  id: string
}

export type GetSkillQuery = {
  workspaceId: string
}

export type GetSkillResponse = {
  data: {
    skill: {
      id: string
      name: string
      description: string
      readOnly: boolean
      createdAt: string
      updatedAt: string
      content: string
    }
  }
}

/** `GET /api/v2/tables/[tableId]` */
export type GetTableParams = {
  tableId: string
}

export type GetTableQuery = {
  workspaceId: string
}

export type GetTableResponse = {
  data: {
    table: {
      id: string
      name: string
      description: string | null
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
          currencyCode?: unknown
        }>
      }
      rowCount: number
      maxRows: number
      folderId: string | null
      locks: {
        schemaLocked: boolean
        insertLocked: boolean
        updateLocked: boolean
        deleteLocked: boolean
      }
      job: {
        id: string | null
        type: 'import' | 'delete' | 'export' | 'backfill' | 'update' | null
        status: 'running' | 'ready' | 'failed' | 'canceled'
        rowsProcessed: number
        error: string | null
      } | null
      createdAt: string
      updatedAt: string
    }
  }
}

/** `GET /api/v2/tables/exports/[exportId]` */
export type GetTableExportParams = {
  exportId: string
}

export type GetTableExportQuery = {
  workspaceId: string
}

export type GetTableExportResponse = {
  data: {
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
}

/** `GET /api/v2/tables/imports/[importId]` */
export type GetTableImportParams = {
  importId: string
}

export type GetTableImportQuery = {
  workspaceId: string
}

export type GetTableImportResponse = {
  data: {
    id: string
    workspaceId: string
    status: 'uploading' | 'queued' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired'
    source:
      | {
          type: 'upload'
          name: string
          contentType: string
          size: number
        }
      | {
          type: 'workspace_file'
          fileId: string
        }
    target:
      | {
          type: 'new'
          name: string
          folderId?: string
        }
      | {
          type: 'existing'
          tableId: string
          mode: 'append' | 'replace'
        }
    tableId: string | null
    rowsProcessed: number
    error: string | null
    upload: {
      uploadToken: string
      partSize: number
      partCount: number
      expiresAt: string
    } | null
    createdAt: string
    updatedAt: string
    completedAt: string | null
  }
}

/** `GET /api/v2/tables/[tableId]/rows/[rowId]` */
export type GetTableRowParams = {
  tableId: string
  rowId: string
}

export type GetTableRowQuery = {
  workspaceId: string
}

export type GetTableRowResponse = {
  data: {
    row: {
      id: string
      data: Record<string, unknown>
      createdAt: string
      updatedAt: string
    }
  }
}

/** `GET /api/v2/tables/[tableId]/views/[viewId]` */
export type GetTableViewParams = {
  tableId: string
  viewId: string
}

export type GetTableViewQuery = {
  workspaceId: string
}

type GetTableViewResponseRef0 =
  | {
      all: Array<
        | GetTableViewResponseRef0
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
        | GetTableViewResponseRef0
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

export type GetTableViewResponse = {
  data: {
    view: {
      id: string
      tableId: string
      name: string
      config: {
        columnWidths?: Record<string, number>
        columnOrder?: Array<string>
        pinnedColumns?: Array<string>
        hiddenColumns?: Array<string>
        filter?: GetTableViewResponseRef0 | null
        sort?: Array<{
          field: string
          direction: 'asc' | 'desc'
        }> | null
      }
      isDefault: boolean
      createdBy: string | null
      createdAt: string
      updatedAt: string
    }
  }
}

/** `GET /api/v2/billing/usage` */
export type GetUsageSummaryQuery = {
  workspaceId?: string
}

export type GetUsageSummaryResponse = {
  data: {
    period: {
      start: string
      end: string
    }
    totalCredits: number
    bySourceCredits: Record<string, number>
    limitCredits: number
    plan: string
  }
}

/** `GET /api/v2/workflows/[id]` */
export type GetWorkflowParams = {
  id: string
}

export type GetWorkflowResponse = {
  data: {
    id: string
    name: string
    description: string | null
    folderId: string | null
    workspaceId: string
    isDeployed: boolean
    deployedAt: string | null
    runCount: number
    lastRunAt: string | null
    createdAt: string
    updatedAt: string
    variables: Record<string, unknown>
    inputs: Array<{
      name: string
      type: string
      description?: string
    }>
  }
}

/** `GET /api/v2/workflows/[id]/executions/[executionId]` */
export type GetWorkflowExecutionParams = {
  id: string
  executionId: string
}

export type GetWorkflowExecutionQuery = {
  includeOutput?: 'true' | 'false'
  selectedOutputs?: string
}

export type GetWorkflowExecutionResponse = {
  data: {
    executionId: string
    workflowId: string
    status: 'queued' | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'
    trigger: string | null
    startedAt: string | null
    endedAt: string | null
    durationMs: number | null
    paused: {
      pausedAt: string
      resumeAt: string | null
      pauseKind: 'time' | 'human' | null
      blockedOnBlockId: string | null
      automaticResumeWaitingReason: string | null
      pausedExecutionId: string
      pausePointCount: number
      resumedCount: number
    } | null
    cost: {
      total: number
    } | null
    error: {
      message: string
      code:
        | 'TIMEOUT'
        | 'CANCELLED'
        | 'USAGE_LIMIT_EXCEEDED'
        | 'INVALID_INPUT'
        | 'BLOCK_EXECUTION_FAILED'
        | 'CHILD_WORKFLOW_FAILED'
        | 'OUTPUT_TOO_LARGE'
        | 'EXECUTION_FAILED'
      blockId?: string
      blockName?: string
      blockType?: string
    } | null
    output: unknown | null
    blockOutputs: Record<string, unknown> | null
  }
}

/** `GET /api/v2/workflows/[id]/versions/[version]` */
export type GetWorkflowVersionParams = {
  id: string
  version: number
}

export type GetWorkflowVersionResponse = {
  data: {
    id: string
    version: number
    name: string | null
    description: string | null
    isActive: boolean
    createdAt: string
    state: unknown
  }
}

/** `POST /api/v2/workflows/import` */
export type ImportWorkflowBody = {
  workspaceId: string
  folderId?: string
  name?: string
  description?: string
  workflow: string | Record<string, unknown>
}

export type ImportWorkflowResponse = {
  data: {
    id: string
    name: string
    description: string | null
    workspaceId: string
    folderId: string | null
    createdAt: string
    updatedAt: string
  }
}

/** `GET /api/v2/audit-logs` */
export type ListAuditLogsQuery = {
  action?: string
  resourceType?: string
  resourceId?: string
  workspaceId?: string
  actorId?: string
  startDate?: string
  endDate?: string
  includeDeparted?: 'true' | 'false'
  limit?: number
  cursor?: string
}

export type ListAuditLogsResponse = {
  data: Array<{
    id: string
    workspaceId: string | null
    actorId: string | null
    actorName: string | null
    actorEmail: string | null
    action: string
    resourceType: string
    resourceId: string | null
    resourceName: string | null
    description: string | null
    metadata: unknown
    createdAt: string
  }>
  nextCursor: string | null
}

/** `GET /api/v2/credentials` */
export type ListCredentialsQuery = {
  workspaceId: string
  type?: 'oauth' | 'env_workspace' | 'env_personal' | 'service_account'
  providerId?: string
  search?: string
  sortBy?: 'displayName' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}

export type ListCredentialsResponse = {
  data: Array<{
    id: string
    type: 'oauth' | 'env_workspace' | 'env_personal' | 'service_account'
    displayName: string
    description: string | null
    providerId: string | null
    accountId: string | null
    envKey: string | null
    hasServiceAccountKey: boolean
    role: 'admin' | 'member'
    createdAt: string
    updatedAt: string
  }>
  nextCursor: string | null
}

/** `GET /api/v2/custom-tools` */
export type ListCustomToolsQuery = {
  workspaceId: string
  search?: string
  sortBy?: 'title' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}

export type ListCustomToolsResponse = {
  data: Array<{
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
  }>
  nextCursor: string | null
}

/** `GET /api/v2/files` */
export type ListFilesQuery = {
  workspaceId: string
  scope?: 'active' | 'archived'
  folderId?: string
  search?: string
  sortBy?: 'name' | 'size' | 'uploadedAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

export type ListFilesResponse = {
  data: Array<{
    id: string
    name: string
    size: number
    type: string
    key: string
    folderId: string | null
    folderPath: string | null
    uploadedBy: string
    uploadedAt: string
    updatedAt: string
  }>
  nextCursor: string | null
}

/** `GET /api/v2/folders` */
export type ListFoldersQuery = {
  workspaceId: string
  resourceType: 'workflow' | 'knowledge_base' | 'table'
  scope?: 'active' | 'archived'
  search?: string
  sortBy?: 'position' | 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}

export type ListFoldersResponse = {
  data: Array<{
    id: string
    resourceType: 'workflow' | 'file' | 'knowledge_base' | 'table'
    name: string
    parentId: string | null
    locked: boolean
    sortOrder: number
    createdAt: string
    updatedAt: string
    deletedAt: string | null
  }>
  nextCursor: string | null
}

/** `GET /api/v2/knowledge` */
export type ListKnowledgeBasesQuery = {
  workspaceId: string
  folderId?: string
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}

export type ListKnowledgeBasesResponse = {
  data: Array<{
    id: string
    name: string
    description: string | null
    tokenCount: number
    embeddingModel: string
    embeddingDimension: number
    chunkingConfig: {
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
    docCount?: number
    connectorTypes?: Array<string>
    createdAt: string
    updatedAt: string
  }>
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
}

export type ListKnowledgeDocumentsResponse = {
  data: Array<{
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
  }>
  nextCursor: string | null
}

/** `GET /api/v2/logs` */
export type ListLogsQuery = {
  workspaceId: string
  workflowIds?: string
  folderIds?: string
  triggers?: string
  level?: 'info' | 'error'
  startDate?: string
  endDate?: string
  executionId?: string
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
  order?: 'desc' | 'asc'
}

export type ListLogsResponse = {
  data: Array<{
    id: string
    workflowId: string | null
    executionId: string
    deploymentVersionId: string | null
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
    traceSpans?: unknown
  }>
  nextCursor: string | null
}

/** `GET /api/v2/mcp-servers` */
export type ListMcpServersQuery = {
  workspaceId: string
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}

export type ListMcpServersResponse = {
  data: Array<{
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
  }>
  nextCursor: string | null
}

/** `GET /api/v2/skills` */
export type ListSkillsQuery = {
  workspaceId: string
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}

export type ListSkillsResponse = {
  data: Array<{
    id: string
    name: string
    description: string
    readOnly: boolean
    createdAt: string
    updatedAt: string
  }>
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

export type ListTableRowsResponse = {
  data: Array<{
    id: string
    data: Record<string, unknown>
    createdAt: string
    updatedAt: string
  }>
  nextCursor: string | null
}

/** `GET /api/v2/tables` */
export type ListTablesQuery = {
  workspaceId: string
  folderId?: string
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

export type ListTablesResponse = {
  data: Array<{
    id: string
    name: string
    description: string | null
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
        currencyCode?: unknown
      }>
    }
    rowCount: number
    maxRows: number
    folderId: string | null
    locks: {
      schemaLocked: boolean
      insertLocked: boolean
      updateLocked: boolean
      deleteLocked: boolean
    }
    job: {
      id: string | null
      type: 'import' | 'delete' | 'export' | 'backfill' | 'update' | null
      status: 'running' | 'ready' | 'failed' | 'canceled'
      rowsProcessed: number
      error: string | null
    } | null
    createdAt: string
    updatedAt: string
  }>
  nextCursor: string | null
}

/** `GET /api/v2/tables/[tableId]/views` */
export type ListTableViewsParams = {
  tableId: string
}

export type ListTableViewsQuery = {
  workspaceId: string
}

type ListTableViewsResponseRef0 =
  | {
      all: Array<
        | ListTableViewsResponseRef0
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
        | ListTableViewsResponseRef0
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

export type ListTableViewsResponse = {
  data: Array<{
    id: string
    tableId: string
    name: string
    config: {
      columnWidths?: Record<string, number>
      columnOrder?: Array<string>
      pinnedColumns?: Array<string>
      hiddenColumns?: Array<string>
      filter?: ListTableViewsResponseRef0 | null
      sort?: Array<{
        field: string
        direction: 'asc' | 'desc'
      }> | null
    }
    isDefault: boolean
    createdBy: string | null
    createdAt: string
    updatedAt: string
  }>
  nextCursor: string | null
}

/** `GET /api/v2/billing/usage/logs` */
export type ListUsageLogsQuery = {
  source?:
    | 'workflow'
    | 'wand'
    | 'copilot'
    | 'workspace-chat'
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

export type ListUsageLogsResponse = {
  data: Array<{
    id: string
    createdAt: string
    source:
      | 'workflow'
      | 'wand'
      | 'copilot'
      | 'workspace-chat'
      | 'mcp_copilot'
      | 'mothership_block'
      | 'knowledge-base'
      | 'voice-input'
      | 'enrichment'
      | 'voice-output'
    workflowName: string | null
    creditCost: number
  }>
  nextCursor: string | null
}

/** `GET /api/v2/tables/[tableId]/groups` */
export type ListWorkflowGroupsParams = {
  tableId: string
}

export type ListWorkflowGroupsQuery = {
  workspaceId: string
}

export type ListWorkflowGroupsResponse = {
  data: Array<{
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
  }>
  nextCursor: string | null
}

/** `GET /api/v2/workflows` */
export type ListWorkflowsQuery = {
  workspaceId: string
  folderId?: string
  deployedOnly?: boolean
  limit?: number
  cursor?: string
  search?: string
  sortBy?: 'position' | 'name' | 'createdAt' | 'updatedAt' | 'runCount'
  sortOrder?: 'asc' | 'desc'
}

export type ListWorkflowsResponse = {
  data: Array<{
    id: string
    name: string
    description: string | null
    folderId: string | null
    workspaceId: string
    isDeployed: boolean
    deployedAt: string | null
    runCount: number
    lastRunAt: string | null
    createdAt: string
    updatedAt: string
  }>
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

export type ListWorkflowVersionsResponse = {
  data: Array<{
    id: string
    version: number
    name?: string | null
    description?: string | null
    isActive: boolean
    createdAt: string
    deployedBy?: string | null
    latestOperationStatus?: 'preparing' | 'activating' | 'active' | 'failed' | 'superseded' | null
  }>
  nextCursor: string | null
}

/** `POST /api/v2/files/move` */
export type MoveFileItemsBody = {
  workspaceId: string
  fileIds?: Array<string>
  folderIds?: Array<string>
  targetFolderId?: string | null
}

export type MoveFileItemsResponse = {
  data: {
    movedItems: {
      files: number
      folders: number
    }
  }
}

/** `POST /api/v2/tables/[tableId]/query` */
export type QueryRowsParams = {
  tableId: string
}

export type QueryRowsBody = {
  workspaceId: string
  predicate?: unknown
  sort?: Array<{
    field: string
    direction: 'asc' | 'desc'
  }>
  limit?: number
  cursor?: string
}

export type QueryRowsResponse = {
  data: Array<{
    id: string
    data: Record<string, unknown>
    createdAt: string
    updatedAt: string
  }>
  nextCursor: string | null
}

/** `PATCH /api/v2/files/[fileId]` */
export type RenameFileParams = {
  fileId: string
}

export type RenameFileBody = {
  workspaceId: string
  name: string
}

export type RenameFileResponse = {
  data: {
    id: string
    name: string
    size: number
    type: string
    key: string
    folderId: string | null
    folderPath: string | null
    uploadedBy: string
    uploadedAt: string
    updatedAt: string
  }
}

/** `POST /api/v2/files/[fileId]/restore` */
export type RestoreFileParams = {
  fileId: string
}

export type RestoreFileBody = {
  workspaceId: string
}

export type RestoreFileResponse = {
  data: {
    id: string
    restored: true
  }
}

/** `POST /api/v2/tables/[tableId]/restore` */
export type RestoreTableParams = {
  tableId: string
}

export type RestoreTableBody = {
  workspaceId: string
}

export type RestoreTableResponse = {
  data: {
    table: {
      id: string
      name: string
      description: string | null
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
          currencyCode?: unknown
        }>
      }
      rowCount: number
      maxRows: number
      folderId: string | null
      locks: {
        schemaLocked: boolean
        insertLocked: boolean
        updateLocked: boolean
        deleteLocked: boolean
      }
      job: {
        id: string | null
        type: 'import' | 'delete' | 'export' | 'backfill' | 'update' | null
        status: 'running' | 'ready' | 'failed' | 'canceled'
        rowsProcessed: number
        error: string | null
      } | null
      createdAt: string
      updatedAt: string
    }
  }
}

/** `POST /api/v2/workflows/[id]/rollback` */
export type RollbackWorkflowParams = {
  id: string
}

export type RollbackWorkflowResponse = {
  data: {
    id: string
    isDeployed: boolean
    deployedAt: string | null
    warnings: Array<string>
    activeDeployment: {
      deploymentVersionId: string
      version: number
      deployedAt: string
    } | null
    latestDeploymentAttempt: {
      id: string
      deploymentVersionId: string
      version: number
      action: 'deploy' | 'activate'
      status: 'preparing' | 'activating' | 'active' | 'failed' | 'superseded'
      isCurrent: boolean
      readiness: {
        webhooks: 'pending' | 'ready' | 'not_applicable'
        schedules: 'pending' | 'ready' | 'not_applicable'
        mcp: 'pending' | 'ready' | 'not_applicable'
      }
      requestedAt: string
      activatedAt?: string | null
      error?: {
        code: string
        message: string
        retryable: boolean
      } | null
    } | null
    version: number
  }
}

/** `POST /api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]` */
export type RunRowEnrichmentParams = {
  tableId: string
  rowId: string
  groupId: string
}

export type RunRowEnrichmentBody = {
  workspaceId: string
}

export type RunRowEnrichmentResponse = {
  data: {
    dispatchId: string | null
  }
}

/** `POST /api/v2/tables/[tableId]/columns/run` */
export type RunTableColumnParams = {
  tableId: string
}

export type RunTableColumnBody = {
  workspaceId: string
  groupIds: Array<string>
  runMode?: 'all' | 'incomplete'
  rowIds?: Array<string>
  filter?: unknown
  excludeRowIds?: Array<string>
  limit?: {
    type: 'rows'
    max: number
  }
}

export type RunTableColumnResponse = {
  data: {
    dispatchId: string | null
  }
}

/** `POST /api/v2/knowledge/search` */
export type SearchKnowledgeBody = {
  workspaceId: string
  knowledgeBaseIds: string | Array<string>
  query?: string
  topK?: number
  tagFilters?: Array<{
    tagName: string
    fieldType?: 'text' | 'number' | 'date' | 'boolean'
    operator?: string
    value: string | number | boolean
    valueTo?: string | number
  }>
  searchMode?: 'vector' | 'hybrid' | null
}

export type SearchKnowledgeResponse = {
  data: {
    results: Array<{
      documentId: string
      documentName: string | null
      sourceUrl: string | null
      content: string
      chunkIndex: number
      metadata: Record<string, unknown>
      similarity: number
    }>
    query: string
    knowledgeBaseIds: Array<string>
    topK: number
    totalResults: number
  }
}

/** `GET /api/v2/tables/exports/[exportId]/download` */
export type TableExportDownloadParams = {
  exportId: string
}

export type TableExportDownloadQuery = {
  workspaceId: string
}

export type TableExportDownloadResponse = {
  data: {
    url: string
    fileName: string
    expiresAt: string
  }
}

/** `DELETE /api/v2/workflows/[id]/deploy` */
export type UndeployWorkflowParams = {
  id: string
}

export type UndeployWorkflowResponse = {
  data: {
    id: string
    isDeployed: boolean
    deployedAt: string | null
    warnings: Array<string>
    activeDeployment: {
      deploymentVersionId: string
      version: number
      deployedAt: string
    } | null
    latestDeploymentAttempt: {
      id: string
      deploymentVersionId: string
      version: number
      action: 'deploy' | 'activate'
      status: 'preparing' | 'activating' | 'active' | 'failed' | 'superseded'
      isCurrent: boolean
      readiness: {
        webhooks: 'pending' | 'ready' | 'not_applicable'
        schedules: 'pending' | 'ready' | 'not_applicable'
        mcp: 'pending' | 'ready' | 'not_applicable'
      }
      requestedAt: string
      activatedAt?: string | null
      error?: {
        code: string
        message: string
        retryable: boolean
      } | null
    } | null
  }
}

/** `PATCH /api/v2/credentials/[id]` */
export type UpdateCredentialParams = {
  id: string
}

export type UpdateCredentialBody = {
  workspaceId: string
  displayName?: string
  description?: string | null
  serviceAccountJson?: string
  signingSecret?: string
  botToken?: string
  apiToken?: string
  domain?: string
  clientId?: string
  clientSecret?: string
  orgId?: string
}

export type UpdateCredentialResponse = {
  data: {
    credential: {
      id: string
      type: 'oauth' | 'env_workspace' | 'env_personal' | 'service_account'
      displayName: string
      description: string | null
      providerId: string | null
      accountId: string | null
      envKey: string | null
      hasServiceAccountKey: boolean
      role: 'admin' | 'member'
      createdAt: string
      updatedAt: string
    }
  }
}

/** `PATCH /api/v2/custom-tools/[id]` */
export type UpdateCustomToolParams = {
  id: string
}

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

export type UpdateCustomToolResponse = {
  data: {
    customTool: {
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
  }
}

/** `PUT /api/v2/files/[fileId]/content` */
export type UpdateFileContentParams = {
  fileId: string
}

export type UpdateFileContentBody = {
  workspaceId: string
  content: string
  encoding?: 'utf-8' | 'base64'
}

export type UpdateFileContentResponse = {
  data: {
    id: string
    name: string
    size: number
    type: string
    key: string
    folderId: string | null
    folderPath: string | null
    uploadedBy: string
    uploadedAt: string
    updatedAt: string
  }
}

/** `PATCH /api/v2/folders/[id]` */
export type UpdateFolderParams = {
  id: string
}

export type UpdateFolderBody = {
  workspaceId: string
  resourceType: 'workflow' | 'knowledge_base' | 'table'
  name?: string
  locked?: boolean
  parentId?: string | null
  sortOrder?: number
}

export type UpdateFolderResponse = {
  data: {
    folder: {
      id: string
      resourceType: 'workflow' | 'file' | 'knowledge_base' | 'table'
      name: string
      parentId: string | null
      locked: boolean
      sortOrder: number
      createdAt: string
      updatedAt: string
      deletedAt: string | null
    }
  }
}

/** `PUT /api/v2/knowledge/[id]` */
export type UpdateKnowledgeBaseParams = {
  id: string
}

export type UpdateKnowledgeBaseBody = {
  workspaceId: string
  name?: string
  description?: string
  chunkingConfig?: {
    maxSize: number
    minSize: number
    overlap: number
  }
}

export type UpdateKnowledgeBaseResponse = {
  data: {
    knowledgeBase: {
      id: string
      name: string
      description: string | null
      tokenCount: number
      embeddingModel: string
      embeddingDimension: number
      chunkingConfig: {
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
      docCount?: number
      connectorTypes?: Array<string>
      createdAt: string
      updatedAt: string
    }
  }
}

/** `PATCH /api/v2/mcp-servers/[id]` */
export type UpdateMcpServerParams = {
  id: string
}

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

export type UpdateMcpServerResponse = {
  data: {
    mcpServer: {
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
  }
}

/** `PUT /api/v2/tables/[tableId]/rows` */
export type UpdateRowsByFilterParams = {
  tableId: string
}

export type UpdateRowsByFilterBody = {
  workspaceId: string
  filter: unknown
  data: unknown
  limit?: number
}

export type UpdateRowsByFilterResponse = {
  data: {
    updatedCount: number
    updatedRowIds: Array<string>
  }
}

/** `PATCH /api/v2/skills/[id]` */
export type UpdateSkillParams = {
  id: string
}

export type UpdateSkillBody = {
  workspaceId: string
  name?: string
  description?: string
  content?: string
}

export type UpdateSkillResponse = {
  data: {
    skill: {
      id: string
      name: string
      description: string
      readOnly: boolean
      createdAt: string
      updatedAt: string
      content: string
    }
  }
}

/** `PATCH /api/v2/tables/[tableId]` */
export type UpdateTableParams = {
  tableId: string
}

export type UpdateTableBody = {
  workspaceId: string
  name?: string
  folderId?: string | null
}

export type UpdateTableResponse = {
  data: {
    table: {
      id: string
      name: string
      description: string | null
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
          currencyCode?: unknown
        }>
      }
      rowCount: number
      maxRows: number
      folderId: string | null
      locks: {
        schemaLocked: boolean
        insertLocked: boolean
        updateLocked: boolean
        deleteLocked: boolean
      }
      job: {
        id: string | null
        type: 'import' | 'delete' | 'export' | 'backfill' | 'update' | null
        status: 'running' | 'ready' | 'failed' | 'canceled'
        rowsProcessed: number
        error: string | null
      } | null
      createdAt: string
      updatedAt: string
    }
  }
}

/** `PATCH /api/v2/tables/[tableId]/columns` */
export type UpdateTableColumnParams = {
  tableId: string
}

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

export type UpdateTableColumnResponse = {
  data: {
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
      currencyCode?: unknown
    }>
  }
}

/** `PATCH /api/v2/tables/[tableId]/rows/[rowId]` */
export type UpdateTableRowParams = {
  tableId: string
  rowId: string
}

export type UpdateTableRowBody = {
  workspaceId: string
  data: unknown
}

export type UpdateTableRowResponse = {
  data: {
    row: {
      id: string
      data: Record<string, unknown>
      createdAt: string
      updatedAt: string
    }
  }
}

/** `PATCH /api/v2/tables/[tableId]/views/[viewId]` */
export type UpdateTableViewParams = {
  tableId: string
  viewId: string
}

export type UpdateTableViewBody = {
  workspaceId: string
  name?: string
  config?: {
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
  configPatch?: {
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
  isDefault?: boolean
}

type UpdateTableViewResponseRef0 =
  | {
      all: Array<
        | UpdateTableViewResponseRef0
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
        | UpdateTableViewResponseRef0
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

export type UpdateTableViewResponse = {
  data: {
    view: {
      id: string
      tableId: string
      name: string
      config: {
        columnWidths?: Record<string, number>
        columnOrder?: Array<string>
        pinnedColumns?: Array<string>
        hiddenColumns?: Array<string>
        filter?: UpdateTableViewResponseRef0 | null
        sort?: Array<{
          field: string
          direction: 'asc' | 'desc'
        }> | null
      }
      isDefault: boolean
      createdBy: string | null
      createdAt: string
      updatedAt: string
    }
  }
}

/** `PATCH /api/v2/workflows/[id]` */
export type UpdateWorkflowParams = {
  id: string
}

export type UpdateWorkflowBody = {
  name?: string
  description?: string | null
  folderId?: string | null
}

export type UpdateWorkflowResponse = {
  data: {
    id: string
    name: string
    description: string | null
    folderId: string | null
    workspaceId: string
    isDeployed: boolean
    deployedAt: string | null
    runCount: number
    lastRunAt: string | null
    createdAt: string
    updatedAt: string
  }
}

/** `PATCH /api/v2/tables/[tableId]/groups` */
export type UpdateWorkflowGroupParams = {
  tableId: string
}

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

export type UpdateWorkflowGroupResponse = {
  data: {
    group: {
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
      currencyCode?: unknown
    }>
  }
}

/** `POST /api/v2/knowledge/[id]/documents` */
export type UploadKnowledgeDocumentParams = {
  id: string
}

export type UploadKnowledgeDocumentQuery = {
  workspaceId: string
}

export type UploadKnowledgeDocumentResponse = {
  data: {
    document: {
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
  }
}

/** `PUT /api/v2/files/[fileId]/share` */
export type UpsertFileShareParams = {
  fileId: string
}

export type UpsertFileShareBody = {
  workspaceId: string
  isActive: boolean
  authType?: 'public' | 'password' | 'email' | 'sso'
  password?: string
  allowedEmails?: Array<string>
}

export type UpsertFileShareResponse = {
  data: {
    share: {
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
  }
}

/** `POST /api/v2/tables/[tableId]/rows/upsert` */
export type UpsertTableRowParams = {
  tableId: string
}

export type UpsertTableRowBody = {
  workspaceId: string
  data: unknown
  conflictTarget?: string
}

export type UpsertTableRowResponse = {
  data: {
    row: {
      id: string
      data: Record<string, unknown>
      createdAt: string
      updatedAt: string
    }
    operation: 'insert' | 'update'
  }
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
  bulkArchiveFileItems: {
    method: 'POST',
    path: '/api/v2/files/bulk-archive',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Archive Files and Folders',
    body: {
      workspaceId: { kind: 'string', required: true },
      fileIds: { kind: 'array', default: [] },
      folderIds: { kind: 'array', default: [] },
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
  cancelWorkflowExecution: {
    method: 'POST',
    path: '/api/v2/workflows/[id]/executions/[executionId]/cancel',
    pathParams: ['id', 'executionId'] as const,
    responseMode: 'json',
    summary: 'Cancel an execution',
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
    body: {
      parts: { kind: 'array', required: true },
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
    body: {
      parts: { kind: 'array', required: true },
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
    body: {
      parts: { kind: 'array', required: true },
    },
  },
  createCredential: {
    method: 'POST',
    path: '/api/v2/credentials',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Credential',
    body: {
      workspaceId: { kind: 'string', required: true },
      type: {
        kind: 'enum',
        required: true,
        values: ['env_workspace', 'env_personal', 'service_account'] as const,
      },
      displayName: { kind: 'string' },
      description: { kind: 'string' },
      providerId: { kind: 'string' },
      envKey: { kind: 'string' },
      serviceAccountJson: { kind: 'string' },
      signingSecret: { kind: 'string' },
      botToken: { kind: 'string' },
      apiToken: { kind: 'string' },
      domain: { kind: 'string' },
      clientId: { kind: 'string' },
      clientSecret: { kind: 'string' },
      orgId: { kind: 'string' },
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
      folderId: { kind: 'string' },
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
  createFolder: {
    method: 'POST',
    path: '/api/v2/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Folder',
    body: {
      workspaceId: { kind: 'string', required: true },
      resourceType: {
        kind: 'enum',
        required: true,
        values: ['workflow', 'knowledge_base', 'table'] as const,
      },
      name: { kind: 'string', required: true },
      parentId: { kind: 'string' },
      sortOrder: { kind: 'integer' },
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
      chunkingConfig: { kind: 'object', default: { maxSize: 1024, minSize: 100, overlap: 200 } },
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
      transport: { kind: 'enum', values: ['streamable-http'] as const },
      url: { kind: 'string', required: true },
      authType: { kind: 'enum', values: ['none', 'headers', 'oauth'] as const },
      headers: { kind: 'object' },
      timeout: { kind: 'integer' },
      retries: { kind: 'integer' },
      enabled: { kind: 'boolean' },
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
      schema: { kind: 'object', required: true },
      workspaceId: { kind: 'string', required: true },
      folderId: { kind: 'string' },
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
      mapping: { kind: 'unknown' },
      createColumns: { kind: 'unknown' },
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
      folderId: { kind: 'string' },
    },
  },
  deleteCredential: {
    method: 'DELETE',
    path: '/api/v2/credentials/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Delete Credential',
    query: {
      workspaceId: { kind: 'string', required: true },
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
  deleteFolder: {
    method: 'DELETE',
    path: '/api/v2/folders/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Delete Folder',
    query: {
      workspaceId: { kind: 'string', required: true },
      resourceType: {
        kind: 'enum',
        required: true,
        values: ['workflow', 'knowledge_base', 'table'] as const,
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
    summary: 'Execute a workflow',
    body: {
      input: { kind: 'object' },
      async: { kind: 'boolean', default: false },
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
    summary: 'Export a workflow',
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
  },
  getCredential: {
    method: 'GET',
    path: '/api/v2/credentials/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Get Credential',
    query: {
      workspaceId: { kind: 'string', required: true },
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
  getExecution: {
    method: 'GET',
    path: '/api/v2/logs/executions/[executionId]',
    pathParams: ['executionId'] as const,
    responseMode: 'json',
    summary: 'Get Execution',
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
  getFolder: {
    method: 'GET',
    path: '/api/v2/folders/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Get Folder',
    query: {
      workspaceId: { kind: 'string', required: true },
      resourceType: {
        kind: 'enum',
        required: true,
        values: ['workflow', 'knowledge_base', 'table'] as const,
      },
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
    path: '/api/v2/logs/[id]',
    pathParams: ['id'] as const,
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
  getUsageSummary: {
    method: 'GET',
    path: '/api/v2/billing/usage',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Get Usage Summary',
    query: {
      workspaceId: { kind: 'string' },
    },
  },
  getWorkflow: {
    method: 'GET',
    path: '/api/v2/workflows/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Get Workflow',
  },
  getWorkflowExecution: {
    method: 'GET',
    path: '/api/v2/workflows/[id]/executions/[executionId]',
    pathParams: ['id', 'executionId'] as const,
    responseMode: 'json',
    summary: 'Get execution status',
    query: {
      includeOutput: { kind: 'enum', values: ['true', 'false'] as const },
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
  importWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/import',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Import a workflow',
    body: {
      workspaceId: { kind: 'string', required: true },
      folderId: { kind: 'string' },
      name: { kind: 'string' },
      description: { kind: 'string' },
      workflow: { kind: 'unknown', required: true },
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
      actorId: { kind: 'string' },
      startDate: { kind: 'string' },
      endDate: { kind: 'string' },
      includeDeparted: { kind: 'enum', values: ['true', 'false'] as const },
      limit: { kind: 'number', default: 50 },
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
      type: {
        kind: 'enum',
        values: ['oauth', 'env_workspace', 'env_personal', 'service_account'] as const,
      },
      providerId: { kind: 'string' },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['displayName', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'desc' },
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
      scope: { kind: 'enum', values: ['active', 'archived'] as const, default: 'active' },
      folderId: { kind: 'string' },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['name', 'size', 'uploadedAt', 'updatedAt'] as const,
        default: 'uploadedAt',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'asc' },
      limit: { kind: 'number', default: 100 },
      cursor: { kind: 'string' },
    },
  },
  listFolders: {
    method: 'GET',
    path: '/api/v2/folders',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Folders',
    query: {
      workspaceId: { kind: 'string', required: true },
      resourceType: {
        kind: 'enum',
        required: true,
        values: ['workflow', 'knowledge_base', 'table'] as const,
      },
      scope: { kind: 'enum', values: ['active', 'archived'] as const, default: 'active' },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['position', 'name', 'createdAt', 'updatedAt'] as const,
        default: 'position',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'asc' },
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
      folderId: { kind: 'string' },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'asc' },
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
      folderIds: { kind: 'string' },
      triggers: { kind: 'string' },
      level: { kind: 'enum', values: ['info', 'error'] as const },
      startDate: { kind: 'string' },
      endDate: { kind: 'string' },
      executionId: { kind: 'string' },
      minDurationMs: { kind: 'number' },
      maxDurationMs: { kind: 'number' },
      minCost: { kind: 'number' },
      maxCost: { kind: 'number' },
      model: { kind: 'string' },
      details: { kind: 'enum', values: ['basic', 'full'] as const, default: 'basic' },
      includeTraceSpans: { kind: 'boolean' },
      includeFinalOutput: { kind: 'boolean' },
      limit: { kind: 'number', default: 100 },
      cursor: { kind: 'string' },
      order: { kind: 'enum', values: ['desc', 'asc'] as const, default: 'desc' },
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
    },
  },
  listTableRows: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/rows',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'List rows',
    query: {
      workspaceId: { kind: 'string', required: true },
      limit: { kind: 'integer' },
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
      folderId: { kind: 'string' },
      search: { kind: 'string' },
      sortBy: {
        kind: 'enum',
        values: ['name', 'createdAt', 'updatedAt'] as const,
        default: 'createdAt',
      },
      sortOrder: { kind: 'enum', values: ['asc', 'desc'] as const, default: 'asc' },
      limit: { kind: 'number', default: 100 },
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
  listUsageLogs: {
    method: 'GET',
    path: '/api/v2/billing/usage/logs',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Usage Logs',
    query: {
      source: {
        kind: 'enum',
        values: [
          'workflow',
          'wand',
          'copilot',
          'workspace-chat',
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
  listWorkflows: {
    method: 'GET',
    path: '/api/v2/workflows',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Workflows',
    query: {
      workspaceId: { kind: 'string', required: true },
      folderId: { kind: 'string' },
      deployedOnly: { kind: 'boolean' },
      limit: { kind: 'number', default: 50 },
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
  moveFileItems: {
    method: 'POST',
    path: '/api/v2/files/move',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Move Files and Folders',
    body: {
      workspaceId: { kind: 'string', required: true },
      fileIds: { kind: 'array', default: [] },
      folderIds: { kind: 'array', default: [] },
      targetFolderId: { kind: 'string' },
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
  restoreTable: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/restore',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Restore Table',
    body: {
      workspaceId: { kind: 'string', required: true },
    },
  },
  rollbackWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[id]/rollback',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Rollback Workflow',
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
  updateCredential: {
    method: 'PATCH',
    path: '/api/v2/credentials/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Update Credential',
    body: {
      workspaceId: { kind: 'string', required: true },
      displayName: { kind: 'string' },
      description: { kind: 'string' },
      serviceAccountJson: { kind: 'string' },
      signingSecret: { kind: 'string' },
      botToken: { kind: 'string' },
      apiToken: { kind: 'string' },
      domain: { kind: 'string' },
      clientId: { kind: 'string' },
      clientSecret: { kind: 'string' },
      orgId: { kind: 'string' },
    },
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
  updateFolder: {
    method: 'PATCH',
    path: '/api/v2/folders/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Update Folder',
    body: {
      workspaceId: { kind: 'string', required: true },
      resourceType: {
        kind: 'enum',
        required: true,
        values: ['workflow', 'knowledge_base', 'table'] as const,
      },
      name: { kind: 'string' },
      locked: { kind: 'boolean' },
      parentId: { kind: 'string' },
      sortOrder: { kind: 'integer' },
    },
  },
  updateKnowledgeBase: {
    method: 'PUT',
    path: '/api/v2/knowledge/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
    summary: 'Update Knowledge Base',
    body: {
      workspaceId: { kind: 'string', required: true },
      name: { kind: 'string' },
      description: { kind: 'string' },
      chunkingConfig: { kind: 'object' },
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
      transport: { kind: 'enum', values: ['streamable-http'] as const },
      url: { kind: 'string' },
      authType: { kind: 'enum', values: ['none', 'headers', 'oauth'] as const },
      headers: { kind: 'object' },
      timeout: { kind: 'integer' },
      retries: { kind: 'integer' },
      enabled: { kind: 'boolean' },
      oauthClientId: { kind: 'string' },
      oauthClientSecret: { kind: 'string' },
    },
  },
  updateRowsByFilter: {
    method: 'PUT',
    path: '/api/v2/tables/[tableId]/rows',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
    summary: 'Update Rows by Filter',
    body: {
      workspaceId: { kind: 'string', required: true },
      filter: { kind: 'unknown', required: true },
      data: { kind: 'unknown', required: true },
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
      folderId: { kind: 'string' },
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
      data: { kind: 'unknown', required: true },
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
      folderId: { kind: 'string' },
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
    method: 'PUT',
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
      data: { kind: 'unknown', required: true },
      conflictTarget: { kind: 'string' },
    },
  },
} as const

export type V2OperationName = keyof typeof V2_OPERATIONS
