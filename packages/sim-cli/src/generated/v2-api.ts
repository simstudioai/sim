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

/** `POST /api/v2/tables/[tableId]/columns` */
export type AddTableColumnParams = {
  tableId: string
}

export type AddTableColumnBody = {
  workspaceId: string
  column: {
    id?: string
    name: string
    type: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'select'
    required?: boolean
    unique?: boolean
    position?: number
    options?: Array<{
      id: string
      name: string
    }>
    multiple?: boolean
  }
}

export type AddTableColumnResponse = {
  data: {
    columns: Array<{
      id?: string
      name: string
      type: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'select'
      required: boolean
      unique: boolean
      workflowGroupId?: string
      options?: Array<{
        id: string
        name: string
      }>
      multiple?: boolean
    }>
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

/** `POST /api/v2/tables` */
export type CreateTableBody = {
  name: string
  description?: string
  schema: {
    columns: Array<{
      id?: string
      name: string
      type: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'select'
      required?: boolean
      unique?: boolean
      workflowGroupId?: string
      options?: Array<{
        id: string
        name: string
      }>
      multiple?: boolean
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
          type: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'select'
          required: boolean
          unique: boolean
          workflowGroupId?: string
          options?: Array<{
            id: string
            name: string
          }>
          multiple?: boolean
        }>
      }
      rowCount: number
      maxRows: number
      createdAt: string
      updatedAt: string
    }
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
      type: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'select'
      required: boolean
      unique: boolean
      workflowGroupId?: string
      options?: Array<{
        id: string
        name: string
      }>
      multiple?: boolean
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
          type: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'select'
          required: boolean
          unique: boolean
          workflowGroupId?: string
          options?: Array<{
            id: string
            name: string
          }>
          multiple?: boolean
        }>
      }
      rowCount: number
      maxRows: number
      createdAt: string
      updatedAt: string
    }
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

/** `GET /api/v2/files` */
export type ListFilesQuery = {
  workspaceId: string
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
    uploadedBy: string
    uploadedAt: string
  }>
  nextCursor: string | null
}

/** `GET /api/v2/knowledge` */
export type ListKnowledgeBasesQuery = {
  workspaceId: string
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
        type: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'select'
        required: boolean
        unique: boolean
        workflowGroupId?: string
        options?: Array<{
          id: string
          name: string
        }>
        multiple?: boolean
      }>
    }
    rowCount: number
    maxRows: number
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
    workflowName: string | null
    creditCost: number
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

/** `PATCH /api/v2/tables/[tableId]/columns` */
export type UpdateTableColumnParams = {
  tableId: string
}

export type UpdateTableColumnBody = {
  workspaceId: string
  columnName: string
  updates: {
    name?: string
    type?: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'select'
    required?: boolean
    unique?: boolean
    options?: Array<{
      id: string
      name: string
    }>
    multiple?: boolean
  }
}

export type UpdateTableColumnResponse = {
  data: {
    columns: Array<{
      id?: string
      name: string
      type: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'select'
      required: boolean
      unique: boolean
      workflowGroupId?: string
      options?: Array<{
        id: string
        name: string
      }>
      multiple?: boolean
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

/** `POST /api/v2/files` */
export type UploadFileQuery = {
  workspaceId: string
}

export type UploadFileResponse = {
  data: {
    id: string
    name: string
    size: number
    type: string
    key: string
    uploadedBy: string
    uploadedAt: string
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

/** Every v2 operation, keyed by name. */
export const V2_OPERATIONS = {
  addTableColumn: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/columns',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
  },
  cancelWorkflowExecution: {
    method: 'POST',
    path: '/api/v2/workflows/[id]/executions/[executionId]/cancel',
    pathParams: ['id', 'executionId'] as const,
    responseMode: 'json',
  },
  createKnowledgeBase: {
    method: 'POST',
    path: '/api/v2/knowledge',
    pathParams: [] as const,
    responseMode: 'json',
  },
  createTable: {
    method: 'POST',
    path: '/api/v2/tables',
    pathParams: [] as const,
    responseMode: 'json',
  },
  createTableRows: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/rows',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
  },
  deleteFile: {
    method: 'DELETE',
    path: '/api/v2/files/[fileId]',
    pathParams: ['fileId'] as const,
    responseMode: 'json',
  },
  deleteKnowledgeBase: {
    method: 'DELETE',
    path: '/api/v2/knowledge/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
  },
  deleteKnowledgeDocument: {
    method: 'DELETE',
    path: '/api/v2/knowledge/[id]/documents/[documentId]',
    pathParams: ['id', 'documentId'] as const,
    responseMode: 'json',
  },
  deleteTable: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
  },
  deleteTableColumn: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]/columns',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
  },
  deleteTableRow: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]/rows/[rowId]',
    pathParams: ['tableId', 'rowId'] as const,
    responseMode: 'json',
  },
  deleteTableRows: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]/rows',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
  },
  deployWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[id]/deploy',
    pathParams: ['id'] as const,
    responseMode: 'json',
  },
  downloadFile: {
    method: 'GET',
    path: '/api/v2/files/[fileId]',
    pathParams: ['fileId'] as const,
    responseMode: 'binary',
  },
  executeWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[id]/execute',
    pathParams: ['id'] as const,
    responseMode: 'json',
  },
  exportWorkflow: {
    method: 'GET',
    path: '/api/v2/workflows/[id]/export',
    pathParams: ['id'] as const,
    responseMode: 'json',
  },
  getAuditLog: {
    method: 'GET',
    path: '/api/v2/audit-logs/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
  },
  getExecution: {
    method: 'GET',
    path: '/api/v2/logs/executions/[executionId]',
    pathParams: ['executionId'] as const,
    responseMode: 'json',
  },
  getKnowledgeBase: {
    method: 'GET',
    path: '/api/v2/knowledge/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
  },
  getKnowledgeDocument: {
    method: 'GET',
    path: '/api/v2/knowledge/[id]/documents/[documentId]',
    pathParams: ['id', 'documentId'] as const,
    responseMode: 'json',
  },
  getLog: {
    method: 'GET',
    path: '/api/v2/logs/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
  },
  getTable: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
  },
  getTableRow: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/rows/[rowId]',
    pathParams: ['tableId', 'rowId'] as const,
    responseMode: 'json',
  },
  getUsageSummary: {
    method: 'GET',
    path: '/api/v2/billing/usage',
    pathParams: [] as const,
    responseMode: 'json',
  },
  getWorkflow: {
    method: 'GET',
    path: '/api/v2/workflows/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
  },
  getWorkflowExecution: {
    method: 'GET',
    path: '/api/v2/workflows/[id]/executions/[executionId]',
    pathParams: ['id', 'executionId'] as const,
    responseMode: 'json',
  },
  importWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/import',
    pathParams: [] as const,
    responseMode: 'json',
  },
  listAuditLogs: {
    method: 'GET',
    path: '/api/v2/audit-logs',
    pathParams: [] as const,
    responseMode: 'json',
  },
  listFiles: {
    method: 'GET',
    path: '/api/v2/files',
    pathParams: [] as const,
    responseMode: 'json',
  },
  listKnowledgeBases: {
    method: 'GET',
    path: '/api/v2/knowledge',
    pathParams: [] as const,
    responseMode: 'json',
  },
  listKnowledgeDocuments: {
    method: 'GET',
    path: '/api/v2/knowledge/[id]/documents',
    pathParams: ['id'] as const,
    responseMode: 'json',
  },
  listLogs: {
    method: 'GET',
    path: '/api/v2/logs',
    pathParams: [] as const,
    responseMode: 'json',
  },
  listTableRows: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/rows',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
  },
  listTables: {
    method: 'GET',
    path: '/api/v2/tables',
    pathParams: [] as const,
    responseMode: 'json',
  },
  listUsageLogs: {
    method: 'GET',
    path: '/api/v2/billing/usage/logs',
    pathParams: [] as const,
    responseMode: 'json',
  },
  listWorkflows: {
    method: 'GET',
    path: '/api/v2/workflows',
    pathParams: [] as const,
    responseMode: 'json',
  },
  queryRows: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/query',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
  },
  rollbackWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[id]/rollback',
    pathParams: ['id'] as const,
    responseMode: 'json',
  },
  searchKnowledge: {
    method: 'POST',
    path: '/api/v2/knowledge/search',
    pathParams: [] as const,
    responseMode: 'json',
  },
  undeployWorkflow: {
    method: 'DELETE',
    path: '/api/v2/workflows/[id]/deploy',
    pathParams: ['id'] as const,
    responseMode: 'json',
  },
  updateKnowledgeBase: {
    method: 'PUT',
    path: '/api/v2/knowledge/[id]',
    pathParams: ['id'] as const,
    responseMode: 'json',
  },
  updateRowsByFilter: {
    method: 'PUT',
    path: '/api/v2/tables/[tableId]/rows',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
  },
  updateTableColumn: {
    method: 'PATCH',
    path: '/api/v2/tables/[tableId]/columns',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
  },
  updateTableRow: {
    method: 'PATCH',
    path: '/api/v2/tables/[tableId]/rows/[rowId]',
    pathParams: ['tableId', 'rowId'] as const,
    responseMode: 'json',
  },
  uploadFile: {
    method: 'POST',
    path: '/api/v2/files',
    pathParams: [] as const,
    responseMode: 'json',
  },
  uploadKnowledgeDocument: {
    method: 'POST',
    path: '/api/v2/knowledge/[id]/documents',
    pathParams: ['id'] as const,
    responseMode: 'json',
  },
  upsertTableRow: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/rows/upsert',
    pathParams: ['tableId'] as const,
    responseMode: 'json',
  },
} as const

export type V2OperationName = keyof typeof V2_OPERATIONS
