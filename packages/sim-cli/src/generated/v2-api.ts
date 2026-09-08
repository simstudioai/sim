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
  webUrl: string
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

/** `DELETE /api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]` */
export type AbortKnowledgeDocumentUploadParams = {
  knowledgeBaseId: string
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

/** `POST /api/v2/workflows/[workflowId]/versions/[version]/activate` */
export type ActivateWorkflowVersionParams = {
  version: number
  workflowId: string
}

export type ActivateWorkflowVersionQuery = Record<string, unknown>

export type ActivateWorkflowVersionBody = Record<string, unknown>

type ActivateWorkflowVersionResponseRef0 = {
  deploymentVersionId: string
  version: number
  deployedAt: string
}

type ActivateWorkflowVersionResponseRef1 = {
  id: string
  deploymentVersionId: string
  version: number
  action: 'deploy' | 'activate'
  status: 'preparing' | 'activating' | 'active' | 'failed' | 'superseded'
  isCurrent: boolean
  readiness: ActivateWorkflowVersionResponseRef2
  requestedAt: string
  activatedAt?: string | null
  error?: ActivateWorkflowVersionResponseRef3 | null
}

type ActivateWorkflowVersionResponseRef2 = {
  webhooks: 'pending' | 'ready' | 'not_applicable'
  schedules: 'pending' | 'ready' | 'not_applicable'
  mcp: 'pending' | 'ready' | 'not_applicable'
}

type ActivateWorkflowVersionResponseRef3 = {
  code: string
  message: string
  retryable: boolean
}

type ActivateWorkflowVersionResponseRef4 = ActivateWorkflowVersionResponseRef5

type ActivateWorkflowVersionResponseRef5 = {
  id: string
  isDeployed: boolean
  deployedAt: string | null
  warnings: Array<string>
  activeDeployment: ActivateWorkflowVersionResponseRef0 | null
  latestDeploymentAttempt: ActivateWorkflowVersionResponseRef1 | null
  version: number
}

export type ActivateWorkflowVersionResponse = {
  data: ActivateWorkflowVersionResponseRef4
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
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'ttl' | 'json' | 'select'
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
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'ttl' | 'json' | 'select'
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
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'ttl' | 'json' | 'select'
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
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'ttl' | 'json' | 'select'
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

/** `POST /api/v2/knowledge/[knowledgeBaseId]/documents/from-workspace-files` */
export type AddWorkspaceFilesToKnowledgeBaseParams = {
  knowledgeBaseId: string
}

export type AddWorkspaceFilesToKnowledgeBaseQuery = Record<string, unknown>

export type AddWorkspaceFilesToKnowledgeBaseBody = {
  workspaceId: string
  fileReferences: Array<string>
}

type AddWorkspaceFilesToKnowledgeBaseResponseRef0 = {
  documentId: string
  filename: string
  mimeType: string
  fileSize: number
}

type AddWorkspaceFilesToKnowledgeBaseResponseRef1 = {
  knowledgeBaseId: string
  added: Array<AddWorkspaceFilesToKnowledgeBaseResponseRef0>
  failed: Array<string>
}

export type AddWorkspaceFilesToKnowledgeBaseResponse = {
  data: AddWorkspaceFilesToKnowledgeBaseResponseRef1
}

/** `POST /api/v2/workflows/[workflowId]/operations` */
export type ApplyWorkflowOperationsParams = {
  workflowId: string
}

export type ApplyWorkflowOperationsQuery = {
  dryRun?: boolean
}

type ApplyWorkflowOperationsBodyRef0 =
  | {
      operation_type: 'add'
      block_id: string
      params: {
        type: string
        name: string
        inputs?: {
          tools?: ApplyWorkflowOperationsBodyRef1
        } & Record<string, unknown>
      }
    }
  | {
      operation_type: 'edit'
      block_id: string
      params: {
        inputs?: {
          tools?: ApplyWorkflowOperationsBodyRef1
        } & Record<string, unknown>
      } & Record<string, unknown>
    }
  | {
      operation_type: 'delete'
      block_id: string
    }
  | {
      operation_type: 'insert_into_subflow'
      block_id: string
      params: {
        subflowId: string
        type: string
        name: string
        inputs?: {
          tools?: ApplyWorkflowOperationsBodyRef1
        } & Record<string, unknown>
      }
    }
  | {
      operation_type: 'extract_from_subflow'
      block_id: string
      params: {
        subflowId: string
      }
    }

type ApplyWorkflowOperationsBodyRef1 = Array<ApplyWorkflowOperationsBodyRef2>

type ApplyWorkflowOperationsBodyRef2 =
  | ApplyWorkflowOperationsBodyRef3
  | ApplyWorkflowOperationsBodyRef4
  | ApplyWorkflowOperationsBodyRef5
  | ApplyWorkflowOperationsBodyRef6

type ApplyWorkflowOperationsBodyRef3 = {
  type: string
  operation?: string
  usageControl?: 'auto' | 'force' | 'none'
  params?: Record<string, unknown>
}

type ApplyWorkflowOperationsBodyRef4 =
  | {
      type: 'custom-tool'
      customToolId: string
      usageControl?: 'auto' | 'force' | 'none'
    }
  | {
      type: 'custom-tool'
      schema: {
        type?: 'function'
        function: {
          name: string
          description?: string
          parameters: Record<string, unknown>
        }
      }
      code: string
      usageControl?: 'auto' | 'force' | 'none'
    }

type ApplyWorkflowOperationsBodyRef5 = {
  type: 'mcp'
  params: {
    serverId: string
    toolName: string
  } & Record<string, unknown>
  usageControl?: 'auto' | 'force' | 'none'
}

type ApplyWorkflowOperationsBodyRef6 = {
  type: 'mcp-server-advanced'
  params: {
    serverId: string
  }
  usageControl?: 'auto' | 'force' | 'none'
}

export type ApplyWorkflowOperationsBody = {
  operations: Array<ApplyWorkflowOperationsBodyRef0>
  atomic?: boolean
  layout?: 'targeted' | 'none'
  setBlockEnabled?: Array<{
    block_id: string
    enabled: boolean
  }>
}

type ApplyWorkflowOperationsResponseRef0 = {
  type:
    | 'block_not_found'
    | 'invalid_block_type'
    | 'block_not_allowed'
    | 'model_not_allowed'
    | 'block_locked'
    | 'tool_not_allowed'
    | 'invalid_edge_target'
    | 'invalid_edge_source'
    | 'invalid_edge_scope'
    | 'invalid_source_handle'
    | 'invalid_target_handle'
    | 'invalid_subblock_field'
    | 'missing_required_params'
    | 'invalid_subflow_parent'
    | 'nested_subflow_not_allowed'
    | 'duplicate_block_name'
    | 'reserved_block_name'
    | 'retry_not_supported'
    | 'duplicate_trigger'
    | 'duplicate_single_instance_block'
    | 'disabled_ancestor'
  operationType: string
  blockId: string
  reason: string
  details?: Record<string, unknown>
}

type ApplyWorkflowOperationsResponseRef1 = {
  blockId: string
  blockType: string
  field: string
  error: string
}

type ApplyWorkflowOperationsResponseRef2 = {
  sources: Array<{
    blockId: string
    blockName: string | null
    blockType: string | null
  }>
  sinks: Array<{
    blockId: string
    blockName: string | null
    blockType: string | null
  }>
  orphanBlocks: Array<{
    blockId: string
    blockName: string | null
    blockType: string | null
  }>
  emptyOutgoingPorts: Array<{
    blockId: string
    blockName: string | null
    blockType: string | null
    handle: string
    label: string
  }>
  invalidBranchPorts: Array<{
    blockId: string
    blockName: string | null
    blockType: string | null
    sourceHandle: string
    reason: string
  }>
  invalidConnectionTargets: Array<{
    sourceBlockId: string
    sourceBlockName: string | null
    sourceHandle: string | null
    targetBlockId: string
    reason: string
  }>
  fieldIssues: Array<{
    blockId: string
    blockName: string | null
    blockType: string | null
    missingRequiredFields: Array<string>
    inactiveModeValues: Array<{
      canonicalId: string
      activeMemberId: string | null
      inactiveMemberId: string
      kind: 'credential' | 'resource' | 'other'
    }>
  }>
  unresolvedReferences: Array<{
    blockId: string
    blockName: string | null
    blockType: string | null
    field: string
    value: string | Array<string>
    kind: 'credential' | 'resource' | 'custom-tool' | 'mcp-tool' | 'skill'
    reason: string
  }>
  notes: Array<string>
}

type ApplyWorkflowOperationsResponseRef3 = {
  id: string
  warnings: Array<string>
  needsRedeployment: boolean
  applied: number
  skipped: Array<ApplyWorkflowOperationsResponseRef0>
  deferred: Array<ApplyWorkflowOperationsResponseRef0>
  inputValidationErrors: Array<ApplyWorkflowOperationsResponseRef1>
  mintedBlockIds: Record<string, string>
  lint: ApplyWorkflowOperationsResponseRef2
  dryRun: boolean
}

export type ApplyWorkflowOperationsResponse = {
  data: ApplyWorkflowOperationsResponseRef3
}

/** `PATCH /api/v2/workflows/[workflowId]/variables` */
export type ApplyWorkflowVariablesParams = {
  workflowId: string
}

export type ApplyWorkflowVariablesQuery = Record<string, unknown>

export type ApplyWorkflowVariablesBody = {
  operations: Array<
    | {
        operation: 'add'
        name: string
        type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'plain'
        value: unknown
      }
    | {
        operation: 'edit'
        name: string
        type?: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'plain'
        value: unknown
      }
    | {
        operation: 'delete'
        name: string
      }
  >
}

type ApplyWorkflowVariablesResponseRef0 = {
  id: string
  variableCount: number
  changed: boolean
}

export type ApplyWorkflowVariablesResponse = {
  data: ApplyWorkflowVariablesResponseRef0
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

/** `POST /api/v2/tables/bulk-delete` */
export type BulkDeleteTablesQuery = Record<string, unknown>

type BulkDeleteTablesBodyRef0 = string

export type BulkDeleteTablesBody = {
  workspaceId: string
  tableIds?: Array<string>
  folderPaths?: Array<BulkDeleteTablesBodyRef0>
}

type BulkDeleteTablesResponseRef0 = {
  deleted: Array<{
    kind: 'table' | 'folder'
    id: string
    name: string
  }>
  skipped: Array<{
    kind: 'table' | 'folder'
    id: string
    name: string
  }>
  notFound: Array<{
    kind: 'table' | 'folder'
    id: string
  }>
  failed: Array<{
    kind: 'table' | 'folder'
    id: string
    name: string
    reason: string
  }>
  deletedItems: {
    tables: number
    folders: number
  }
}

export type BulkDeleteTablesResponse = {
  data: BulkDeleteTablesResponseRef0
}

/** `GET /api/v2/files/bulk-download` */
export type BulkDownloadFilesQuery = {
  workspaceId: string
  fileIds?: string
  folderPaths?: string
}

/** Non-JSON response (`binary`). */
export type BulkDownloadFilesResponse = never

/** `PUT /api/v2/knowledge/[knowledgeBaseId]/tags` */
export type BulkSaveKnowledgeTagDefinitionsParams = {
  knowledgeBaseId: string
}

export type BulkSaveKnowledgeTagDefinitionsQuery = Record<string, unknown>

type BulkSaveKnowledgeTagDefinitionsBodyRef0 = {
  tagSlot:
    | 'tag1'
    | 'tag2'
    | 'tag3'
    | 'tag4'
    | 'tag5'
    | 'tag6'
    | 'tag7'
    | 'number1'
    | 'number2'
    | 'number3'
    | 'number4'
    | 'number5'
    | 'date1'
    | 'date2'
    | 'boolean1'
    | 'boolean2'
    | 'boolean3'
  displayName: string
  fieldType: 'text' | 'number' | 'date' | 'boolean'
  originalDisplayName?: string
}

export type BulkSaveKnowledgeTagDefinitionsBody = {
  workspaceId: string
  definitions: Array<BulkSaveKnowledgeTagDefinitionsBodyRef0>
}

type BulkSaveKnowledgeTagDefinitionsResponseRef0 = {
  id: string
  displayName: string
  tagSlot: string
  fieldType: string
}

type BulkSaveKnowledgeTagDefinitionsResponseRef1 = {
  created: Array<BulkSaveKnowledgeTagDefinitionsResponseRef0>
  updated: Array<BulkSaveKnowledgeTagDefinitionsResponseRef0>
  errors: Array<string>
}

export type BulkSaveKnowledgeTagDefinitionsResponse = {
  data: BulkSaveKnowledgeTagDefinitionsResponseRef1
}

/** `PATCH /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks` */
export type BulkUpdateKnowledgeChunksParams = {
  documentId: string
  knowledgeBaseId: string
}

export type BulkUpdateKnowledgeChunksQuery = Record<string, unknown>

export type BulkUpdateKnowledgeChunksBody = {
  workspaceId: string
  operation: 'enable' | 'disable' | 'delete'
  chunkIds: Array<string>
}

type BulkUpdateKnowledgeChunksResponseRef0 = {
  operation: 'enable' | 'disable' | 'delete'
  processed: number
  errors: Array<string>
}

export type BulkUpdateKnowledgeChunksResponse = {
  data: BulkUpdateKnowledgeChunksResponseRef0
}

/** `PATCH /api/v2/knowledge/[knowledgeBaseId]/documents` */
export type BulkUpdateKnowledgeDocumentsParams = {
  knowledgeBaseId: string
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

/** `POST /api/v2/tables/[tableId]/rows/bulk-update` */
export type BulkUpdateTableRowsParams = {
  tableId: string
}

export type BulkUpdateTableRowsQuery = Record<string, unknown>

type BulkUpdateTableRowsBodyRef0 = Record<string, unknown>

export type BulkUpdateTableRowsBody = {
  workspaceId: string
  updates: Array<{
    rowId: string
    data: BulkUpdateTableRowsBodyRef0
  }>
}

type BulkUpdateTableRowsResponseRef0 = {
  updatedCount: number
  updatedRowIds: Array<string>
}

export type BulkUpdateTableRowsResponse = {
  data: BulkUpdateTableRowsResponseRef0
}

/** `DELETE /api/v2/tables/[tableId]/dispatches/[dispatchId]` */
export type CancelTableDispatchParams = {
  tableId: string
  dispatchId: string
}

export type CancelTableDispatchQuery = {
  workspaceId: string
}

type CancelTableDispatchResponseRef0 = {
  id: string
  tableId: string
  workspaceId: string
  status: 'pending' | 'dispatching' | 'complete' | 'canceled'
  mode: 'all' | 'incomplete' | 'new'
  scope: {
    groupIds: Array<string>
    rowIds?: Array<string>
    filtered?: boolean
    excludeRowIds?: Array<string>
  }
  limit: {
    type: 'rows'
    max: number
  } | null
  processedCount: number
  isManualRun: boolean
  requestedAt: string
  completedAt: string | null
  canceledAt: string | null
}

export type CancelTableDispatchResponse = {
  data: CancelTableDispatchResponseRef0
}

/** `DELETE /api/v2/tables/[tableId]/exports/[exportId]` */
export type CancelTableExportParams = {
  tableId: string
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
  code: string
  line: number | null
  message: string
}

type CancelTableImportResponseRef4 = {
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
  rowsRejected: number
  cellsRejected: number
  rejectedSamples: Array<CancelTableImportResponseRef3>
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type CancelTableImportResponse = {
  data: CancelTableImportResponseRef4
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

/** `POST /api/v2/workflows/[workflowId]/runs/[runId]/cancel` */
export type CancelWorkflowRunParams = {
  workflowId: string
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
    | 'queue_cancelled'
    | 'active_resume_signal_failed'
    | 'cancellation_not_finalized'
}

export type CancelWorkflowRunResponse = {
  data: CancelWorkflowRunResponseRef0
}

/** `POST /api/v2/chat` */
export type ChatQuery = Record<string, unknown>

export type ChatBody = {
  workspaceId: string
  message: string
  conversationId?: string
}

export type ChatResponse = {
  data: {
    content: string
    conversationId: string
    model: string
    tokens?: {
      prompt?: number
      completion?: number
      total?: number
    }
    cost?: unknown
    toolCalls?: Array<Record<string, unknown>>
  }
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
  webUrl: string
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

/** `POST /api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/complete` */
export type CompleteKnowledgeDocumentUploadParams = {
  knowledgeBaseId: string
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
  code: string
  line: number | null
  message: string
}

type CompleteTableImportResponseRef4 = {
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
  rowsRejected: number
  cellsRejected: number
  rejectedSamples: Array<CompleteTableImportResponseRef3>
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type CompleteTableImportResponse = {
  data: CompleteTableImportResponseRef4
}

/** `POST /api/v2/credentials/connections` */
export type CreateCredentialConnectionQuery = Record<string, unknown>

export type CreateCredentialConnectionBody =
  | {
      workspaceId: string
      displayName: string
      providerId: 'quickbooks'
      oauthClientConfig: {
        clientId: string
        clientSecret: string
        environment: 'sandbox' | 'production'
        webhookVerifierToken: string
      }
    }
  | {
      workspaceId: string
      displayName: string
      providerId:
        | 'github-repositories'
        | 'google-email'
        | 'google-drive'
        | 'google-docs'
        | 'google-sheets'
        | 'google-forms'
        | 'google-calendar'
        | 'google-contacts'
        | 'google-ads'
        | 'google-bigquery'
        | 'google-tasks'
        | 'google-vault'
        | 'google-groups'
        | 'google-chat'
        | 'google-meet'
        | 'vertex-ai'
        | 'microsoft-ad'
        | 'microsoft-dataverse'
        | 'microsoft-excel'
        | 'microsoft-planner'
        | 'microsoft-teams'
        | 'microsoft-word'
        | 'outlook'
        | 'onedrive'
        | 'sharepoint'
        | 'x'
        | 'tiktok'
        | 'confluence'
        | 'jira'
        | 'airtable'
        | 'bitbucket'
        | 'notion'
        | 'clickup'
        | 'linear'
        | 'manageengine-sdp'
        | 'monday'
        | 'box'
        | 'dropbox'
        | 'shopify'
        | 'slack'
        | 'reddit'
        | 'wealthbox'
        | 'webflow'
        | 'trello'
        | 'asana'
        | 'attio'
        | 'calcom'
        | 'docusign'
        | 'pipedrive'
        | 'hubspot'
        | 'linkedin'
        | 'instagram'
        | 'salesforce'
        | 'salesforce-sandbox'
        | 'zoho-desk'
        | 'zoom'
        | 'wordpress'
        | 'spotify'
    }
  | {
      workspaceId: string
      credentialId: string
      oauthClientConfig?: {
        clientId: string
        clientSecret: string
        environment: 'sandbox' | 'production'
        webhookVerifierToken: string
      }
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
  webUrl: string
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
  webUrl: string
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
  strategy?: 'auto' | 'text' | 'regex' | 'recursive' | 'sentence' | 'token'
  strategyOptions?: {
    pattern?: string
    separators?: Array<string>
    recipe?: 'plain' | 'markdown' | 'code'
    strictBoundaries?: boolean
  }
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
  webUrl: string
  ownerEmail: string
  folderPath: string
  deletedAt: string | null
}

export type CreateKnowledgeBaseResponse = {
  data: CreateKnowledgeBaseResponseRef1
}

/** `POST /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks` */
export type CreateKnowledgeChunkParams = {
  documentId: string
  knowledgeBaseId: string
}

export type CreateKnowledgeChunkQuery = Record<string, unknown>

export type CreateKnowledgeChunkBody = {
  workspaceId: string
  content: string
  enabled?: boolean
}

type CreateKnowledgeChunkResponseRef0 = {
  id: string
  chunkIndex: number
  content: string
  contentLength: number
  tokenCount: number
  enabled: boolean
  startOffset: number
  endOffset: number
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
  createdAt: string
  updatedAt: string
}

export type CreateKnowledgeChunkResponse = {
  data: CreateKnowledgeChunkResponseRef0
}

/** `POST /api/v2/knowledge/[knowledgeBaseId]/connectors` */
export type CreateKnowledgeConnectorParams = {
  knowledgeBaseId: string
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
  status: 'active' | 'paused' | 'pending' | 'syncing' | 'error' | 'disabled'
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

/** `POST /api/v2/knowledge/[knowledgeBaseId]/documents/uploads` */
export type CreateKnowledgeDocumentUploadParams = {
  knowledgeBaseId: string
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
    recipe?: 'default' | 'plain' | 'markdown' | 'code'
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

/** `POST /api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/parts` */
export type CreateKnowledgeDocumentUploadPartUrlsParams = {
  knowledgeBaseId: string
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

/** `POST /api/v2/knowledge/[knowledgeBaseId]/tags` */
export type CreateKnowledgeTagParams = {
  knowledgeBaseId: string
}

export type CreateKnowledgeTagQuery = Record<string, unknown>

export type CreateKnowledgeTagBody = {
  workspaceId: string
  displayName: string
  fieldType?: 'text' | 'number' | 'date' | 'boolean'
  tagSlot?:
    | 'tag1'
    | 'tag2'
    | 'tag3'
    | 'tag4'
    | 'tag5'
    | 'tag6'
    | 'tag7'
    | 'number1'
    | 'number2'
    | 'number3'
    | 'number4'
    | 'number5'
    | 'date1'
    | 'date2'
    | 'boolean1'
    | 'boolean2'
    | 'boolean3'
}

type CreateKnowledgeTagResponseRef0 = {
  id: string
  displayName: string
  tagSlot: string
  fieldType: string
}

export type CreateKnowledgeTagResponse = {
  data: CreateKnowledgeTagResponseRef0
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

/** `POST /api/v2/sandboxes` */
export type CreateSandboxQuery = Record<string, unknown>

export type CreateSandboxBody = {
  workspaceId: string
  name: string
  language: 'javascript' | 'python'
  dependencies?: Array<string>
  cliTools?: Array<
    | 'google-cloud-cli@577.0.0-r1'
    | 'aws-cli@2.36.15-r1'
    | 'azure-cli@2.89.0-r1'
    | 'doctl@1.166.0-r1'
    | 'github-cli@2.97.0-r1'
    | 'gitlab-cli@1.111.0-r1'
    | 'kubectl@1.36.3-r1'
    | 'helm@4.2.3-r1'
    | 'kustomize@5.8.1-r1'
    | 'argocd@3.4.6-r1'
    | 'terraform@1.15.8-r1'
    | 'pulumi@3.255.0-r1'
    | 'supabase-cli@2.111.0-r1'
    | 'firebase-cli@15.25.1-r1'
    | 'flyctl@0.4.78-r1'
    | 'railway-cli@5.30.4-r1'
    | 'stripe-cli@1.45.0-r1'
    | 'duckdb@1.5.5-r1'
    | 'rclone@1.75.0-r1'
    | 'restic@0.19.1-r1'
    | 'minio-mc@RELEASE.2025-08-13T08-35-41Z-r1'
    | 'mongosh@2.9.2-r1'
    | 'sops@3.13.3-r1'
    | 'age@1.3.1-r1'
  >
  systemPackages?: Array<string>
}

type CreateSandboxResponseRef0 = {
  id: string
  name: string
  language: 'javascript' | 'python'
  dependencies: Array<string>
  cliTools: Array<
    | 'google-cloud-cli@577.0.0-r1'
    | 'aws-cli@2.36.15-r1'
    | 'azure-cli@2.89.0-r1'
    | 'doctl@1.166.0-r1'
    | 'github-cli@2.97.0-r1'
    | 'gitlab-cli@1.111.0-r1'
    | 'kubectl@1.36.3-r1'
    | 'helm@4.2.3-r1'
    | 'kustomize@5.8.1-r1'
    | 'argocd@3.4.6-r1'
    | 'terraform@1.15.8-r1'
    | 'pulumi@3.255.0-r1'
    | 'supabase-cli@2.111.0-r1'
    | 'firebase-cli@15.25.1-r1'
    | 'flyctl@0.4.78-r1'
    | 'railway-cli@5.30.4-r1'
    | 'stripe-cli@1.45.0-r1'
    | 'duckdb@1.5.5-r1'
    | 'rclone@1.75.0-r1'
    | 'restic@0.19.1-r1'
    | 'minio-mc@RELEASE.2025-08-13T08-35-41Z-r1'
    | 'mongosh@2.9.2-r1'
    | 'sops@3.13.3-r1'
    | 'age@1.3.1-r1'
  >
  systemPackages: Array<string>
  buildStatus: 'pending' | 'building' | 'ready' | 'failed' | null
  errorCode: string | null
  errorMessage: string | null
  errorDetail: string | null
  builtAt: string | null
  createdAt: string
  updatedAt: string
}

export type CreateSandboxResponse = {
  data: CreateSandboxResponseRef0
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
      type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'ttl' | 'json' | 'select'
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
  webUrl: string
  name: string
  description: string | null
  ownerEmail: string
  schema: {
    columns: Array<{
      id?: string
      name: string
      type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'ttl' | 'json' | 'select'
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

/** `POST /api/v2/tables/[tableId]/dispatches` */
export type CreateTableDispatchParams = {
  tableId: string
}

export type CreateTableDispatchQuery = Record<string, unknown>

type CreateTableDispatchBodyRef0 =
  | {
      all: Array<
        | CreateTableDispatchBodyRef0
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
        | CreateTableDispatchBodyRef0
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

export type CreateTableDispatchBody = {
  workspaceId: string
  groupIds: Array<string>
  runMode?: 'all' | 'incomplete'
  rowIds?: Array<string>
  filter?: CreateTableDispatchBodyRef0
  excludeRowIds?: Array<string>
  limit?: {
    type: 'rows'
    max: number
  }
}

type CreateTableDispatchResponseRef0 = {
  dispatchId: string | null
}

export type CreateTableDispatchResponse = {
  data: CreateTableDispatchResponseRef0
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
  code: string
  line: number | null
  message: string
}

type CreateTableImportResponseRef3 = {
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
  rowsRejected: number
  cellsRejected: number
  rejectedSamples: Array<CreateTableImportResponseRef2>
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

type CreateTableImportResponseRef4 = {
  method: 'put'
  url: string
  headers: Record<string, string>
  expiresAt: string
}

type CreateTableImportResponseRef5 = {
  method: 'multipart'
  partSize: number
  partCount: number
}

type CreateTableImportResponseRef6 = {
  type: 'workspace_file'
  fileId: string
}

type CreateTableImportResponseRef7 = {
  id: string
  workspaceId: string
  status: 'uploading' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired'
  source: CreateTableImportResponseRef6
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
  rowsRejected: number
  cellsRejected: number
  rejectedSamples: Array<CreateTableImportResponseRef2>
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

type CreateTableImportResponseRef8 =
  | {
      session: CreateTableImportResponseRef3
      uploadToken: string
      transfer: CreateTableImportResponseRef4 | CreateTableImportResponseRef5
    }
  | {
      session: CreateTableImportResponseRef7
      uploadToken: null
      transfer: null
    }

export type CreateTableImportResponse = {
  data: CreateTableImportResponseRef8
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
  data: CreateTableRowsResponseRef3
}

type CreateTableRowsResponseRef1 = Record<string, unknown>

type CreateTableRowsResponseRef2 = {
  status: string
  executionId: string | null
  workflowId: string
  error: string | null
  runningBlockIds: Array<string>
  blockErrors: Record<string, string>
  canceledAt: string | null
}

type CreateTableRowsResponseRef3 = {
  id: string
  data: CreateTableRowsResponseRef1
  runState?: Record<string, CreateTableRowsResponseRef2>
  createdAt: string
  updatedAt: string
}

type CreateTableRowsResponseRef4 = {
  data: CreateTableRowsResponseRef5
}

type CreateTableRowsResponseRef5 = {
  rows: Array<CreateTableRowsResponseRef3>
  insertedCount: number
}

export type CreateTableRowsResponse = CreateTableRowsResponseRef0 | CreateTableRowsResponseRef4

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
  type: string
  name: string
}

type CreateWorkflowResponseRef1 = {
  id: string
  webUrl: string
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
  blocks: Array<CreateWorkflowResponseRef0>
}

export type CreateWorkflowResponse = {
  data: CreateWorkflowResponseRef1
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

/** `POST /api/v2/workflow-mcp-servers` */
export type CreateWorkflowMcpServerQuery = Record<string, unknown>

export type CreateWorkflowMcpServerBody = {
  workspaceId: string
  name: string
  description?: string
  isPublic?: boolean
  workflowIds?: Array<string>
}

type CreateWorkflowMcpServerResponseRef0 = {
  id: string
  name: string
  description: string | null
  isPublic: boolean
  mcpServerUrl: string
  createdAt: string
  updatedAt: string
}

export type CreateWorkflowMcpServerResponse = {
  data: CreateWorkflowMcpServerResponseRef0
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

/** `DELETE /api/v2/custom-tools/[customToolId]` */
export type DeleteCustomToolParams = {
  customToolId: string
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

/** `DELETE /api/v2/knowledge/[knowledgeBaseId]` */
export type DeleteKnowledgeBaseParams = {
  knowledgeBaseId: string
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

/** `DELETE /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]` */
export type DeleteKnowledgeChunkParams = {
  documentId: string
  chunkId: string
  knowledgeBaseId: string
}

export type DeleteKnowledgeChunkQuery = {
  workspaceId: string
}

type DeleteKnowledgeChunkResponseRef0 = {
  id: string
  deleted: true
}

export type DeleteKnowledgeChunkResponse = {
  data: DeleteKnowledgeChunkResponseRef0
}

/** `DELETE /api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]` */
export type DeleteKnowledgeConnectorParams = {
  connectorId: string
  knowledgeBaseId: string
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

/** `DELETE /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]` */
export type DeleteKnowledgeDocumentParams = {
  documentId: string
  knowledgeBaseId: string
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

/** `DELETE /api/v2/knowledge/[knowledgeBaseId]/tags/[tagId]` */
export type DeleteKnowledgeTagParams = {
  tagId: string
  knowledgeBaseId: string
}

export type DeleteKnowledgeTagQuery = {
  workspaceId: string
}

type DeleteKnowledgeTagResponseRef0 = {
  id: string
  tagSlot: string
  displayName: string
  deleted: true
}

export type DeleteKnowledgeTagResponse = {
  data: DeleteKnowledgeTagResponseRef0
}

/** `DELETE /api/v2/knowledge/[knowledgeBaseId]/tags` */
export type DeleteKnowledgeTagDefinitionsParams = {
  knowledgeBaseId: string
}

export type DeleteKnowledgeTagDefinitionsQuery = {
  workspaceId: string
  unused?: boolean
}

type DeleteKnowledgeTagDefinitionsResponseRef0 = {
  unused: boolean
  count: number
}

export type DeleteKnowledgeTagDefinitionsResponse = {
  data: DeleteKnowledgeTagDefinitionsResponseRef0
}

/** `DELETE /api/v2/mcp-servers/[mcpServerId]` */
export type DeleteMcpServerParams = {
  mcpServerId: string
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

/** `DELETE /api/v2/sandboxes/[sandboxId]` */
export type DeleteSandboxParams = {
  sandboxId: string
}

export type DeleteSandboxQuery = {
  workspaceId: string
}

type DeleteSandboxResponseRef0 = {
  id: string
  deleted: true
}

export type DeleteSandboxResponse = {
  data: DeleteSandboxResponseRef0
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

/** `DELETE /api/v2/skills/[skillId]` */
export type DeleteSkillParams = {
  skillId: string
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
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'ttl' | 'json' | 'select'
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

/** `DELETE /api/v2/workflows/[workflowId]` */
export type DeleteWorkflowParams = {
  workflowId: string
}

export type DeleteWorkflowQuery = Record<string, unknown>

type DeleteWorkflowResponseRef0 = {
  id: string
  deleted: true
  archived: true
}

export type DeleteWorkflowResponse = {
  data: DeleteWorkflowResponseRef0
}

/** `DELETE /api/v2/workflows/[workflowId]/deployments/chat` */
export type DeleteWorkflowChatDeploymentParams = {
  workflowId: string
}

export type DeleteWorkflowChatDeploymentQuery = Record<string, unknown>

type DeleteWorkflowChatDeploymentResponseRef0 = {
  id: string
  deleted: true
}

export type DeleteWorkflowChatDeploymentResponse = {
  data: DeleteWorkflowChatDeploymentResponseRef0
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
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'ttl' | 'json' | 'select'
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

/** `DELETE /api/v2/workflow-mcp-servers/[serverId]` */
export type DeleteWorkflowMcpServerParams = {
  serverId: string
}

export type DeleteWorkflowMcpServerQuery = Record<string, unknown>

type DeleteWorkflowMcpServerResponseRef0 = {
  id: string
  deleted: true
}

export type DeleteWorkflowMcpServerResponse = {
  data: DeleteWorkflowMcpServerResponseRef0
}

/** `POST /api/v2/workflows/[workflowId]/deploy` */
export type DeployWorkflowParams = {
  workflowId: string
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

/** `POST /api/v2/workflow-mcp-servers/[serverId]/tools` */
export type DeployWorkflowMcpToolParams = {
  serverId: string
}

export type DeployWorkflowMcpToolQuery = Record<string, unknown>

export type DeployWorkflowMcpToolBody = {
  workflowId: string
  toolName?: string
  toolDescription?: string
  parameterDescriptions?: Array<{
    name: string
    description: string
  }>
}

type DeployWorkflowMcpToolResponseRef0 = {
  id: string
  serverId: string
  workflowId: string
  toolName: string
  toolDescription: string | null
  mcpServerUrl: string
  apiEndpoint: string
  updated: boolean
  createdAt: string
  updatedAt: string
}

export type DeployWorkflowMcpToolResponse = {
  data: DeployWorkflowMcpToolResponseRef0
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

/** `GET /api/v2/workflows/[workflowId]/runs/[runId]/files/[fileId]` */
export type DownloadRunFileParams = {
  workflowId: string
  runId: string
  fileId: string
}

export type DownloadRunFileQuery = Record<string, unknown>

/** Non-JSON response (`binary`). */
export type DownloadRunFileResponse = never

/** `POST /api/v2/workflows/[workflowId]/duplicate` */
export type DuplicateWorkflowParams = {
  workflowId: string
}

export type DuplicateWorkflowQuery = Record<string, unknown>

type DuplicateWorkflowBodyRef0 = string

export type DuplicateWorkflowBody = {
  name?: string
  folderPath?: DuplicateWorkflowBodyRef0
}

type DuplicateWorkflowResponseRef0 = {
  id: string
  webUrl: string
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

export type DuplicateWorkflowResponse = {
  data: DuplicateWorkflowResponseRef0
}

/** `PATCH /api/v2/files/[fileId]/content` */
export type EditFileContentParams = {
  fileId: string
}

export type EditFileContentQuery = Record<string, unknown>

export type EditFileContentBody = {
  workspaceId: string
  edit:
    | {
        mode: 'search_replace'
        search: string
        content: string
        replaceAll?: boolean
      }
    | {
        mode: 'replace_between'
        beforeAnchor: string
        afterAnchor: string
        content: string
        occurrence?: number
      }
    | {
        mode: 'insert_after'
        anchor: string
        content: string
        occurrence?: number
      }
    | {
        mode: 'delete_between'
        startAnchor: string
        endAnchor: string
        occurrence?: number
      }
}

type EditFileContentResponseRef0 = {
  id: string
  webUrl: string
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

type EditFileContentResponseRef1 = {
  file: EditFileContentResponseRef0
  lineCount: number
}

export type EditFileContentResponse = {
  data: EditFileContentResponseRef1
}

/** `POST /api/v2/tools/[toolId]/execute` */
export type ExecuteToolParams = {
  toolId: string
}

export type ExecuteToolQuery = Record<string, unknown>

export type ExecuteToolBody = {
  workspaceId: string
  input?: Record<string, unknown>
  credentialId?: string
  timeoutSeconds?: number
}

type ExecuteToolResponseRef0 = {
  toolId: string
  status: 'succeeded' | 'failed'
  output: unknown
  error: {
    message: string
  } | null
}

export type ExecuteToolResponse = {
  data: ExecuteToolResponseRef0
}

/** `POST /api/v2/workflows/[workflowId]/execute` */
export type ExecuteWorkflowParams = {
  workflowId: string
}

export type ExecuteWorkflowQuery = Record<string, unknown>

export type ExecuteWorkflowBody = {
  input?: Record<string, unknown>
  run?:
    | {
        source: 'deployment'
      }
    | {
        source: 'manual'
        entry?:
          | {
              type: 'trigger'
              blockId?: string
              useMockPayload?: boolean
            }
          | {
              type: 'block'
              blockId: string
              sourceRunId: string
            }
      }
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

/** `GET /api/v2/knowledge/[knowledgeBaseId]/export` */
export type ExportKnowledgeBaseParams = {
  knowledgeBaseId: string
}

export type ExportKnowledgeBaseQuery = {
  workspaceId: string
  vectors?: boolean
}

/** Non-JSON response (`binary`). */
export type ExportKnowledgeBaseResponse = never

/** `GET /api/v2/workflows/[workflowId]/export` */
export type ExportWorkflowParams = {
  workflowId: string
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

/** `GET /api/v2/audit-logs/[auditLogId]` */
export type GetAuditLogParams = {
  auditLogId: string
}

export type GetAuditLogQuery = {
  organizationId?: string
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

/** `GET /api/v2/blocks/[blockId]` */
export type GetBlockParams = {
  blockId: string
}

export type GetBlockQuery = {
  workspaceId: string
}

type GetBlockResponseRef0 = {
  id: string
  type: string
  title?: string
  required?: boolean
  requiredWhen?: GetBlockResponseRef1
  description?: string
  placeholder?: string
  mode?: string
  hidden?: boolean
  condition?: GetBlockResponseRef1
  options?: Array<{
    id: string
    label?: string
    hasIcon?: boolean
  }>
  min?: number
  max?: number
  step?: number
  integer?: boolean
  rows?: number
  password?: boolean
  multiSelect?: boolean
  language?: string
  generationType?: string
  serviceId?: string
  requiredScopes?: Array<string>
  mimeType?: string
  acceptedTypes?: string
  multiple?: boolean
  maxSize?: number
  connectionDroppable?: boolean
  columns?: Array<string>
  dependsOn?:
    | Array<string>
    | {
        all?: Array<string>
        any?: Array<string>
      }
  canonicalParamId?: string
  defaultValue?: string | number | boolean | Record<string, unknown> | Array<unknown>
  hasComputedDefault?: boolean
}

type GetBlockResponseRef1 = {
  field: string
  value: string | number | boolean | Array<string | number | boolean>
  not?: boolean
  and?: {
    field: string
    value?: string | number | boolean | Array<string | number | boolean>
    not?: boolean
  }
}

type GetBlockResponseRef2 = {
  type: string
  required?: boolean
  visibility?: string
  description?: string
  default?: unknown
  items?: unknown
  schema?: unknown
}

type GetBlockResponseRef3 = {
  type: string
  description?: string
  optional?: boolean
  nullable?: boolean
  properties?: Record<string, unknown>
  items?: {
    type: string
    description?: string
    properties?: Record<string, unknown>
  }
  fileConfig?: {
    mimeType?: string
    extension?: string
  }
}

type GetBlockResponseRef4 = {
  id: string
  name: string
  description: string
  version?: string
  hostedApiKey: 'always' | 'conditional' | 'none'
  oauth?: {
    required: boolean
    provider: string
    requiredScopes?: Array<string>
  }
  params: Record<string, GetBlockResponseRef5>
  outputs: Record<string, GetBlockResponseRef3>
}

type GetBlockResponseRef5 = {
  type: string
  required?: boolean
  visibility?: string
  description?: string
  default?: unknown
  items?: unknown
}

type GetBlockResponseRef6 = {
  id: string
  name: string
  description: string
  longDescription?: string
  category: string
  integrationType?: string
  source: 'builtin' | 'custom'
  authMode?: string
  triggerAllowed: boolean
  triggerCapable: boolean
  triggerIds: Array<string>
  toolIds: Array<string>
  operationIds: Array<string>
  preview: boolean
  sunset?: {
    status: 'legacy' | 'deprecated'
    replacedBy?: string
  }
  docsLink?: string
  tags: Array<string>
  bestPractices?: string
  inputSchema: Array<GetBlockResponseRef0>
  operationInputSchema: Record<string, Array<GetBlockResponseRef0>>
  inputDefinitions: Record<
    string,
    {
      type: string
      description?: string
      schema?: unknown
    }
  >
  operations: Record<
    string,
    {
      toolId?: string
      toolName?: string
      description?: string
      inputs: Record<string, GetBlockResponseRef2>
      outputs: Record<string, GetBlockResponseRef3>
      inputSchema: Array<GetBlockResponseRef0>
    }
  >
  tools: Array<GetBlockResponseRef4>
  triggers: Array<{
    id: string
    outputs: Record<
      string,
      {
        type: string
        description?: string
      }
    >
    configFields: Record<
      string,
      {
        type: string
        required: boolean
        title?: string
        description?: string
        placeholder?: string
        default?: unknown
        options?: Array<{
          id: string
          label: string
        }>
        condition?: GetBlockResponseRef1
      }
    >
  }>
  outputs: Record<
    string,
    {
      type: string
      description?: string
    }
  >
}

export type GetBlockResponse = {
  data: GetBlockResponseRef6
}

/** `GET /api/v2/custom-tools/[customToolId]` */
export type GetCustomToolParams = {
  customToolId: string
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
  webUrl: string
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

/** `GET /api/v2/files/uploads/[uploadId]` */
export type GetFileUploadParams = {
  uploadId: string
}

export type GetFileUploadQuery = {
  workspaceId: string
}

export type GetFileUploadHeaders = {
  'upload-token': string
}

type GetFileUploadResponseRef0 = {
  id: string
  webUrl: string
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

type GetFileUploadResponseRef1 = {
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
  file: GetFileUploadResponseRef0 | null
}

export type GetFileUploadResponse = {
  data: GetFileUploadResponseRef1
}

/** `GET /api/v2/knowledge/[knowledgeBaseId]` */
export type GetKnowledgeBaseParams = {
  knowledgeBaseId: string
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
  webUrl: string
  ownerEmail: string
  folderPath: string
  deletedAt: string | null
}

export type GetKnowledgeBaseResponse = {
  data: GetKnowledgeBaseResponseRef1
}

/** `GET /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]` */
export type GetKnowledgeChunkParams = {
  documentId: string
  chunkId: string
  knowledgeBaseId: string
}

export type GetKnowledgeChunkQuery = {
  workspaceId: string
}

type GetKnowledgeChunkResponseRef0 = {
  id: string
  chunkIndex: number
  content: string
  contentLength: number
  tokenCount: number
  enabled: boolean
  startOffset: number
  endOffset: number
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
  createdAt: string
  updatedAt: string
}

export type GetKnowledgeChunkResponse = {
  data: GetKnowledgeChunkResponseRef0
}

/** `GET /api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]` */
export type GetKnowledgeConnectorParams = {
  connectorId: string
  knowledgeBaseId: string
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
  docsSkipped: number
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
  status: 'active' | 'paused' | 'pending' | 'syncing' | 'error' | 'disabled'
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

/** `GET /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]` */
export type GetKnowledgeDocumentParams = {
  documentId: string
  knowledgeBaseId: string
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
  size: number
  type: string
  downloadPath: string
}

type GetLogResponseRef1 = {
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
  children?: Array<GetLogResponseRef1>
}

type GetLogResponseRef2 = {
  runId: string
  workflowId: string | null
  deploymentVersionId: string | null
  status: 'pending' | 'running' | 'paused' | 'redacting' | 'completed' | 'failed' | 'cancelled'
  level: string
  trigger: string
  startedAt: string
  endedAt: string | null
  totalDurationMs: number | null
  files: Array<GetLogResponseRef0> | null
  executedByEmail: string | null
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
  traceSpans: Array<GetLogResponseRef1>
  finalOutput: unknown | null
  cost: {
    total: number
    items: Array<{
      category: 'fixed' | 'model' | 'tool'
      description: string
      cost: number
      inputTokens?: number
      outputTokens?: number
    }> | null
  } | null
  workflowInput: unknown | null
  createdAt: string
}

export type GetLogResponse = {
  data: GetLogResponseRef2
}

/** `GET /api/v2/logs/stats` */
export type GetLogStatsQuery = {
  workspaceId: string
  workflowIds?: string
  folderPaths?: string
  triggers?: string
  level?: 'info' | 'error'
  startDate?: string
  endDate?: string
  segmentCount?: number
}

type GetLogStatsResponseRef0 = {
  workflowId: string
  workflowName: string
  segments: Array<GetLogStatsResponseRef1>
  totalExecutions: number
  totalSuccessful: number
  overallSuccessRate: number
}

type GetLogStatsResponseRef1 = {
  timestamp: string
  totalExecutions: number
  successfulExecutions: number
  avgDurationMs: number
}

type GetLogStatsResponseRef2 = {
  workflows: Array<GetLogStatsResponseRef0>
  workflowsTruncated: boolean
  aggregateSegments: Array<GetLogStatsResponseRef1>
  totalRuns: number
  totalErrors: number
  avgLatency: number
  timeBounds: {
    start: string
    end: string
  }
  segmentMs: number
}

export type GetLogStatsResponse = {
  data: GetLogStatsResponseRef2
}

/** `GET /api/v2/mcp-servers/[mcpServerId]` */
export type GetMcpServerParams = {
  mcpServerId: string
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

/** `GET /api/v2/meta` */
export type GetMetaQuery = Record<string, unknown>

type GetMetaResponseRef0 = {
  v2Enabled: boolean
  keyType: 'personal' | 'workspace' | 'oauth_access_token'
  expiresAt: string | null
}

export type GetMetaResponse = {
  data: GetMetaResponseRef0
}

/** `GET /api/v2/knowledge/[knowledgeBaseId]/tags/next-slot` */
export type GetNextKnowledgeTagSlotParams = {
  knowledgeBaseId: string
}

export type GetNextKnowledgeTagSlotQuery = {
  workspaceId: string
  fieldType: 'text' | 'number' | 'date' | 'boolean'
}

type GetNextKnowledgeTagSlotResponseRef0 = {
  nextAvailableSlot: string | null
  fieldType: string
  usedSlots: Array<string>
  totalSlots: number
  availableSlots: number
}

export type GetNextKnowledgeTagSlotResponse = {
  data: GetNextKnowledgeTagSlotResponseRef0
}

/** `GET /api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]` */
export type GetRowEnrichmentParams = {
  tableId: string
  rowId: string
  groupId: string
}

export type GetRowEnrichmentQuery = {
  workspaceId: string
}

type GetRowEnrichmentResponseRef0 = {
  startedAt: string | null
  completedAt: string | null
  durationMs: number
  totalCost: number
  matchedProvider: string | null
  aborted: boolean
  providers: Array<GetRowEnrichmentResponseRef1>
}

type GetRowEnrichmentResponseRef1 = {
  id: string
  label: string
  toolId: string
  status: string
  cost: number
  durationMs: number
  error: string | null
}

export type GetRowEnrichmentResponse = {
  data: GetRowEnrichmentResponseRef0 | null
}

/** `GET /api/v2/sandboxes/[sandboxId]` */
export type GetSandboxParams = {
  sandboxId: string
}

export type GetSandboxQuery = {
  workspaceId: string
}

type GetSandboxResponseRef0 = {
  id: string
  name: string
  language: 'javascript' | 'python'
  dependencies: Array<string>
  cliTools: Array<
    | 'google-cloud-cli@577.0.0-r1'
    | 'aws-cli@2.36.15-r1'
    | 'azure-cli@2.89.0-r1'
    | 'doctl@1.166.0-r1'
    | 'github-cli@2.97.0-r1'
    | 'gitlab-cli@1.111.0-r1'
    | 'kubectl@1.36.3-r1'
    | 'helm@4.2.3-r1'
    | 'kustomize@5.8.1-r1'
    | 'argocd@3.4.6-r1'
    | 'terraform@1.15.8-r1'
    | 'pulumi@3.255.0-r1'
    | 'supabase-cli@2.111.0-r1'
    | 'firebase-cli@15.25.1-r1'
    | 'flyctl@0.4.78-r1'
    | 'railway-cli@5.30.4-r1'
    | 'stripe-cli@1.45.0-r1'
    | 'duckdb@1.5.5-r1'
    | 'rclone@1.75.0-r1'
    | 'restic@0.19.1-r1'
    | 'minio-mc@RELEASE.2025-08-13T08-35-41Z-r1'
    | 'mongosh@2.9.2-r1'
    | 'sops@3.13.3-r1'
    | 'age@1.3.1-r1'
  >
  systemPackages: Array<string>
  buildStatus: 'pending' | 'building' | 'ready' | 'failed' | null
  errorCode: string | null
  errorMessage: string | null
  errorDetail: string | null
  builtAt: string | null
  createdAt: string
  updatedAt: string
}

export type GetSandboxResponse = {
  data: GetSandboxResponseRef0
}

/** `GET /api/v2/skills/[skillId]` */
export type GetSkillParams = {
  skillId: string
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
  webUrl: string
  name: string
  description: string | null
  ownerEmail: string
  schema: {
    columns: Array<{
      id?: string
      name: string
      type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'ttl' | 'json' | 'select'
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

/** `GET /api/v2/tables/[tableId]/dispatches/[dispatchId]` */
export type GetTableDispatchParams = {
  tableId: string
  dispatchId: string
}

export type GetTableDispatchQuery = {
  workspaceId: string
}

type GetTableDispatchResponseRef0 = {
  id: string
  tableId: string
  workspaceId: string
  status: 'pending' | 'dispatching' | 'complete' | 'canceled'
  mode: 'all' | 'incomplete' | 'new'
  scope: {
    groupIds: Array<string>
    rowIds?: Array<string>
    filtered?: boolean
    excludeRowIds?: Array<string>
  }
  limit: {
    type: 'rows'
    max: number
  } | null
  processedCount: number
  isManualRun: boolean
  requestedAt: string
  completedAt: string | null
  canceledAt: string | null
}

export type GetTableDispatchResponse = {
  data: GetTableDispatchResponseRef0
}

/** `GET /api/v2/tables/[tableId]/exports/[exportId]` */
export type GetTableExportParams = {
  tableId: string
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
  code: string
  line: number | null
  message: string
}

type GetTableImportResponseRef4 = {
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
  rowsRejected: number
  cellsRejected: number
  rejectedSamples: Array<GetTableImportResponseRef3>
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type GetTableImportResponse = {
  data: GetTableImportResponseRef4
}

/** `GET /api/v2/tables/[tableId]/rows/[rowId]` */
export type GetTableRowParams = {
  tableId: string
  rowId: string
}

export type GetTableRowQuery = {
  workspaceId: string
  includeRunState?: boolean
}

type GetTableRowResponseRef0 = Record<string, unknown>

type GetTableRowResponseRef1 = {
  status: string
  executionId: string | null
  workflowId: string
  error: string | null
  runningBlockIds: Array<string>
  blockErrors: Record<string, string>
  canceledAt: string | null
}

type GetTableRowResponseRef2 = {
  id: string
  data: GetTableRowResponseRef0
  runState?: Record<string, GetTableRowResponseRef1>
  createdAt: string
  updatedAt: string
}

export type GetTableRowResponse = {
  data: GetTableRowResponseRef2
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

/** `GET /api/v2/tools/[toolId]` */
export type GetToolParams = {
  toolId: string
}

export type GetToolQuery = {
  workspaceId: string
}

type GetToolResponseRef0 = {
  type: string
  required?: boolean
  visibility?: string
  description?: string
  default?: unknown
  items?: unknown
}

type GetToolResponseRef1 = {
  type: string
  description?: string
  optional?: boolean
  nullable?: boolean
  properties?: Record<string, unknown>
  items?: {
    type: string
    description?: string
    properties?: Record<string, unknown>
  }
  fileConfig?: {
    mimeType?: string
    extension?: string
  }
}

type GetToolResponseRef2 = {
  id: string
  name: string
  description: string
  version?: string
  hostedApiKey: 'always' | 'conditional' | 'none'
  oauth?: {
    required: boolean
    provider: string
    requiredScopes?: Array<string>
  }
  params: Record<string, GetToolResponseRef0>
  outputs: Record<string, GetToolResponseRef1>
}

export type GetToolResponse = {
  data: GetToolResponseRef2
}

/** `GET /api/v2/workflows/[workflowId]` */
export type GetWorkflowParams = {
  workflowId: string
}

export type GetWorkflowQuery = Record<string, unknown>

type GetWorkflowResponseRef0 = {
  name: string
  type: string
  description?: string
}

type GetWorkflowResponseRef1 = {
  id: string
  webUrl: string
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

/** `GET /api/v2/workflows/[workflowId]/deployments/chat` */
export type GetWorkflowChatDeploymentParams = {
  workflowId: string
}

export type GetWorkflowChatDeploymentQuery = Record<string, unknown>

type GetWorkflowChatDeploymentResponseRef0 = {
  primaryColor?: string
  welcomeMessage?: string
  imageUrl?: string
}

type GetWorkflowChatDeploymentResponseRef1 = {
  workflowId?: string
  blockId: string
  path: string
}

type GetWorkflowChatDeploymentResponseRef2 = {
  id: string
  workflowId: string
  workspaceId: string
  identifier: string
  url: string
  title: string
  description: string
  isActive: boolean
  authType: 'public' | 'password' | 'email' | 'sso'
  hasPassword: boolean
  allowedEmails: Array<string>
  customizations: GetWorkflowChatDeploymentResponseRef0
  outputConfigs: Array<GetWorkflowChatDeploymentResponseRef1>
  includeThinking: boolean
  includeToolCalls: boolean
  createdAt: string
  updatedAt: string
}

export type GetWorkflowChatDeploymentResponse = {
  data: GetWorkflowChatDeploymentResponseRef2
}

/** `GET /api/v2/workflows/[workflowId]/deployment` */
export type GetWorkflowDeploymentParams = {
  workflowId: string
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
  isPublicApi: boolean
}

export type GetWorkflowDeploymentResponse = {
  data: GetWorkflowDeploymentResponseRef4
}

/** `GET /api/v2/workflow-mcp-servers/[serverId]` */
export type GetWorkflowMcpServerParams = {
  serverId: string
}

export type GetWorkflowMcpServerQuery = Record<string, unknown>

type GetWorkflowMcpServerResponseRef0 = {
  id: string
  name: string
  description: string | null
  isPublic: boolean
  mcpServerUrl: string
  createdAt: string
  updatedAt: string
}

export type GetWorkflowMcpServerResponse = {
  data: GetWorkflowMcpServerResponseRef0
}

/** `GET /api/v2/workflows/[workflowId]/runs/[runId]` */
export type GetWorkflowRunParams = {
  workflowId: string
  runId: string
}

export type GetWorkflowRunQuery = {
  includeOutput?: boolean
  selectedOutputs?: string
  includeFileBase64?: boolean
  base64MaxBytes?: number
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
  id: string
  name: string
  size: number
  type: string
  downloadPath: string
  base64: string | null
}

type GetWorkflowRunResponseRef2 = {
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
  files: Array<GetWorkflowRunResponseRef1> | null
}

export type GetWorkflowRunResponse = {
  data: GetWorkflowRunResponseRef2
}

/** `GET /api/v2/workflows/[workflowId]/state` */
export type GetWorkflowStateParams = {
  workflowId: string
}

export type GetWorkflowStateQuery = Record<string, unknown>

type GetWorkflowStateResponseRef0 = {
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
  errorEnabled?: boolean
  retry?: {
    enabled: boolean
    maxTries: number
    waitBetweenTriesMs: number
  }
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

type GetWorkflowStateResponseRef1 = {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  type?: string
}

type GetWorkflowStateResponseRef2 = {
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

type GetWorkflowStateResponseRef3 = {
  id: string
  nodes: Array<string>
  distribution?: Array<unknown> | Record<string, unknown> | string
  count?: number
  parallelType?: 'count' | 'collection'
  batchSize?: number
  enabled?: boolean
  locked?: boolean
}

type GetWorkflowStateResponseRef4 = {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'plain'
  value: unknown
}

type GetWorkflowStateResponseRef5 = {
  blocks: Record<string, GetWorkflowStateResponseRef0>
  edges: Array<GetWorkflowStateResponseRef1>
  loops: Record<string, GetWorkflowStateResponseRef2>
  parallels: Record<string, GetWorkflowStateResponseRef3>
  variables: Record<string, GetWorkflowStateResponseRef4>
}

export type GetWorkflowStateResponse = {
  data: GetWorkflowStateResponseRef5
}

/** `GET /api/v2/workflows/[workflowId]/versions/[version]` */
export type GetWorkflowVersionParams = {
  version: number
  workflowId: string
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

/** `POST /api/v2/skills/[skillId]/editors` */
export type GrantSkillEditorParams = {
  skillId: string
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
  organizationId?: string
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
    | 'api-tool'
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
    | 'api-tool'
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
  scope: 'user' | 'workspace'
}

/** `GET /api/v2/blocks` */
export type ListBlocksQuery = {
  workspaceId: string
  search?: string
  category?: 'blocks' | 'tools' | 'triggers'
  capability?: 'trigger'
  source?: 'builtin' | 'custom'
  sortBy?: 'id' | 'name' | 'category'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListBlocksResponseRef0 = {
  id: string
  name: string
  description: string
  longDescription?: string
  category: string
  integrationType?: string
  source: 'builtin' | 'custom'
  authMode?: string
  triggerAllowed: boolean
  triggerCapable: boolean
  triggerIds: Array<string>
  toolIds: Array<string>
  operationIds: Array<string>
  preview: boolean
  sunset?: {
    status: 'legacy' | 'deprecated'
    replacedBy?: string
  }
  docsLink?: string
  tags: Array<string>
}

export type ListBlocksResponse = {
  data: Array<ListBlocksResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/chat-deployments` */
export type ListChatDeploymentsQuery = {
  workspaceId: string
  workflowId?: string
  isActive?: boolean
  sortBy?: 'identifier' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListChatDeploymentsResponseRef0 = {
  id: string
  workflowId: string
  workspaceId: string
  identifier: string
  url: string
  title: string
  description: string
  isActive: boolean
  authType: 'public' | 'password' | 'email' | 'sso'
  outputConfigs: Array<ListChatDeploymentsResponseRef1>
  includeThinking: boolean
  includeToolCalls: boolean
  createdAt: string
  updatedAt: string
}

type ListChatDeploymentsResponseRef1 = {
  workflowId?: string
  blockId: string
  path: string
}

export type ListChatDeploymentsResponse = {
  data: Array<ListChatDeploymentsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/connector-types` */
export type ListConnectorTypesQuery = {
  workspaceId: string
  search?: string
}

type ListConnectorTypesResponseRef0 = {
  connectorType: string
  name: string
  description: string
  version: string
  auth:
    | {
        mode: 'oauth'
        provider: string
        requiredScopes?: Array<string>
      }
    | {
        mode: 'apiKey'
        label?: string
        placeholder?: string
        optional: boolean
      }
  configFields: Array<ListConnectorTypesResponseRef1>
  supportsIncrementalSync: boolean
  tagDefinitions: Array<{
    id: string
    displayName: string
    fieldType: 'text' | 'number' | 'date' | 'boolean'
  }>
}

type ListConnectorTypesResponseRef1 = {
  id: string
  title: string
  type: 'short-input' | 'dropdown' | 'selector'
  placeholder?: string
  required?: boolean
  description?: string
  options?: Array<{
    id: string
    label: string
  }>
  selectorKey?: string
  mimeType?: string
  dependsOn?:
    | Array<string>
    | {
        all?: Array<string>
        any?: Array<string>
      }
  mode?: 'basic' | 'advanced'
  canonicalParamId?: string
  multi?: boolean
}

export type ListConnectorTypesResponse = {
  data: Array<ListConnectorTypesResponseRef0>
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
  scope?: 'active' | 'archived'
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
  depth?: number
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
  webUrl: string
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
  scope?: 'active' | 'archived'
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
  webUrl: string
  ownerEmail: string
  folderPath: string
  deletedAt: string | null
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

/** `GET /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks` */
export type ListKnowledgeChunksParams = {
  documentId: string
  knowledgeBaseId: string
}

export type ListKnowledgeChunksQuery = {
  workspaceId: string
  search?: string
  enabled?: 'true' | 'false' | 'all'
  sortBy?: 'chunkIndex' | 'tokenCount' | 'enabled'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListKnowledgeChunksResponseRef0 = {
  id: string
  chunkIndex: number
  content: string
  contentLength: number
  tokenCount: number
  enabled: boolean
  startOffset: number
  endOffset: number
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
  createdAt: string
  updatedAt: string
}

export type ListKnowledgeChunksResponse = {
  data: Array<ListKnowledgeChunksResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/documents` */
export type ListKnowledgeConnectorDocumentsParams = {
  connectorId: string
  knowledgeBaseId: string
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

/** `GET /api/v2/knowledge/[knowledgeBaseId]/connectors` */
export type ListKnowledgeConnectorsParams = {
  knowledgeBaseId: string
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
  status: 'active' | 'paused' | 'pending' | 'syncing' | 'error' | 'disabled'
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

/** `GET /api/v2/knowledge/[knowledgeBaseId]/documents` */
export type ListKnowledgeDocumentsParams = {
  knowledgeBaseId: string
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

/** `GET /api/v2/knowledge/[knowledgeBaseId]/tags` */
export type ListKnowledgeTagsParams = {
  knowledgeBaseId: string
}

export type ListKnowledgeTagsQuery = {
  workspaceId: string
}

type ListKnowledgeTagsResponseRef0 = {
  id: string
  displayName: string
  tagSlot: string
  fieldType: string
}

export type ListKnowledgeTagsResponse = {
  data: Array<ListKnowledgeTagsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/knowledge/[knowledgeBaseId]/tags/usage` */
export type ListKnowledgeTagUsageParams = {
  knowledgeBaseId: string
}

export type ListKnowledgeTagUsageQuery = {
  workspaceId: string
}

type ListKnowledgeTagUsageResponseRef0 = {
  id: string
  tagSlot: string
  displayName: string
  fieldType: string
  documentCount: number
  chunkCount: number
}

export type ListKnowledgeTagUsageResponse = {
  data: Array<ListKnowledgeTagUsageResponseRef0>
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
  status?: string
  workflowName?: string
  includeJobRuns?: boolean
  runId?: string
  sortBy?: 'startedAt' | 'durationMs' | 'cost' | 'status'
  sortOrder?: 'asc' | 'desc'
  folderPaths?: string
}

type ListLogsResponseRef0 = {
  kind: 'workflow' | 'job'
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
  files: Array<ListLogsResponseRef1> | null
  workflow?: {
    id: string | null
    name: string
    description: string | null
    deleted: boolean
  }
  finalOutput?: unknown
  traceSpans?: Array<ListLogsResponseRef2>
}

type ListLogsResponseRef1 = {
  id: string
  name: string
  size: number
  type: string
  downloadPath: string
}

type ListLogsResponseRef2 = {
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
  children?: Array<ListLogsResponseRef2>
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

/** `GET /api/v2/mcp-servers/[mcpServerId]/tools` */
export type ListMcpServerToolsParams = {
  mcpServerId: string
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

/** `GET /api/v2/sandboxes` */
export type ListSandboxesQuery = {
  workspaceId: string
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListSandboxesResponseRef0 = {
  id: string
  name: string
  language: 'javascript' | 'python'
  dependencies: Array<string>
  cliTools: Array<
    | 'google-cloud-cli@577.0.0-r1'
    | 'aws-cli@2.36.15-r1'
    | 'azure-cli@2.89.0-r1'
    | 'doctl@1.166.0-r1'
    | 'github-cli@2.97.0-r1'
    | 'gitlab-cli@1.111.0-r1'
    | 'kubectl@1.36.3-r1'
    | 'helm@4.2.3-r1'
    | 'kustomize@5.8.1-r1'
    | 'argocd@3.4.6-r1'
    | 'terraform@1.15.8-r1'
    | 'pulumi@3.255.0-r1'
    | 'supabase-cli@2.111.0-r1'
    | 'firebase-cli@15.25.1-r1'
    | 'flyctl@0.4.78-r1'
    | 'railway-cli@5.30.4-r1'
    | 'stripe-cli@1.45.0-r1'
    | 'duckdb@1.5.5-r1'
    | 'rclone@1.75.0-r1'
    | 'restic@0.19.1-r1'
    | 'minio-mc@RELEASE.2025-08-13T08-35-41Z-r1'
    | 'mongosh@2.9.2-r1'
    | 'sops@3.13.3-r1'
    | 'age@1.3.1-r1'
  >
  systemPackages: Array<string>
  buildStatus: 'pending' | 'building' | 'ready' | 'failed' | null
  errorCode: string | null
  errorMessage: string | null
  errorDetail: string | null
  builtAt: string | null
  createdAt: string
  updatedAt: string
}

export type ListSandboxesResponse = {
  data: Array<ListSandboxesResponseRef0>
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
  unredacted: boolean
  role: 'admin' | 'member'
  createdAt: string
  updatedAt: string
  value?: string
}

export type ListSecretsResponse = {
  data: Array<ListSecretsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/skills/[skillId]/editors` */
export type ListSkillEditorsParams = {
  skillId: string
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

/** `GET /api/v2/tables/[tableId]/dispatches` */
export type ListTableDispatchesParams = {
  tableId: string
}

export type ListTableDispatchesQuery = {
  workspaceId: string
}

type ListTableDispatchesResponseRef0 = {
  id: string
  tableId: string
  workspaceId: string
  status: 'pending' | 'dispatching' | 'complete' | 'canceled'
  mode: 'all' | 'incomplete' | 'new'
  scope: {
    groupIds: Array<string>
    rowIds?: Array<string>
    filtered?: boolean
    excludeRowIds?: Array<string>
  }
  limit: {
    type: 'rows'
    max: number
  } | null
  processedCount: number
  isManualRun: boolean
  requestedAt: string
  completedAt: string | null
  canceledAt: string | null
}

export type ListTableDispatchesResponse = {
  data: Array<ListTableDispatchesResponseRef0>
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
  includeRunState?: boolean
}

type ListTableRowsResponseRef0 = {
  id: string
  data: ListTableRowsResponseRef1
  runState?: Record<string, ListTableRowsResponseRef2>
  createdAt: string
  updatedAt: string
}

type ListTableRowsResponseRef1 = Record<string, unknown>

type ListTableRowsResponseRef2 = {
  status: string
  executionId: string | null
  workflowId: string
  error: string | null
  runningBlockIds: Array<string>
  blockErrors: Record<string, string>
  canceledAt: string | null
}

export type ListTableRowsResponse = {
  data: Array<ListTableRowsResponseRef0>
  nextCursor: string | null
}

/** `GET /api/v2/tables` */
type ListTablesQueryRef0 = string

export type ListTablesQuery = {
  workspaceId: string
  scope?: 'active' | 'archived'
  folderPath?: ListTablesQueryRef0
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListTablesResponseRef0 = {
  id: string
  webUrl: string
  name: string
  description: string | null
  ownerEmail: string
  schema: {
    columns: Array<{
      id?: string
      name: string
      type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'ttl' | 'json' | 'select'
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

/** `GET /api/v2/tools` */
export type ListToolsQuery = {
  workspaceId: string
  search?: string
  hostedApiKey?: 'always' | 'conditional' | 'none'
  oauthProvider?: string
  sortBy?: 'id' | 'name'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListToolsResponseRef0 = {
  id: string
  name: string
  description: string
  version?: string
  hostedApiKey: 'always' | 'conditional' | 'none'
  oauth?: {
    required: boolean
    provider: string
    requiredScopes?: Array<string>
  }
}

export type ListToolsResponse = {
  data: Array<ListToolsResponseRef0>
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

/** `GET /api/v2/workflow-mcp-servers` */
export type ListWorkflowMcpServersQuery = {
  workspaceId: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

type ListWorkflowMcpServersResponseRef0 = {
  id: string
  name: string
  description: string | null
  isPublic: boolean
  mcpServerUrl: string
  createdAt: string
  updatedAt: string
  toolCount: number
  toolNames: Array<string>
}

export type ListWorkflowMcpServersResponse = {
  data: Array<ListWorkflowMcpServersResponseRef0>
  nextCursor: string | null
  toolNamesTruncated: boolean
}

/** `GET /api/v2/workflow-mcp-servers/[serverId]/tools` */
export type ListWorkflowMcpToolsParams = {
  serverId: string
}

export type ListWorkflowMcpToolsQuery = Record<string, unknown>

type ListWorkflowMcpToolsResponseRef0 = {
  id: string
  serverId: string
  workflowId: string
  toolName: string
  toolDescription: string | null
  mcpServerUrl: string
  apiEndpoint: string
  createdAt: string
  updatedAt: string
}

export type ListWorkflowMcpToolsResponse = {
  data: Array<ListWorkflowMcpToolsResponseRef0>
  nextCursor: string | null
  truncated: boolean
}

/** `GET /api/v2/workflows/[workflowId]/runs` */
export type ListWorkflowRunsParams = {
  workflowId: string
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
  scope?: 'active' | 'archived'
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
  webUrl: string
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

/** `GET /api/v2/workflows/[workflowId]/versions` */
export type ListWorkflowVersionsParams = {
  workflowId: string
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

/** `POST /api/v2/tables/move` */
export type MoveTablesQuery = Record<string, unknown>

type MoveTablesBodyRef0 = string

export type MoveTablesBody = {
  workspaceId: string
  tableIds?: Array<string>
  folderPaths?: Array<MoveTablesBodyRef0>
  targetFolderPath?: MoveTablesBodyRef0
}

type MoveTablesResponseRef0 = {
  moved: Array<{
    kind: 'table' | 'folder'
    id: string
    name: string
  }>
  skipped: Array<{
    kind: 'table' | 'folder'
    id: string
    name: string
  }>
  notFound: Array<{
    kind: 'table' | 'folder'
    id: string
  }>
  failed: Array<{
    kind: 'table' | 'folder'
    id: string
    name: string
    reason: string
  }>
}

export type MoveTablesResponse = {
  data: MoveTablesResponseRef0
}

/** `POST /api/v2/workflows/move` */
export type MoveWorkflowsQuery = Record<string, unknown>

type MoveWorkflowsBodyRef0 = string

export type MoveWorkflowsBody = {
  workspaceId: string
  workflowIds: Array<string>
  folderPath: MoveWorkflowsBodyRef0
}

type MoveWorkflowsResponseRef0 = {
  moved: Array<string>
  failed: Array<string>
  folderPath: string
}

export type MoveWorkflowsResponse = {
  data: MoveWorkflowsResponseRef0
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
  includeRunState?: boolean
}

type QueryRowsResponseRef0 = {
  id: string
  data: QueryRowsResponseRef1
  runState?: Record<string, QueryRowsResponseRef2>
  createdAt: string
  updatedAt: string
}

type QueryRowsResponseRef1 = Record<string, unknown>

type QueryRowsResponseRef2 = {
  status: string
  executionId: string | null
  workflowId: string
  error: string | null
  runningBlockIds: Array<string>
  blockErrors: Record<string, string>
  canceledAt: string | null
}

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

/** `GET /api/v2/files/[fileId]/text` */
export type ReadFileTextParams = {
  fileId: string
}

export type ReadFileTextQuery = {
  workspaceId: string
  maxBytes?: number
  offset?: number
  limit?: number
}

type ReadFileTextResponseRef0 = {
  fileId: string
  name: string
  type: string
  text: string
  truncated: boolean
  degraded: boolean
  degradedReason: string | null
  charCount: number
  byteCount: number
  lineRange?: {
    offset: number
    lineCount: number
    totalLines: number
    totalLinesExact: boolean
  }
}

export type ReadFileTextResponse = {
  data: ReadFileTextResponseRef0
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
  webUrl: string
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

/** `PUT /api/v2/workflows/[workflowId]/deployments/chat` */
export type ReplaceWorkflowChatDeploymentParams = {
  workflowId: string
}

export type ReplaceWorkflowChatDeploymentQuery = Record<string, unknown>

type ReplaceWorkflowChatDeploymentBodyRef0 = {
  primaryColor?: string
  welcomeMessage?: string
  imageUrl?: string
}

type ReplaceWorkflowChatDeploymentBodyRef1 = {
  workflowId?: string
  blockId: string
  path: string
}

export type ReplaceWorkflowChatDeploymentBody = {
  identifier: string
  title: string
  description?: string
  customizations?: ReplaceWorkflowChatDeploymentBodyRef0
  authType?: 'public' | 'password' | 'email' | 'sso'
  password?: string
  allowedEmails?: Array<string>
  outputConfigs?: Array<ReplaceWorkflowChatDeploymentBodyRef1>
  includeThinking?: boolean
  includeToolCalls?: boolean
}

type ReplaceWorkflowChatDeploymentResponseRef0 = {
  primaryColor?: string
  welcomeMessage?: string
  imageUrl?: string
}

type ReplaceWorkflowChatDeploymentResponseRef1 = {
  workflowId?: string
  blockId: string
  path: string
}

type ReplaceWorkflowChatDeploymentResponseRef2 = {
  id: string
  workflowId: string
  workspaceId: string
  identifier: string
  url: string
  title: string
  description: string
  isActive: boolean
  authType: 'public' | 'password' | 'email' | 'sso'
  hasPassword: boolean
  allowedEmails: Array<string>
  customizations: ReplaceWorkflowChatDeploymentResponseRef0
  outputConfigs: Array<ReplaceWorkflowChatDeploymentResponseRef1>
  includeThinking: boolean
  includeToolCalls: boolean
  createdAt: string
  updatedAt: string
}

export type ReplaceWorkflowChatDeploymentResponse = {
  data: ReplaceWorkflowChatDeploymentResponseRef2
}

/** `PUT /api/v2/workflows/[workflowId]/state` */
export type ReplaceWorkflowStateParams = {
  workflowId: string
}

export type ReplaceWorkflowStateQuery = {
  dryRun?: boolean
}

type ReplaceWorkflowStateBodyRef0 = {
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
  errorEnabled?: boolean
  retry?: {
    enabled: boolean
    maxTries: number
    waitBetweenTriesMs: number
  }
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

type ReplaceWorkflowStateBodyRef1 = {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  type?: string
}

type ReplaceWorkflowStateBodyRef2 = {
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

type ReplaceWorkflowStateBodyRef3 = {
  id: string
  nodes: Array<string>
  distribution?: Array<unknown> | Record<string, unknown> | string
  count?: number
  parallelType?: 'count' | 'collection'
  batchSize?: number
  enabled?: boolean
  locked?: boolean
}

type ReplaceWorkflowStateBodyRef4 = {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'plain'
  value: unknown
}

export type ReplaceWorkflowStateBody = {
  blocks: Record<string, ReplaceWorkflowStateBodyRef0>
  edges: Array<ReplaceWorkflowStateBodyRef1>
  loops?: Record<string, ReplaceWorkflowStateBodyRef2>
  parallels?: Record<string, ReplaceWorkflowStateBodyRef3>
  variables?: Record<string, ReplaceWorkflowStateBodyRef4>
}

type ReplaceWorkflowStateResponseRef0 = {
  sources: Array<{
    blockId: string
    blockName: string | null
    blockType: string | null
  }>
  sinks: Array<{
    blockId: string
    blockName: string | null
    blockType: string | null
  }>
  orphanBlocks: Array<{
    blockId: string
    blockName: string | null
    blockType: string | null
  }>
  emptyOutgoingPorts: Array<{
    blockId: string
    blockName: string | null
    blockType: string | null
    handle: string
    label: string
  }>
  invalidBranchPorts: Array<{
    blockId: string
    blockName: string | null
    blockType: string | null
    sourceHandle: string
    reason: string
  }>
  invalidConnectionTargets: Array<{
    sourceBlockId: string
    sourceBlockName: string | null
    sourceHandle: string | null
    targetBlockId: string
    reason: string
  }>
  fieldIssues: Array<{
    blockId: string
    blockName: string | null
    blockType: string | null
    missingRequiredFields: Array<string>
    inactiveModeValues: Array<{
      canonicalId: string
      activeMemberId: string | null
      inactiveMemberId: string
      kind: 'credential' | 'resource' | 'other'
    }>
  }>
  unresolvedReferences: Array<{
    blockId: string
    blockName: string | null
    blockType: string | null
    field: string
    value: string | Array<string>
    kind: 'credential' | 'resource' | 'custom-tool' | 'mcp-tool' | 'skill'
    reason: string
  }>
  notes: Array<string>
}

type ReplaceWorkflowStateResponseRef1 = {
  id: string
  warnings: Array<string>
  needsRedeployment: boolean
  lint: ReplaceWorkflowStateResponseRef0
  dryRun: boolean
}

export type ReplaceWorkflowStateResponse = {
  data: ReplaceWorkflowStateResponseRef1
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
  webUrl: string
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

/** `POST /api/v2/files/folders/restore` */
export type RestoreFileFolderQuery = Record<string, unknown>

type RestoreFileFolderBodyRef0 = string

export type RestoreFileFolderBody = {
  workspaceId: string
  path: RestoreFileFolderBodyRef0
}

type RestoreFileFolderResponseRef0 = {
  name: string
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
}

type RestoreFileFolderResponseRef1 = {
  folder: RestoreFileFolderResponseRef0
  restoredItems: {
    files: number
    folders: number
  }
}

export type RestoreFileFolderResponse = {
  data: RestoreFileFolderResponseRef1
}

/** `POST /api/v2/knowledge/[knowledgeBaseId]/restore` */
export type RestoreKnowledgeBaseParams = {
  knowledgeBaseId: string
}

export type RestoreKnowledgeBaseQuery = Record<string, unknown>

export type RestoreKnowledgeBaseBody = {
  workspaceId: string
}

type RestoreKnowledgeBaseResponseRef0 = {
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

type RestoreKnowledgeBaseResponseRef1 = {
  id: string
  name: string
  description: string | null
  tokenCount: number
  embeddingModel: string
  embeddingDimension: number
  chunkingConfig: RestoreKnowledgeBaseResponseRef0
  docCount?: number
  connectorTypes?: Array<string>
  createdAt: string
  updatedAt: string
  webUrl: string
  ownerEmail: string
  folderPath: string
  deletedAt: string | null
}

export type RestoreKnowledgeBaseResponse = {
  data: RestoreKnowledgeBaseResponseRef1
}

/** `POST /api/v2/tables/[tableId]/restore` */
export type RestoreTableParams = {
  tableId: string
}

export type RestoreTableQuery = Record<string, unknown>

export type RestoreTableBody = {
  workspaceId: string
}

type RestoreTableResponseRef0 = {
  id: string | null
  type: 'import' | 'delete' | 'export' | 'backfill' | 'update' | null
  status: 'running' | 'ready' | 'failed' | 'canceled'
  rowsProcessed: number
  error: string | null
}

type RestoreTableResponseRef1 = {
  id: string
  webUrl: string
  name: string
  description: string | null
  ownerEmail: string
  schema: {
    columns: Array<{
      id?: string
      name: string
      type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'ttl' | 'json' | 'select'
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
  job: RestoreTableResponseRef0 | null
  createdAt: string
  updatedAt: string
}

export type RestoreTableResponse = {
  data: RestoreTableResponseRef1
}

/** `POST /api/v2/tables/folders/restore` */
export type RestoreTableFolderQuery = Record<string, unknown>

type RestoreTableFolderBodyRef0 = string

export type RestoreTableFolderBody = {
  workspaceId: string
  path: RestoreTableFolderBodyRef0
}

type RestoreTableFolderResponseRef0 = {
  name: string
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
}

type RestoreTableFolderResponseRef1 = {
  folder: RestoreTableFolderResponseRef0
  restoredItems: {
    folders: number
    tables: number
  }
}

export type RestoreTableFolderResponse = {
  data: RestoreTableFolderResponseRef1
}

/** `POST /api/v2/workflows/[workflowId]/restore` */
export type RestoreWorkflowParams = {
  workflowId: string
}

export type RestoreWorkflowQuery = Record<string, unknown>

type RestoreWorkflowResponseRef0 = {
  id: string
  webUrl: string
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

export type RestoreWorkflowResponse = {
  data: RestoreWorkflowResponseRef0
}

/** `POST /api/v2/workflows/[workflowId]/runs/[runId]/resume` */
export type ResumeWorkflowParams = {
  workflowId: string
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

/** `POST /api/v2/workflows/[workflowId]/versions/[version]/revert` */
export type RevertWorkflowVersionParams = {
  version: number | 'active'
  workflowId: string
}

export type RevertWorkflowVersionQuery = Record<string, unknown>

export type RevertWorkflowVersionBody = Record<string, unknown>

type RevertWorkflowVersionResponseRef0 = {
  id: string
  version: number | 'active'
  lastSaved: number
}

export type RevertWorkflowVersionResponse = {
  data: RevertWorkflowVersionResponseRef0
}

/** `DELETE /api/v2/skills/[skillId]/editors` */
export type RevokeSkillEditorParams = {
  skillId: string
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

/** `POST /api/v2/workflows/[workflowId]/rollback` */
export type RollbackWorkflowParams = {
  workflowId: string
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

/** `GET /api/v2/files/search` */
export type SearchFileContentQuery = {
  workspaceId: string
  query: string
  mode?: 'exact' | 'regex'
  maxResults?: number
  folderPaths?: string
  includeSubfolders?:
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

type SearchFileContentResponseRef0 = {
  results: Array<{
    fileId: string
    lineNumber: number
    text: string
  }>
  count: number
  truncated: boolean
  complete: boolean
  indexStatus: {
    readyFiles: number
    pendingFiles: number
    failedFiles: number
    skippedFiles: number
    partialFiles: number
  }
}

export type SearchFileContentResponse = {
  data: SearchFileContentResponseRef0
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

/** `POST /api/v2/tables/[tableId]/rows/search` */
export type SearchTableRowsParams = {
  tableId: string
}

export type SearchTableRowsQuery = Record<string, unknown>

type SearchTableRowsBodyRef0 =
  | {
      all: Array<
        | SearchTableRowsBodyRef0
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
        | SearchTableRowsBodyRef0
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

export type SearchTableRowsBody = {
  workspaceId: string
  q: string
  predicate?: SearchTableRowsBodyRef0
  sort?: Array<{
    field: string
    direction: 'asc' | 'desc'
  }>
}

type SearchTableRowsResponseRef0 = {
  ordinal: number
  rowId: string
  column: string
}

type SearchTableRowsResponseRef1 = {
  matches: Array<SearchTableRowsResponseRef0>
  truncated: boolean
}

export type SearchTableRowsResponse = {
  data: SearchTableRowsResponseRef1
}

/** `PUT /api/v2/secrets/[name]` */
export type SetSecretParams = {
  name: string
}

export type SetSecretQuery = Record<string, unknown>

export type SetSecretBody = {
  workspaceId: string
  scope: 'workspace' | 'personal'
  value?: string
  description?: string | null
  unredacted?: boolean
}

type SetSecretResponseRef0 = {
  name: string
  scope: 'workspace' | 'personal'
  description: string | null
  unredacted: boolean
  role: 'admin' | 'member'
  createdAt: string
  updatedAt: string
}

export type SetSecretResponse = {
  data: SetSecretResponseRef0
}

/** `POST /api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/sync` */
export type SyncKnowledgeConnectorParams = {
  connectorId: string
  knowledgeBaseId: string
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

/** `GET /api/v2/tables/[tableId]/exports/[exportId]/download` */
export type TableExportDownloadParams = {
  tableId: string
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

/** `DELETE /api/v2/workflows/[workflowId]/deploy` */
export type UndeployWorkflowParams = {
  workflowId: string
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

/** `DELETE /api/v2/workflow-mcp-servers/[serverId]/tools/[workflowId]` */
export type UndeployWorkflowMcpToolParams = {
  serverId: string
  workflowId: string
}

export type UndeployWorkflowMcpToolQuery = Record<string, unknown>

type UndeployWorkflowMcpToolResponseRef0 = {
  id: string
  serverId: string
  workflowId: string
  deleted: true
}

export type UndeployWorkflowMcpToolResponse = {
  data: UndeployWorkflowMcpToolResponseRef0
}

/** `POST /api/v2/files/[fileId]/unzip` */
export type UnzipFileParams = {
  fileId: string
}

export type UnzipFileQuery = Record<string, unknown>

export type UnzipFileBody = {
  workspaceId: string
}

type UnzipFileResponseRef0 = {
  folderPath: string
  extractedFileCount: number
  skippedFileCount: number
}

export type UnzipFileResponse = {
  data: UnzipFileResponseRef0
}

/** `PATCH /api/v2/credentials/[credentialId]` */
export type UpdateCredentialParams = {
  credentialId: string
}

export type UpdateCredentialQuery = {
  workspaceId: string
}

export type UpdateCredentialBody = {
  displayName?: string
  description?: string | null
  serviceAccountJson?: string
  apiToken?: string
  domain?: string
  atlassianProduct?: 'jira' | 'confluence'
  signingSecret?: string
  botToken?: string
  clientId?: string
  clientSecret?: string
  certificateId?: string
  orgId?: string
  dataCenter?: string
  authMethod?: string
  privateKey?: string
  username?: string
}

type UpdateCredentialResponseRef0 = {
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

export type UpdateCredentialResponse = {
  data: UpdateCredentialResponseRef0
}

/** `PATCH /api/v2/custom-tools/[customToolId]` */
export type UpdateCustomToolParams = {
  customToolId: string
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
  webUrl: string
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

/** `PATCH /api/v2/knowledge/[knowledgeBaseId]` */
export type UpdateKnowledgeBaseParams = {
  knowledgeBaseId: string
}

export type UpdateKnowledgeBaseQuery = Record<string, unknown>

type UpdateKnowledgeBaseBodyRef0 = {
  maxSize?: number
  minSize?: number
  overlap?: number
  strategy?: 'auto' | 'text' | 'regex' | 'recursive' | 'sentence' | 'token'
  strategyOptions?: {
    pattern?: string
    separators?: Array<string>
    recipe?: 'plain' | 'markdown' | 'code'
    strictBoundaries?: boolean
  }
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
  webUrl: string
  ownerEmail: string
  folderPath: string
  deletedAt: string | null
}

export type UpdateKnowledgeBaseResponse = {
  data: UpdateKnowledgeBaseResponseRef1
}

/** `PATCH /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]` */
export type UpdateKnowledgeChunkParams = {
  documentId: string
  chunkId: string
  knowledgeBaseId: string
}

export type UpdateKnowledgeChunkQuery = Record<string, unknown>

export type UpdateKnowledgeChunkBody = {
  workspaceId: string
  content?: string
  enabled?: boolean
}

type UpdateKnowledgeChunkResponseRef0 = {
  id: string
  chunkIndex: number
  content: string
  contentLength: number
  tokenCount: number
  enabled: boolean
  startOffset: number
  endOffset: number
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
  createdAt: string
  updatedAt: string
}

export type UpdateKnowledgeChunkResponse = {
  data: UpdateKnowledgeChunkResponseRef0
}

/** `PATCH /api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]` */
export type UpdateKnowledgeConnectorParams = {
  connectorId: string
  knowledgeBaseId: string
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
  status: 'active' | 'paused' | 'pending' | 'syncing' | 'error' | 'disabled'
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

/** `PATCH /api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/documents` */
export type UpdateKnowledgeConnectorDocumentsParams = {
  connectorId: string
  knowledgeBaseId: string
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

/** `PATCH /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]` */
export type UpdateKnowledgeDocumentParams = {
  documentId: string
  knowledgeBaseId: string
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

/** `PATCH /api/v2/knowledge/[knowledgeBaseId]/tags/[tagId]` */
export type UpdateKnowledgeTagParams = {
  tagId: string
  knowledgeBaseId: string
}

export type UpdateKnowledgeTagQuery = Record<string, unknown>

export type UpdateKnowledgeTagBody = {
  workspaceId: string
  displayName?: string
  fieldType?: 'text' | 'number' | 'date' | 'boolean'
}

type UpdateKnowledgeTagResponseRef0 = {
  id: string
  displayName: string
  tagSlot: string
  fieldType: string
}

export type UpdateKnowledgeTagResponse = {
  data: UpdateKnowledgeTagResponseRef0
}

/** `PATCH /api/v2/mcp-servers/[mcpServerId]` */
export type UpdateMcpServerParams = {
  mcpServerId: string
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

/** `PATCH /api/v2/sandboxes/[sandboxId]` */
export type UpdateSandboxParams = {
  sandboxId: string
}

export type UpdateSandboxQuery = Record<string, unknown>

export type UpdateSandboxBody = {
  workspaceId: string
  name?: string
  language?: 'javascript' | 'python'
  dependencies?: Array<string>
  cliTools?: Array<
    | 'google-cloud-cli@577.0.0-r1'
    | 'aws-cli@2.36.15-r1'
    | 'azure-cli@2.89.0-r1'
    | 'doctl@1.166.0-r1'
    | 'github-cli@2.97.0-r1'
    | 'gitlab-cli@1.111.0-r1'
    | 'kubectl@1.36.3-r1'
    | 'helm@4.2.3-r1'
    | 'kustomize@5.8.1-r1'
    | 'argocd@3.4.6-r1'
    | 'terraform@1.15.8-r1'
    | 'pulumi@3.255.0-r1'
    | 'supabase-cli@2.111.0-r1'
    | 'firebase-cli@15.25.1-r1'
    | 'flyctl@0.4.78-r1'
    | 'railway-cli@5.30.4-r1'
    | 'stripe-cli@1.45.0-r1'
    | 'duckdb@1.5.5-r1'
    | 'rclone@1.75.0-r1'
    | 'restic@0.19.1-r1'
    | 'minio-mc@RELEASE.2025-08-13T08-35-41Z-r1'
    | 'mongosh@2.9.2-r1'
    | 'sops@3.13.3-r1'
    | 'age@1.3.1-r1'
  >
  systemPackages?: Array<string>
}

type UpdateSandboxResponseRef0 = {
  id: string
  name: string
  language: 'javascript' | 'python'
  dependencies: Array<string>
  cliTools: Array<
    | 'google-cloud-cli@577.0.0-r1'
    | 'aws-cli@2.36.15-r1'
    | 'azure-cli@2.89.0-r1'
    | 'doctl@1.166.0-r1'
    | 'github-cli@2.97.0-r1'
    | 'gitlab-cli@1.111.0-r1'
    | 'kubectl@1.36.3-r1'
    | 'helm@4.2.3-r1'
    | 'kustomize@5.8.1-r1'
    | 'argocd@3.4.6-r1'
    | 'terraform@1.15.8-r1'
    | 'pulumi@3.255.0-r1'
    | 'supabase-cli@2.111.0-r1'
    | 'firebase-cli@15.25.1-r1'
    | 'flyctl@0.4.78-r1'
    | 'railway-cli@5.30.4-r1'
    | 'stripe-cli@1.45.0-r1'
    | 'duckdb@1.5.5-r1'
    | 'rclone@1.75.0-r1'
    | 'restic@0.19.1-r1'
    | 'minio-mc@RELEASE.2025-08-13T08-35-41Z-r1'
    | 'mongosh@2.9.2-r1'
    | 'sops@3.13.3-r1'
    | 'age@1.3.1-r1'
  >
  systemPackages: Array<string>
  buildStatus: 'pending' | 'building' | 'ready' | 'failed' | null
  errorCode: string | null
  errorMessage: string | null
  errorDetail: string | null
  builtAt: string | null
  createdAt: string
  updatedAt: string
}

export type UpdateSandboxResponse = {
  data: UpdateSandboxResponseRef0
}

/** `PATCH /api/v2/skills/[skillId]` */
export type UpdateSkillParams = {
  skillId: string
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
  webUrl: string
  name: string
  description: string | null
  ownerEmail: string
  schema: {
    columns: Array<{
      id?: string
      name: string
      type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'ttl' | 'json' | 'select'
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
    type?: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'ttl' | 'json' | 'select'
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
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'ttl' | 'json' | 'select'
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
  status: string
  executionId: string | null
  workflowId: string
  error: string | null
  runningBlockIds: Array<string>
  blockErrors: Record<string, string>
  canceledAt: string | null
}

type UpdateTableRowResponseRef2 = {
  id: string
  data: UpdateTableRowResponseRef0
  runState?: Record<string, UpdateTableRowResponseRef1>
  createdAt: string
  updatedAt: string
}

export type UpdateTableRowResponse = {
  data: UpdateTableRowResponseRef2
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

/** `PATCH /api/v2/workflows/[workflowId]` */
export type UpdateWorkflowParams = {
  workflowId: string
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
  webUrl: string
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
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'ttl' | 'json' | 'select'
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
    type: 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'ttl' | 'json' | 'select'
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

/** `PATCH /api/v2/workflow-mcp-servers/[serverId]` */
export type UpdateWorkflowMcpServerParams = {
  serverId: string
}

export type UpdateWorkflowMcpServerQuery = Record<string, unknown>

export type UpdateWorkflowMcpServerBody = {
  name?: string
  description?: string | null
  isPublic?: boolean
}

type UpdateWorkflowMcpServerResponseRef0 = {
  id: string
  name: string
  description: string | null
  isPublic: boolean
  mcpServerUrl: string
  createdAt: string
  updatedAt: string
}

export type UpdateWorkflowMcpServerResponse = {
  data: UpdateWorkflowMcpServerResponseRef0
}

/** `PATCH /api/v2/workflows/[workflowId]/deployment` */
export type UpdateWorkflowPublicApiParams = {
  workflowId: string
}

export type UpdateWorkflowPublicApiQuery = Record<string, unknown>

export type UpdateWorkflowPublicApiBody = {
  isPublicApi: boolean
}

type UpdateWorkflowPublicApiResponseRef0 = {
  id: string
  isPublicApi: boolean
}

export type UpdateWorkflowPublicApiResponse = {
  data: UpdateWorkflowPublicApiResponseRef0
}

/** `PATCH /api/v2/workflows/[workflowId]/versions/[version]` */
export type UpdateWorkflowVersionParams = {
  version: number
  workflowId: string
}

export type UpdateWorkflowVersionQuery = Record<string, unknown>

export type UpdateWorkflowVersionBody = {
  name?: string
  description?: string | null
}

type UpdateWorkflowVersionResponseRef0 = {
  version: number
  name: string | null
  description: string | null
}

export type UpdateWorkflowVersionResponse = {
  data: UpdateWorkflowVersionResponseRef0
}

/** `POST /api/v2/knowledge/[knowledgeBaseId]/documents` */
export type UploadKnowledgeDocumentParams = {
  knowledgeBaseId: string
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
  status: string
  executionId: string | null
  workflowId: string
  error: string | null
  runningBlockIds: Array<string>
  blockErrors: Record<string, string>
  canceledAt: string | null
}

type UpsertTableRowResponseRef2 = {
  id: string
  data: UpsertTableRowResponseRef0
  runState?: Record<string, UpsertTableRowResponseRef1>
  createdAt: string
  updatedAt: string
}

type UpsertTableRowResponseRef3 = {
  row: UpsertTableRowResponseRef2
  operation: 'insert' | 'update'
}

export type UpsertTableRowResponse = {
  data: UpsertTableRowResponseRef3
}

/**
 * Every v2 operation, keyed by name.
 *
 * `query`, `body`, and `headers` describe each field well enough for the CLI
 * to build a flag for it and coerce the string argv gives back: its kind,
 * whether it is required, its enum values, and its server-side default. A slot
 * the contract does not declare — or one whose shape is a union with no flat
 * field list — is absent, and the runtime falls back to taking it as JSON.
 * Headers the CLI sets itself, such as the API key, are never listed.
 *
 * `summary` is the operation's one-line description, lifted from the OpenAPI
 * specs so `--help` reuses prose that is already written and already checked.
 *
 * `workspaceKeyUnsupported` marks an operation whose spec says a workspace
 * API key is rejected, so `--help` can say so before the request is sent.
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
    headers: {
      'upload-token': {
        kind: 'string',
        required: true,
        describe: 'Signed upload control token returned when the upload session was created.',
      },
    },
  },
  abortKnowledgeDocumentUpload: {
    method: 'DELETE',
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]',
    pathParams: ['knowledgeBaseId', 'uploadId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Unique knowledge base identifier.',
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
    headers: {
      'upload-token': {
        kind: 'string',
        required: true,
        describe: 'Signed upload control token returned when the upload session was created.',
      },
    },
  },
  activateWorkflowVersion: {
    method: 'POST',
    path: '/api/v2/workflows/[workflowId]/versions/[version]/activate',
    pathParams: ['workflowId', 'version'] as const,
    pathParamDocs: {
      workflowId: 'Unique workflow identifier.',
      version: 'Numeric deployment version.',
    },
    responseMode: 'json',
    summary: 'Activate Workflow Version',
    workspaceKeyUnsupported: true,
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
  addWorkspaceFilesToKnowledgeBase: {
    method: 'POST',
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents/from-workspace-files',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'Index Workspace Files',
    workspaceKeyUnsupported: true,
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns both the files and the base.',
      },
      fileReferences: {
        kind: 'array',
        required: true,
        describe:
          'Workspace file identifiers or storage keys to index. Duplicates resolving to the same file are indexed once.',
      },
    },
  },
  applyWorkflowOperations: {
    method: 'POST',
    path: '/api/v2/workflows/[workflowId]/operations',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Apply Workflow Operations',
    workspaceKeyUnsupported: true,
    query: {
      dryRun: {
        kind: 'boolean',
        describe:
          'Validate and lint without persisting. The response is identical to the committed write of the same body, so a caller can inspect `lint` and then re-send the request for real. Nothing is written, no audit entry is recorded, and collaborators are not notified.',
      },
    },
    body: {
      operations: { kind: 'array', required: true, describe: 'Edits to apply, in a single batch.' },
      atomic: {
        kind: 'boolean',
        default: false,
        describe:
          'Fail the whole batch when any operation is declined or any block input would be dropped. The default applies what it can and reports the rest in `skipped` and `inputValidationErrors`; `true` writes nothing and answers `409` instead.',
      },
      layout: {
        kind: 'enum',
        values: ['targeted', 'none'] as const,
        default: 'targeted',
        describe:
          'Whether to reposition blocks the batch touched. `targeted` (default) nudges only the affected subgraph; `none` leaves every position exactly as supplied.',
      },
      setBlockEnabled: {
        kind: 'array',
        describe:
          'Blocks to enable or disable, applied after `operations`. Disabling a loop or parallel cascades to its unlocked descendants; enabling a block whose container is disabled is declined.',
      },
    },
  },
  applyWorkflowVariables: {
    method: 'PATCH',
    path: '/api/v2/workflows/[workflowId]/variables',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Update Workflow Variables',
    body: {
      operations: {
        kind: 'array',
        required: true,
        describe: 'Variable changes to apply, in order.',
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
  bulkDeleteTables: {
    method: 'POST',
    path: '/api/v2/tables/bulk-delete',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Bulk Delete Tables and Folders',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns every selected item.',
      },
      tableIds: { kind: 'array', default: [], describe: 'Tables to archive, by identifier.' },
      folderPaths: {
        kind: 'array',
        describe:
          'Table folders to delete, by canonical path. Each cascades to everything inside it.',
      },
    },
  },
  bulkDownloadFiles: {
    method: 'GET',
    path: '/api/v2/files/bulk-download',
    pathParams: [] as const,
    responseMode: 'binary',
    summary: 'Bulk Download Files',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace containing the selection.',
      },
      fileIds: {
        kind: 'string',
        describe: 'File identifiers to include, comma-separated. At most 100 entries.',
      },
      folderPaths: {
        kind: 'string',
        describe:
          'Comma-separated folder paths whose contents are included recursively. Up to 100 paths; resolved files share the 100-file download limit. Unknown paths are rejected.',
      },
    },
  },
  bulkSaveKnowledgeTagDefinitions: {
    method: 'PUT',
    path: '/api/v2/knowledge/[knowledgeBaseId]/tags',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'Bulk Save Tag Definitions',
    workspaceKeyUnsupported: true,
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      definitions: {
        kind: 'array',
        required: true,
        describe: 'Tag definitions to create or update on the knowledge base.',
      },
    },
  },
  bulkUpdateKnowledgeChunks: {
    method: 'PATCH',
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks',
    pathParams: ['knowledgeBaseId', 'documentId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Unique knowledge base identifier.',
      documentId: 'Unique knowledge document identifier.',
    },
    responseMode: 'json',
    summary: 'Bulk Update Chunks',
    workspaceKeyUnsupported: true,
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      operation: {
        kind: 'enum',
        required: true,
        values: ['enable', 'disable', 'delete'] as const,
        describe: 'What to do with the selected chunks.',
      },
      chunkIds: {
        kind: 'array',
        required: true,
        describe:
          'Chunks to operate on, by identifier. An id naming no chunk in the document is reported in errors and does not fail the request.',
      },
    },
  },
  bulkUpdateKnowledgeDocuments: {
    method: 'PATCH',
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'Bulk Enable or Disable Documents',
    workspaceKeyUnsupported: true,
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
  bulkUpdateTableRows: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/rows/bulk-update',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Bulk Update Rows',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the table.' },
      updates: {
        kind: 'array',
        required: true,
        describe: 'One merge patch per row. Each row identifier may appear at most once.',
      },
    },
  },
  cancelTableDispatch: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]/dispatches/[dispatchId]',
    pathParams: ['tableId', 'dispatchId'] as const,
    pathParamDocs: {
      tableId: 'Unique table identifier.',
      dispatchId: 'Unique table run-dispatch identifier.',
    },
    responseMode: 'json',
    summary: 'Cancel Run Dispatch',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the transfer resource.',
      },
    },
  },
  cancelTableExport: {
    method: 'DELETE',
    path: '/api/v2/tables/[tableId]/exports/[exportId]',
    pathParams: ['tableId', 'exportId'] as const,
    pathParamDocs: {
      tableId: 'Unique table identifier.',
      exportId: 'Unique table-export identifier.',
    },
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
    headers: {
      'upload-token': {
        kind: 'string',
        describe: 'Signed upload control token returned when an upload-backed import was created.',
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
          'Recursive non-empty `all`/`any` groups containing groups or conditions; the root cannot be a condition. Limits: 100 members per group, 10 levels, and 500 nodes. The negating operators include nulls and absent cells, multi-select included; combine with `isNotNull` or `isNotEmpty` to exclude them. Pattern operators use `*` as the only wildcard; `%`, `_`, and backslash are literal. Select operators: single-select uses `eq`/`ne`/`in`/`nin`; multi-select uses `contains`/`ncontains`; option names resolve to IDs. Full operand rules are documented on `op`.',
      },
      excludeRowIds: { kind: 'array', describe: 'Rows excluded from an all-scope cancellation.' },
    },
  },
  cancelWorkflowRun: {
    method: 'POST',
    path: '/api/v2/workflows/[workflowId]/runs/[runId]/cancel',
    pathParams: ['workflowId', 'runId'] as const,
    pathParamDocs: {
      workflowId: 'Unique workflow identifier.',
      runId: 'Unique workflow run identifier.',
    },
    responseMode: 'json',
    summary: 'Cancel Workflow Run',
  },
  chat: {
    method: 'POST',
    path: '/api/v2/chat',
    pathParams: [] as const,
    responseMode: 'json',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace the conversation runs in.',
      },
      message: { kind: 'string', required: true, describe: 'The message to send to Sim.' },
      conversationId: {
        kind: 'string',
        describe: 'Conversation to continue; a new one starts when omitted.',
      },
    },
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
    headers: {
      'upload-token': {
        kind: 'string',
        required: true,
        describe: 'Signed upload control token returned when the upload session was created.',
      },
    },
  },
  completeKnowledgeDocumentUpload: {
    method: 'POST',
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/complete',
    pathParams: ['knowledgeBaseId', 'uploadId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Unique knowledge base identifier.',
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
    headers: {
      'upload-token': {
        kind: 'string',
        required: true,
        describe: 'Signed upload control token returned when the upload session was created.',
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
    headers: {
      'upload-token': {
        kind: 'string',
        required: true,
        describe: 'Signed upload control token returned when the upload session was created.',
      },
    },
  },
  createCredentialConnection: {
    method: 'POST',
    path: '/api/v2/credentials/connections',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Credential Connection',
    workspaceKeyUnsupported: true,
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
    headers: {
      'upload-token': {
        kind: 'string',
        required: true,
        describe: 'Signed upload control token returned when the upload session was created.',
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
  createKnowledgeChunk: {
    method: 'POST',
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks',
    pathParams: ['knowledgeBaseId', 'documentId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Unique knowledge base identifier.',
      documentId: 'Unique knowledge document identifier.',
    },
    responseMode: 'json',
    summary: 'Create Chunk',
    workspaceKeyUnsupported: true,
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      content: {
        kind: 'string',
        required: true,
        describe: 'Text to embed. It is embedded on write, so the chunk is searchable immediately.',
      },
      enabled: {
        kind: 'boolean',
        default: true,
        describe: 'Whether the new chunk participates in search.',
      },
    },
  },
  createKnowledgeConnector: {
    method: 'POST',
    path: '/api/v2/knowledge/[knowledgeBaseId]/connectors',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'Create Knowledge Connector',
    workspaceKeyUnsupported: true,
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
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents/uploads',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
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
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/parts',
    pathParams: ['knowledgeBaseId', 'uploadId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Unique knowledge base identifier.',
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
    headers: {
      'upload-token': {
        kind: 'string',
        required: true,
        describe: 'Signed upload control token returned when the upload session was created.',
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
  createKnowledgeTag: {
    method: 'POST',
    path: '/api/v2/knowledge/[knowledgeBaseId]/tags',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'Create Tag',
    workspaceKeyUnsupported: true,
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      displayName: {
        kind: 'string',
        required: true,
        describe: 'Name tag filters and document reads use for this tag.',
      },
      fieldType: {
        kind: 'enum',
        values: ['text', 'number', 'date', 'boolean'] as const,
        default: 'text',
        describe:
          'Value type stored in the slot; it decides which slots are usable and which filter operators apply. Slot capacity per type: text 7, number 5, date 2, boolean 3.',
      },
      tagSlot: {
        kind: 'enum',
        values: [
          'tag1',
          'tag2',
          'tag3',
          'tag4',
          'tag5',
          'tag6',
          'tag7',
          'number1',
          'number2',
          'number3',
          'number4',
          'number5',
          'date1',
          'date2',
          'boolean1',
          'boolean2',
          'boolean3',
        ] as const,
        describe:
          'Slot to store the tag in. Omit to take the next free slot for the field type; a slot that does not belong to the field type, or one already in use, is rejected.',
      },
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
        describe: 'Transport protocol. Defaults to `streamable-http` on creation.',
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
        describe: 'Per-request timeout in milliseconds. Defaults to 30000 on creation.',
      },
      retries: {
        kind: 'integer',
        default: 3,
        describe: 'Number of retries per request. Defaults to 3 on creation.',
      },
      enabled: {
        kind: 'boolean',
        default: true,
        describe: "Whether workflows can use the server's tools. Defaults to true on creation.",
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
  createSandbox: {
    method: 'POST',
    path: '/api/v2/sandboxes',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Sandbox',
    workspaceKeyUnsupported: true,
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace in which to create the sandbox.',
      },
      name: {
        kind: 'string',
        required: true,
        describe: 'Display name, unique within the workspace; 1 to 64 characters.',
      },
      language: {
        kind: 'enum',
        required: true,
        values: ['javascript', 'python'] as const,
        describe: 'Dependency ecosystem: `javascript` installs from npm, `python` from PyPI.',
      },
      dependencies: {
        kind: 'array',
        default: [],
        describe: 'Package specifiers installed into the sandbox, one per entry.',
      },
      cliTools: {
        kind: 'array',
        default: [],
        describe: 'Pinned managed CLI ids installed into the sandbox, at most 10, no duplicates.',
      },
      systemPackages: {
        kind: 'array',
        default: [],
        describe: 'Debian packages installed into the sandbox, one per entry.',
      },
    },
  },
  createServiceAccountCredential: {
    method: 'POST',
    path: '/api/v2/credentials',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Service-Account Credential',
    workspaceKeyUnsupported: true,
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
    workspaceKeyUnsupported: true,
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
  createTableDispatch: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/dispatches',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Create Run Dispatch',
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
          'Recursive non-empty `all`/`any` groups containing groups or conditions; the root cannot be a condition. Limits: 100 members per group, 10 levels, and 500 nodes. The negating operators include nulls and absent cells, multi-select included; combine with `isNotNull` or `isNotEmpty` to exclude them. Pattern operators use `*` as the only wildcard; `%`, `_`, and backslash are literal. Select operators: single-select uses `eq`/`ne`/`in`/`nin`; multi-select uses `contains`/`ncontains`; option names resolve to IDs. Full operand rules are documented on `op`.',
      },
      excludeRowIds: { kind: 'array', describe: 'Rows excluded from a select-all run scope.' },
      limit: { kind: 'object', describe: 'Optional cap on eligible rows to run.' },
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
    headers: {
      'upload-token': {
        kind: 'string',
        required: true,
        describe: 'Signed upload control token returned when the upload session was created.',
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
  createWorkflowMcpServer: {
    method: 'POST',
    path: '/api/v2/workflow-mcp-servers',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Create Workflow MCP Server',
    workspaceKeyUnsupported: true,
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace in which to publish the server.',
      },
      name: {
        kind: 'string',
        required: true,
        describe: 'Server display name, shown to connecting MCP clients.',
      },
      description: { kind: 'string', describe: 'Optional server description.' },
      isPublic: {
        kind: 'boolean',
        default: false,
        describe:
          'Whether the server answers MCP clients without a Sim API key. Defaults to false — a public server executes the workflows it publishes for anyone holding its URL.',
      },
      workflowIds: {
        kind: 'array',
        describe: 'Deployed workflows to publish as tools on the new server.',
      },
    },
  },
  deleteCredential: {
    method: 'DELETE',
    path: '/api/v2/credentials/[credentialId]',
    pathParams: ['credentialId'] as const,
    pathParamDocs: { credentialId: 'Credential to disconnect.' },
    responseMode: 'json',
    summary: 'Disconnect Credential',
    workspaceKeyUnsupported: true,
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
    path: '/api/v2/custom-tools/[customToolId]',
    pathParams: ['customToolId'] as const,
    pathParamDocs: { customToolId: 'Unique custom tool identifier.' },
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
    path: '/api/v2/knowledge/[knowledgeBaseId]',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
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
  deleteKnowledgeChunk: {
    method: 'DELETE',
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]',
    pathParams: ['knowledgeBaseId', 'documentId', 'chunkId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Unique knowledge base identifier.',
      documentId: 'Unique knowledge document identifier.',
      chunkId: 'Unique chunk identifier.',
    },
    responseMode: 'json',
    summary: 'Delete Chunk',
    workspaceKeyUnsupported: true,
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
    path: '/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]',
    pathParams: ['knowledgeBaseId', 'connectorId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Knowledge base that owns the connector.',
      connectorId: 'Connector selected for the operation.',
    },
    responseMode: 'json',
    summary: 'Delete Knowledge Connector',
    workspaceKeyUnsupported: true,
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
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]',
    pathParams: ['knowledgeBaseId', 'documentId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Unique knowledge base identifier.',
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
  deleteKnowledgeTag: {
    method: 'DELETE',
    path: '/api/v2/knowledge/[knowledgeBaseId]/tags/[tagId]',
    pathParams: ['knowledgeBaseId', 'tagId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Unique knowledge base identifier.',
      tagId: 'Unique tag definition identifier.',
    },
    responseMode: 'json',
    summary: 'Delete Tag',
    workspaceKeyUnsupported: true,
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
    },
  },
  deleteKnowledgeTagDefinitions: {
    method: 'DELETE',
    path: '/api/v2/knowledge/[knowledgeBaseId]/tags',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'Delete Tag Definitions',
    workspaceKeyUnsupported: true,
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      unused: {
        kind: 'boolean',
        describe:
          'Whether to remove only the tag definitions no document in the knowledge base still carries a value for. Defaults to true. Pass `unused=false` to delete every definition on the knowledge base, which also clears its slot on every document and chunk and is not recoverable.',
      },
    },
  },
  deleteMcpServer: {
    method: 'DELETE',
    path: '/api/v2/mcp-servers/[mcpServerId]',
    pathParams: ['mcpServerId'] as const,
    pathParamDocs: { mcpServerId: 'Unique MCP server identifier.' },
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
  deleteSandbox: {
    method: 'DELETE',
    path: '/api/v2/sandboxes/[sandboxId]',
    pathParams: ['sandboxId'] as const,
    pathParamDocs: { sandboxId: 'Unique sandbox identifier.' },
    responseMode: 'json',
    summary: 'Delete Sandbox',
    workspaceKeyUnsupported: true,
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the sandbox.' },
    },
  },
  deleteSecret: {
    method: 'DELETE',
    path: '/api/v2/secrets/[name]',
    pathParams: ['name'] as const,
    pathParamDocs: { name: 'Secret to delete.' },
    responseMode: 'json',
    summary: 'Delete Secret',
    workspaceKeyUnsupported: true,
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
    path: '/api/v2/skills/[skillId]',
    pathParams: ['skillId'] as const,
    pathParamDocs: {
      skillId:
        'Unique skill identifier. A built-in skill is `builtin-` followed by its name, for example `builtin-research`.',
    },
    responseMode: 'json',
    summary: 'Delete Skill',
    workspaceKeyUnsupported: true,
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
          'Recursive non-empty `all`/`any` groups containing groups or conditions; the root cannot be a condition. Limits: 100 members per group, 10 levels, and 500 nodes. The negating operators include nulls and absent cells, multi-select included; combine with `isNotNull` or `isNotEmpty` to exclude them. Pattern operators use `*` as the only wildcard; `%`, `_`, and backslash are literal. Select operators: single-select uses `eq`/`ne`/`in`/`nin`; multi-select uses `contains`/`ncontains`; option names resolve to IDs. Full operand rules are documented on `op`.',
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
    path: '/api/v2/workflows/[workflowId]',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Delete Workflow',
  },
  deleteWorkflowChatDeployment: {
    method: 'DELETE',
    path: '/api/v2/workflows/[workflowId]/deployments/chat',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Delete Workflow Chat Deployment',
    workspaceKeyUnsupported: true,
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
  deleteWorkflowMcpServer: {
    method: 'DELETE',
    path: '/api/v2/workflow-mcp-servers/[serverId]',
    pathParams: ['serverId'] as const,
    pathParamDocs: { serverId: 'Unique workflow-MCP server identifier.' },
    responseMode: 'json',
    summary: 'Delete Workflow MCP Server',
    workspaceKeyUnsupported: true,
  },
  deployWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[workflowId]/deploy',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Deploy Workflow',
    workspaceKeyUnsupported: true,
    body: {
      name: { kind: 'string', describe: 'Optional label for the deployment version.' },
      description: {
        kind: 'string',
        describe: 'Optional release note for the deployment version.',
      },
    },
  },
  deployWorkflowMcpTool: {
    method: 'POST',
    path: '/api/v2/workflow-mcp-servers/[serverId]/tools',
    pathParams: ['serverId'] as const,
    pathParamDocs: { serverId: 'Unique workflow-MCP server identifier.' },
    responseMode: 'json',
    summary: 'Publish Workflow As MCP Tool',
    workspaceKeyUnsupported: true,
    body: {
      workflowId: {
        kind: 'string',
        required: true,
        describe: 'Deployed workflow to publish. The workflow must already be deployed.',
      },
      toolName: {
        kind: 'string',
        describe:
          'Name MCP clients call. Normalized to the MCP tool-name grammar, and derived from the workflow name when omitted.',
      },
      toolDescription: {
        kind: 'string',
        describe: 'Description shown to MCP clients. Derived from the workflow name when omitted.',
      },
      parameterDescriptions: {
        kind: 'array',
        describe:
          'Per-field description overrides applied to the schema generated from the deployed workflow inputs. A name matching no input field is ignored.',
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
  downloadRunFile: {
    method: 'GET',
    path: '/api/v2/workflows/[workflowId]/runs/[runId]/files/[fileId]',
    pathParams: ['workflowId', 'runId', 'fileId'] as const,
    pathParamDocs: {
      workflowId: 'Unique workflow identifier.',
      runId: 'Unique workflow run identifier.',
      fileId: 'Identifier of a file the run produced, as reported by the run resource.',
    },
    responseMode: 'binary',
    summary: 'Download Workflow Run File',
  },
  duplicateWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[workflowId]/duplicate',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Duplicate Workflow',
    body: {
      name: {
        kind: 'string',
        describe: 'Name for the copy. Defaults to the source name, deduplicated within the folder.',
      },
      folderPath: {
        kind: 'string',
        describe: "Destination folder path. Defaults to the source workflow's folder.",
      },
    },
  },
  editFileContent: {
    method: 'PATCH',
    path: '/api/v2/files/[fileId]/content',
    pathParams: ['fileId'] as const,
    pathParamDocs: { fileId: 'File identifier.' },
    responseMode: 'json',
    summary: 'Edit File Content',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the file.' },
      edit: {
        kind: 'unknown',
        required: true,
        describe:
          'One exact or anchor-based edit: search_replace, replace_between, insert_after, or delete_between.',
      },
    },
  },
  executeTool: {
    method: 'POST',
    path: '/api/v2/tools/[toolId]/execute',
    pathParams: ['toolId'] as const,
    pathParamDocs: {
      toolId:
        'Tool identifier. An unversioned name resolves to the newest version, and the response echoes the resolved id.',
    },
    responseMode: 'json',
    summary: 'Run Tool',
    workspaceKeyUnsupported: true,
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe:
          'Workspace whose integration allowlist, credentials, and environment variables govern this call.',
      },
      input: {
        kind: 'object',
        default: {},
        describe:
          'Tool arguments keyed by published parameter IDs. For `user-only` parameters, a whole-value `{{VAR_NAME}}` reference resolves a workspace environment variable. Other values pass through unchanged.',
      },
      credentialId: {
        kind: 'string',
        describe:
          'Credential to authenticate with. Required when the tool declares an OAuth requirement; the workspace credentials list names the candidates.',
      },
      timeoutSeconds: {
        kind: 'integer',
        describe: 'How long to wait for the tool before abandoning the call.',
      },
    },
  },
  executeWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[workflowId]/execute',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Execute Workflow',
    body: {
      input: {
        kind: 'object',
        describe: 'Workflow input keyed by the selected trigger input-field name.',
      },
      run: {
        kind: 'unknown',
        describe:
          'Workflow state and entry point to execute. Omit for the active deployment. Manual execution requires OAuth or personal-key write access and supports synchronous or streamed runs only.',
      },
      async: {
        kind: 'boolean',
        default: false,
        describe:
          'Queue the run and return a 202 receipt when true. Requires an OAuth access token or API key, cannot be combined with `stream`, and rejects all streaming and output-shaping options (`selectedOutputs`, `includeThinking`, `includeToolCalls`, `includeFileBase64`, `base64MaxBytes`).',
      },
      executionTimeoutSeconds: {
        kind: 'integer',
        describe:
          "Maximum duration of an asynchronous run, in seconds, capped by the plan's execution timeout. Requires `async: true`; otherwise returns `400`.",
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
          'Output references for streaming: `<blockName>.<outputPath>` or `<childWorkflowId>.<blockName>.<outputPath>`, using normalized block names. Child references apply to every invocation. Requires `stream: true` and rejects synchronous or async requests. Use `selectedOutputs` with Get Workflow Run to narrow an existing run.',
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
          'Maximum total bytes of file content to inline as base64, lowering but never raising the server limit of 16 MiB. Rejected when `async` is true.',
      },
    },
    headers: {
      'x-run-id': {
        kind: 'string',
        describe:
          'Run ID for API-key or OAuth callers; ignored for anonymous requests. Reuse it after an uncertain response: a claimed ID returns `409` with `RUN_ID_CONFLICT`, without replaying results. Check Get Workflow Run, but `404` can persist while the ID remains claimed and does not establish whether execution started. Do not automatically restart with a fresh or omitted ID; either can start another run.',
      },
      'x-sim-via': {
        kind: 'string',
        describe:
          'Comma-separated workflow identifiers naming the workflow-to-workflow call chain that led to this request. Each hop appends its own workflow id, and Sim sets it automatically; supply it yourself only when relaying an existing chain. A chain at the maximum depth is rejected with `409` and `error.details.code: "CALL_CHAIN_DEPTH_EXCEEDED"`.',
      },
    },
  },
  exportKnowledgeBase: {
    method: 'GET',
    path: '/api/v2/knowledge/[knowledgeBaseId]/export',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
    responseMode: 'binary',
    summary: 'Export Knowledge Base',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      vectors: {
        kind: 'boolean',
        describe:
          'Include chunk vectors so an import into a deployment with the same embedding model reuses them instead of re-embedding.',
      },
    },
  },
  exportWorkflow: {
    method: 'GET',
    path: '/api/v2/workflows/[workflowId]/export',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Export Workflow',
  },
  getAuditLog: {
    method: 'GET',
    path: '/api/v2/audit-logs/[auditLogId]',
    pathParams: ['auditLogId'] as const,
    pathParamDocs: { auditLogId: 'Audit-log entry identifier.' },
    responseMode: 'json',
    summary: 'Get Audit Log',
    workspaceKeyUnsupported: true,
    query: {
      organizationId: {
        kind: 'string',
        describe:
          "Organization whose audit-log entry should be returned. Defaults to the caller's own organization when omitted. A caller that belongs to no organization, or that names one it is not a member of, is refused with a 403.",
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
          'Workspace whose payer should be resolved. A workspace API key is pinned to its own workspace: any other id answers `404 Workspace not found`, which is also what an id that does not exist answers.',
      },
    },
  },
  getBlock: {
    method: 'GET',
    path: '/api/v2/blocks/[blockId]',
    pathParams: ['blockId'] as const,
    pathParamDocs: {
      blockId:
        'Block type identifier. An unversioned base type resolves to the newest version, and the response echoes the resolved id.',
    },
    responseMode: 'json',
    summary: 'Get Block',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe:
          'Workspace whose integration allowlist, revealed preview blocks, and deployed custom blocks decide what this catalog contains.',
      },
    },
  },
  getCustomTool: {
    method: 'GET',
    path: '/api/v2/custom-tools/[customToolId]',
    pathParams: ['customToolId'] as const,
    pathParamDocs: { customToolId: 'Unique custom tool identifier.' },
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
          'Which lifecycle set to read from: `active` (default) resolves live files only and returns `404` for a file a delete soft-deleted; `archived` also resolves soft-deleted files, so metadata stays readable before the file is restored. Authorization is identical for both.',
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
  getFileUpload: {
    method: 'GET',
    path: '/api/v2/files/uploads/[uploadId]',
    pathParams: ['uploadId'] as const,
    pathParamDocs: { uploadId: 'Upload session identifier.' },
    responseMode: 'json',
    summary: 'Get File Upload',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the upload session.',
      },
    },
    headers: {
      'upload-token': {
        kind: 'string',
        required: true,
        describe: 'Signed upload control token returned when the upload session was created.',
      },
    },
  },
  getKnowledgeBase: {
    method: 'GET',
    path: '/api/v2/knowledge/[knowledgeBaseId]',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
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
  getKnowledgeChunk: {
    method: 'GET',
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]',
    pathParams: ['knowledgeBaseId', 'documentId', 'chunkId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Unique knowledge base identifier.',
      documentId: 'Unique knowledge document identifier.',
      chunkId: 'Unique chunk identifier.',
    },
    responseMode: 'json',
    summary: 'Get Chunk',
    workspaceKeyUnsupported: true,
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
    path: '/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]',
    pathParams: ['knowledgeBaseId', 'connectorId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Knowledge base that owns the connector.',
      connectorId: 'Connector selected for the operation.',
    },
    responseMode: 'json',
    summary: 'Get Knowledge Connector',
    workspaceKeyUnsupported: true,
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
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]',
    pathParams: ['knowledgeBaseId', 'documentId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Unique knowledge base identifier.',
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
  getLogStats: {
    method: 'GET',
    path: '/api/v2/logs/stats',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Get Log Statistics',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace whose execution statistics to summarize.',
      },
      workflowIds: {
        kind: 'string',
        describe:
          'Comma-separated workflow identifiers to include. At most 200 entries. An empty entry is rejected.',
      },
      folderPaths: {
        kind: 'string',
        describe:
          'Comma-separated workflow folder paths, including descendants. Up to 100 paths. Unknown folder paths contribute no matches.',
      },
      triggers: {
        kind: 'string',
        describe:
          'Comma-separated trigger types to include. An empty entry is rejected. The vocabulary is open, so an unrecognized member selects no runs; the literal `all` disables this filter.',
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
      segmentCount: {
        kind: 'integer',
        default: 72,
        describe:
          'Number of time buckets, up to 500. Exactly this many are returned, each at least one minute wide. Short windows extend past the requested end and include empty trailing buckets.',
      },
    },
  },
  getMcpServer: {
    method: 'GET',
    path: '/api/v2/mcp-servers/[mcpServerId]',
    pathParams: ['mcpServerId'] as const,
    pathParamDocs: { mcpServerId: 'Unique MCP server identifier.' },
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
  getMeta: {
    method: 'GET',
    path: '/api/v2/meta',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Get API Capabilities',
  },
  getNextKnowledgeTagSlot: {
    method: 'GET',
    path: '/api/v2/knowledge/[knowledgeBaseId]/tags/next-slot',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'Get Next Tag Slot',
    workspaceKeyUnsupported: true,
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      fieldType: {
        kind: 'enum',
        required: true,
        values: ['text', 'number', 'date', 'boolean'] as const,
        describe:
          'Value type stored in the slot; it decides which slots are usable and which filter operators apply. Slot capacity per type: text 7, number 5, date 2, boolean 3.',
      },
    },
  },
  getRowEnrichment: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]',
    pathParams: ['tableId', 'rowId', 'groupId'] as const,
    pathParamDocs: {
      tableId: 'Unique table identifier.',
      rowId: 'Unique table row identifier.',
      groupId: 'Workflow or enrichment group to run.',
    },
    responseMode: 'json',
    summary: 'Get Enrichment Run Detail',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the table.' },
    },
  },
  getSandbox: {
    method: 'GET',
    path: '/api/v2/sandboxes/[sandboxId]',
    pathParams: ['sandboxId'] as const,
    pathParamDocs: { sandboxId: 'Unique sandbox identifier.' },
    responseMode: 'json',
    summary: 'Get Sandbox',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the sandbox.' },
    },
  },
  getSkill: {
    method: 'GET',
    path: '/api/v2/skills/[skillId]',
    pathParams: ['skillId'] as const,
    pathParamDocs: {
      skillId:
        'Unique skill identifier. A built-in skill is `builtin-` followed by its name, for example `builtin-research`.',
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
  getTableDispatch: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/dispatches/[dispatchId]',
    pathParams: ['tableId', 'dispatchId'] as const,
    pathParamDocs: {
      tableId: 'Unique table identifier.',
      dispatchId: 'Unique table run-dispatch identifier.',
    },
    responseMode: 'json',
    summary: 'Get Run Dispatch',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the transfer resource.',
      },
    },
  },
  getTableExport: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/exports/[exportId]',
    pathParams: ['tableId', 'exportId'] as const,
    pathParamDocs: {
      tableId: 'Unique table identifier.',
      exportId: 'Unique table-export identifier.',
    },
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
    headers: {
      'upload-token': {
        kind: 'string',
        describe: 'Signed upload control token returned when an upload-backed import was created.',
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
      includeRunState: {
        kind: 'boolean',
        describe: 'Include per-workflow-group run state on the returned row. Off by default.',
      },
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
  getTool: {
    method: 'GET',
    path: '/api/v2/tools/[toolId]',
    pathParams: ['toolId'] as const,
    pathParamDocs: {
      toolId:
        'Tool identifier. An unversioned name resolves to the newest version, and the response echoes the resolved id.',
    },
    responseMode: 'json',
    summary: 'Get Tool',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe:
          'Workspace whose integration allowlist, revealed preview blocks, and deployed custom blocks decide what this catalog contains.',
      },
    },
  },
  getWorkflow: {
    method: 'GET',
    path: '/api/v2/workflows/[workflowId]',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Get Workflow',
  },
  getWorkflowChatDeployment: {
    method: 'GET',
    path: '/api/v2/workflows/[workflowId]/deployments/chat',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Get Workflow Chat Deployment',
    workspaceKeyUnsupported: true,
  },
  getWorkflowDeployment: {
    method: 'GET',
    path: '/api/v2/workflows/[workflowId]/deployment',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Get Workflow Deployment',
  },
  getWorkflowMcpServer: {
    method: 'GET',
    path: '/api/v2/workflow-mcp-servers/[serverId]',
    pathParams: ['serverId'] as const,
    pathParamDocs: { serverId: 'Unique workflow-MCP server identifier.' },
    responseMode: 'json',
    summary: 'Get Workflow MCP Server',
    workspaceKeyUnsupported: true,
  },
  getWorkflowRun: {
    method: 'GET',
    path: '/api/v2/workflows/[workflowId]/runs/[runId]',
    pathParams: ['workflowId', 'runId'] as const,
    pathParamDocs: {
      workflowId: 'Unique workflow identifier.',
      runId: 'Unique workflow run identifier.',
    },
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
          'Comma-separated block output references to include, as `blockId` or `blockId.path`. Block *names* are not resolved here — unlike the execute request, this resource reads a recorded run and matches ids only, so a selector that is not headed by a block id answers `400` instead of an empty `blockOutputs`.',
      },
      includeFileBase64: {
        kind: 'boolean',
        describe:
          "Inline each produced file's bytes as base64. Requires `includeOutput`. A file above the inline ceiling answers `413` naming its download path; fetch large files from `downloadPath` instead.",
      },
      base64MaxBytes: {
        kind: 'integer',
        describe: 'Per-file inline ceiling, lowering but never raising the server limit of 16 MiB.',
      },
    },
  },
  getWorkflowState: {
    method: 'GET',
    path: '/api/v2/workflows/[workflowId]/state',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Get Workflow State',
  },
  getWorkflowVersion: {
    method: 'GET',
    path: '/api/v2/workflows/[workflowId]/versions/[version]',
    pathParams: ['workflowId', 'version'] as const,
    pathParamDocs: {
      workflowId: 'Unique workflow identifier.',
      version: 'Numeric deployment version.',
    },
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
    path: '/api/v2/skills/[skillId]/editors',
    pathParams: ['skillId'] as const,
    pathParamDocs: {
      skillId:
        'Unique skill identifier. A built-in skill is `builtin-` followed by its name, for example `builtin-research`.',
    },
    responseMode: 'json',
    summary: 'Grant Skill Editor',
    workspaceKeyUnsupported: true,
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
    workspaceKeyUnsupported: true,
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
        describe:
          "Organization whose audit trail should be queried. Defaults to the caller's own organization when omitted. A caller that belongs to no organization, or that names one it is not a member of, is refused with a 403.",
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
          'api-tool',
        ] as const,
        describe: 'Restrict results to one usage source.',
      },
      workspaceId: {
        kind: 'string',
        describe:
          "Narrow the ledger to one workspace. An OAuth token or personal API key reports only its user's events; a workspace API key reports every member's events in its bound workspace. The response `scope` identifies which view was returned. A workspace key asking for another workspace receives the same `404 Workspace not found` as an unknown id.",
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
  listBlocks: {
    method: 'GET',
    path: '/api/v2/blocks',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Blocks',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe:
          'Workspace whose integration allowlist, revealed preview blocks, and deployed custom blocks decide what this catalog contains.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the block id, name, and description.',
      },
      category: {
        kind: 'enum',
        values: ['blocks', 'tools', 'triggers'] as const,
        describe: 'Restrict to one toolbar category.',
      },
      capability: {
        kind: 'enum',
        values: ['trigger'] as const,
        describe:
          'Restrict to blocks that can start a workflow — the `triggers` category, blocks declaring `triggerAllowed`, and blocks with trigger-mode fields.',
      },
      source: {
        kind: 'enum',
        values: ['builtin', 'custom'] as const,
        describe: "Restrict to built-in blocks or this workspace's deployed custom blocks.",
      },
      sortBy: {
        kind: 'enum',
        values: ['id', 'name', 'category'] as const,
        default: 'id',
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
          'Maximum blocks to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listChatDeployments: {
    method: 'GET',
    path: '/api/v2/chat-deployments',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Chat Deployments',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace whose chat deployments to list.',
      },
      workflowId: { kind: 'string', describe: 'Restrict to deployments of one workflow.' },
      isActive: { kind: 'boolean', describe: 'Restrict to active or inactive deployments.' },
      sortBy: {
        kind: 'enum',
        values: ['identifier', 'createdAt', 'updatedAt'] as const,
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
          'Maximum chat deployments to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listConnectorTypes: {
    method: 'GET',
    path: '/api/v2/connector-types',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Connector Types',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe:
          'Workspace whose integration allowlist, revealed preview blocks, and deployed custom blocks decide what this catalog contains.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the connector name.',
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
        describe:
          'Restrict results to direct children of this parent path. Unknown folder paths contribute no matches.',
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
      scope: {
        kind: 'enum',
        values: ['active', 'archived'] as const,
        default: 'active',
        describe:
          'Which lifecycle set to list: `active` (default) returns live folders only; `archived` returns folders a recursive delete soft-deleted, which is how a caller finds a path to hand to the folder restore. Authorization is identical for both.',
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
        describe: 'Whether parentPath includes every descendant instead of direct children only.',
      },
      depth: {
        kind: 'integer',
        describe: 'Deepest level below parentPath to include when recursive is true.',
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
          'Restrict files to this folder, including subfolders when `recursive` is true. Unknown folder paths contribute no matches.',
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
          'Include subfolders in the folder filter. Defaults to true when searching and false otherwise. Ignored without a folder filter.',
      },
      scope: {
        kind: 'enum',
        values: ['active', 'archived'] as const,
        default: 'active',
        describe:
          'Which lifecycle set to list: `active` (default) for live files, `archived` for files a delete soft-deleted. `folderPath` resolves against active folders only, so pairing it with `scope=archived` returns an empty page when the containing folder was archived too.',
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
      scope: {
        kind: 'enum',
        values: ['active', 'archived'] as const,
        default: 'active',
        describe:
          'Lifecycle scope: active or archived knowledge bases. Use Restore Knowledge Base to recover archived entries. Folder paths resolve only active folders, so filtering by an archived folder returns no matches.',
      },
      folderPath: {
        kind: 'string',
        describe:
          'Restrict results to knowledge bases in this folder. Unknown folder paths contribute no matches.',
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
  listKnowledgeChunks: {
    method: 'GET',
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks',
    pathParams: ['knowledgeBaseId', 'documentId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Unique knowledge base identifier.',
      documentId: 'Unique knowledge document identifier.',
    },
    responseMode: 'json',
    summary: 'List Chunks',
    workspaceKeyUnsupported: true,
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against chunk content.',
      },
      enabled: {
        kind: 'enum',
        values: ['true', 'false', 'all'] as const,
        default: 'all',
        describe: 'Restrict to enabled or disabled chunks. `all` returns both.',
      },
      sortBy: {
        kind: 'enum',
        values: ['chunkIndex', 'tokenCount', 'enabled'] as const,
        default: 'chunkIndex',
        describe: 'Field used to sort the result.',
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
          'Maximum chunks to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
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
    path: '/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/documents',
    pathParams: ['knowledgeBaseId', 'connectorId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Knowledge base that owns the connector.',
      connectorId: 'Connector selected for the operation.',
    },
    responseMode: 'json',
    summary: 'List Knowledge Connector Documents',
    workspaceKeyUnsupported: true,
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
    path: '/api/v2/knowledge/[knowledgeBaseId]/connectors',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'List Knowledge Connectors',
    workspaceKeyUnsupported: true,
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
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
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
        describe:
          'Restrict results to direct children of this parent path. Unknown folder paths contribute no matches.',
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
    path: '/api/v2/knowledge/[knowledgeBaseId]/tags',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
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
  listKnowledgeTagUsage: {
    method: 'GET',
    path: '/api/v2/knowledge/[knowledgeBaseId]/tags/usage',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'List Tag Usage',
    workspaceKeyUnsupported: true,
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
        describe:
          'Comma-separated workflow identifiers to include. An empty entry is rejected. At most 200 entries.',
      },
      triggers: {
        kind: 'string',
        describe:
          'Comma-separated, lowercase trigger types or webhook provider IDs. Matching is exact and case-sensitive; unknown values select no runs. An empty entry is rejected. The sentinel `all` disables this filter, even when listed with other values. At most 100 entries.',
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
          'Response detail level. `full` adds the `workflow` summary to every workflow run; a job run never carries one, whatever this is set to. `includeTraceSpans=true` and `includeFinalOutput=true` each imply `full`, so either one adds `workflow` even when `details=basic` is sent explicitly.',
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
      status: {
        kind: 'string',
        describe:
          'Comma-separated execution statuses to include, from `pending` | `running` | `paused` | `redacting` | `completed` | `failed` | `cancelled`. An empty entry is rejected. ANDed with `level`, which reports severity rather than lifecycle.',
      },
      workflowName: {
        kind: 'string',
        describe:
          "Case-insensitive substring match against the run's workflow name. Runs whose workflow has been deleted match nothing, because the name is no longer joinable.",
      },
      includeJobRuns: {
        kind: 'boolean',
        describe:
          'Include Chat and Sim-agent jobs alongside workflow runs. Jobs use `kind: "job"` and have no workflow or cost ledger. Workflow, folder, model, or status filters exclude jobs. This option is valid only when sorting by `startedAt`.',
      },
      runId: { kind: 'string', describe: 'Exact run identifier to match.' },
      sortBy: {
        kind: 'enum',
        values: ['startedAt', 'durationMs', 'cost', 'status'] as const,
        default: 'startedAt',
        describe:
          'Field used to sort the result. `durationMs` and `cost` are null until a run settles; those runs sort before recorded values in ascending order and after them in descending order. Only `startedAt` can order Chat and Sim-agent job runs, so any other value is rejected when job runs are included.',
      },
      sortOrder: {
        kind: 'enum',
        values: ['asc', 'desc'] as const,
        default: 'desc',
        describe: 'Sort direction.',
      },
      folderPaths: {
        kind: 'string',
        describe:
          'Comma-separated workflow folder paths, including descendants. Up to 100 paths. Unknown folder paths contribute no matches.',
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
    path: '/api/v2/mcp-servers/[mcpServerId]/tools',
    pathParams: ['mcpServerId'] as const,
    pathParamDocs: { mcpServerId: 'Unique MCP server identifier.' },
    responseMode: 'json',
    summary: 'List MCP Server Tools',
    workspaceKeyUnsupported: true,
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the MCP server.',
      },
      refresh: {
        kind: 'boolean',
        describe:
          "Refresh tools using your credentials. Otherwise results may reuse another workspace member's recent discovery and omit newly added tools.",
      },
    },
  },
  listSandboxes: {
    method: 'GET',
    path: '/api/v2/sandboxes',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Sandboxes',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the sandbox.' },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the sandbox name.',
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
          'Maximum sandboxes to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listSecrets: {
    method: 'GET',
    path: '/api/v2/secrets',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Secrets',
    workspaceKeyUnsupported: true,
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
    path: '/api/v2/skills/[skillId]/editors',
    pathParams: ['skillId'] as const,
    pathParamDocs: {
      skillId:
        'Unique skill identifier. A built-in skill is `builtin-` followed by its name, for example `builtin-research`.',
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
  listTableDispatches: {
    method: 'GET',
    path: '/api/v2/tables/[tableId]/dispatches',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'List Active Run Dispatches',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the table.' },
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
        describe:
          'Restrict results to direct children of this parent path. Unknown folder paths contribute no matches.',
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
      includeRunState: {
        kind: 'boolean',
        describe:
          'Include per-workflow-group run state on every returned row. Off by default: run state is a separate sidecar read and its `blockErrors` are unbounded, so a full page carries it only when asked. Caps `limit` at 200.',
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
      scope: {
        kind: 'enum',
        values: ['active', 'archived'] as const,
        default: 'active',
        describe:
          'Which lifecycle set to list: `active` (default) for live tables, `archived` for tables a delete archived and a table restore can bring back. `folderPath` resolves against active folders only, so pairing it with `scope=archived` returns an empty page when the containing folder was archived too.',
      },
      folderPath: {
        kind: 'string',
        describe:
          'Restrict results to tables in this folder. Unknown folder paths contribute no matches.',
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
  listTools: {
    method: 'GET',
    path: '/api/v2/tools',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Tools',
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe:
          'Workspace whose integration allowlist, revealed preview blocks, and deployed custom blocks decide what this catalog contains.',
      },
      search: {
        kind: 'string',
        describe: 'Case-insensitive substring match against the tool id, name, and description.',
      },
      hostedApiKey: {
        kind: 'enum',
        values: ['always', 'conditional', 'none'] as const,
        describe: 'Restrict to tools by how their API key is supplied.',
      },
      oauthProvider: {
        kind: 'string',
        describe: 'Restrict to tools that authenticate against this OAuth service.',
      },
      sortBy: {
        kind: 'enum',
        values: ['id', 'name'] as const,
        default: 'id',
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
          'Maximum tools to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
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
        describe:
          'Restrict results to direct children of this parent path. Unknown folder paths contribute no matches.',
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
  listWorkflowMcpServers: {
    method: 'GET',
    path: '/api/v2/workflow-mcp-servers',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'List Workflow MCP Servers',
    workspaceKeyUnsupported: true,
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace whose published MCP servers to list.',
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
          'Maximum workflow-MCP servers to return per page. Must be a whole number from 1 to 100. Defaults to 50.',
      },
      cursor: {
        kind: 'string',
        describe:
          'Opaque cursor from the previous page. Send it back with the same sort and filters; only `limit` may change. Change anything else and pagination must restart without a cursor.',
      },
    },
  },
  listWorkflowMcpTools: {
    method: 'GET',
    path: '/api/v2/workflow-mcp-servers/[serverId]/tools',
    pathParams: ['serverId'] as const,
    pathParamDocs: { serverId: 'Unique workflow-MCP server identifier.' },
    responseMode: 'json',
    summary: 'List Workflow MCP Tools',
    workspaceKeyUnsupported: true,
  },
  listWorkflowRuns: {
    method: 'GET',
    path: '/api/v2/workflows/[workflowId]/runs',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
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
      scope: {
        kind: 'enum',
        values: ['active', 'archived'] as const,
        default: 'active',
        describe:
          'Which lifecycle set to list: `active` (default) for live workflows, `archived` for workflows a `DELETE` archived. The folder filter resolves against active folders only, so pairing it with `archived` returns an empty page when the containing folder was archived too.',
      },
      folderPath: {
        kind: 'string',
        describe:
          'Restrict results to workflows in this folder path. Unknown folder paths contribute no matches.',
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
    path: '/api/v2/workflows/[workflowId]/versions',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
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
  moveTables: {
    method: 'POST',
    path: '/api/v2/tables/move',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Move Tables and Folders',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns every selected item.',
      },
      tableIds: { kind: 'array', default: [], describe: 'Tables to move, by identifier.' },
      folderPaths: { kind: 'array', describe: 'Table folders to re-parent, by canonical path.' },
      targetFolderPath: {
        kind: 'string',
        describe: 'Destination folder path. Omit to move the selection to the workspace root.',
      },
    },
  },
  moveWorkflows: {
    method: 'POST',
    path: '/api/v2/workflows/move',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Move Workflows',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace holding every workflow in the batch.',
      },
      workflowIds: {
        kind: 'array',
        required: true,
        describe: 'Workflows to move. Duplicates are collapsed.',
      },
      folderPath: {
        kind: 'string',
        required: true,
        describe: 'Destination folder path; `/` moves the workflows to the workspace root.',
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
          'One condition or a recursive `all`/`any` group, normalized to a grouped predicate. Limits: 100 members per group, 10 levels, and 500 nodes. The negating operators include nulls and absent cells, multi-select included; combine with `isNotNull` or `isNotEmpty` to exclude them. Pattern operators use `*` as the only wildcard; `%`, `_`, and backslash are literal. Select operators: single-select uses `eq`/`ne`/`in`/`nin`; multi-select uses `contains`/`ncontains`; option names resolve to IDs. Full operand rules are documented on `op`.',
      },
      sort: { kind: 'array', describe: 'Ordered table-row sort specification.' },
      limit: {
        kind: 'integer',
        describe: 'Maximum rows to return; zero requests an unbounded result.',
      },
      cursor: { kind: 'string', describe: 'Opaque cursor returned by the previous query page.' },
      includeRunState: {
        kind: 'boolean',
        default: false,
        describe:
          'Include per-workflow-group run state on every returned row. Off by default: run state is a separate sidecar read and its `blockErrors` are unbounded, so a full page carries it only when asked. Incompatible with `limit: 0`, and caps `limit` at 200.',
      },
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
          'One condition or a recursive `all`/`any` group, normalized to a grouped predicate. Limits: 100 members per group, 10 levels, and 500 nodes. The negating operators include nulls and absent cells, multi-select included; combine with `isNotNull` or `isNotEmpty` to exclude them. Pattern operators use `*` as the only wildcard; `%`, `_`, and backslash are literal. Select operators: single-select uses `eq`/`ne`/`in`/`nin`; multi-select uses `contains`/`ncontains`; option names resolve to IDs. Full operand rules are documented on `op`.',
      },
    },
  },
  readFileText: {
    method: 'GET',
    path: '/api/v2/files/[fileId]/text',
    pathParams: ['fileId'] as const,
    pathParamDocs: { fileId: 'File identifier.' },
    responseMode: 'json',
    summary: 'Read File Text',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the file.' },
      maxBytes: {
        kind: 'integer',
        describe:
          'Optional ceiling on the source bytes fed to the parser, lowering but never raising the server limit.',
      },
      offset: {
        kind: 'integer',
        describe: 'First line to return, 1-based. Absent starts at the first line.',
      },
      limit: {
        kind: 'integer',
        describe: 'How many lines to return from `offset`. Absent reads to the end.',
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
  replaceWorkflowChatDeployment: {
    method: 'PUT',
    path: '/api/v2/workflows/[workflowId]/deployments/chat',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Create or Replace Workflow Chat Deployment',
    workspaceKeyUnsupported: true,
    body: {
      identifier: {
        kind: 'string',
        required: true,
        describe: 'URL slug the deployed chat answers on. Must be free across live deployments.',
      },
      title: { kind: 'string', required: true, describe: 'Title shown to visitors.' },
      description: {
        kind: 'string',
        describe: 'Description shown to visitors. Omitted clears it.',
      },
      customizations: {
        kind: 'object',
        describe: 'Presentation overrides. Omitted fields take platform defaults.',
      },
      authType: {
        kind: 'enum',
        values: ['public', 'password', 'email', 'sso'] as const,
        default: 'public',
        describe:
          'How visitors are gated. `public` leaves the chat open to anyone holding the URL.',
      },
      password: {
        kind: 'string',
        describe:
          'Write-only password. Required whenever `authType` is `password`, and rejected otherwise. Never readable back.',
      },
      allowedEmails: {
        kind: 'array',
        describe:
          'Email addresses or domains admitted under `email` and `sso` gating. At least one is required for those modes.',
      },
      outputConfigs: {
        kind: 'array',
        describe: 'Block outputs to surface to visitors. Omitted surfaces none.',
      },
      includeThinking: {
        kind: 'boolean',
        default: false,
        describe: 'Allow visitors to receive provider thinking events.',
      },
      includeToolCalls: {
        kind: 'boolean',
        default: false,
        describe: 'Allow visitors to receive tool lifecycle events.',
      },
    },
  },
  replaceWorkflowState: {
    method: 'PUT',
    path: '/api/v2/workflows/[workflowId]/state',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Replace Workflow State',
    workspaceKeyUnsupported: true,
    query: {
      dryRun: {
        kind: 'boolean',
        describe:
          'Validate and lint without persisting. The response is identical to the committed write of the same body, so a caller can inspect `lint` and then re-send the request for real. Nothing is written, no audit entry is recorded, and collaborators are not notified.',
      },
    },
    body: {
      blocks: { kind: 'object', required: true, describe: 'Blocks keyed by block id.' },
      edges: { kind: 'array', required: true, describe: 'Directed connections between blocks.' },
      loops: {
        kind: 'object',
        describe: 'Ignored on write: loop containers are recomputed from `blocks`.',
      },
      parallels: {
        kind: 'object',
        describe: 'Ignored on write: parallel containers are recomputed from `blocks`.',
      },
      variables: {
        kind: 'object',
        describe: 'Replacement variable set. Omit to leave the stored variables untouched.',
      },
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
  restoreFileFolder: {
    method: 'POST',
    path: '/api/v2/files/folders/restore',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Restore Folder',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the archived folder.',
      },
      path: {
        kind: 'string',
        required: true,
        describe:
          'Path of the archived folder to restore, as reported by an archived-scope folder list.',
      },
    },
  },
  restoreKnowledgeBase: {
    method: 'POST',
    path: '/api/v2/knowledge/[knowledgeBaseId]/restore',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
    responseMode: 'json',
    summary: 'Restore Knowledge Base',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
    },
  },
  restoreTable: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/restore',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Restore Table',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
    },
  },
  restoreTableFolder: {
    method: 'POST',
    path: '/api/v2/tables/folders/restore',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Restore Folder',
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the archived folder.',
      },
      path: {
        kind: 'string',
        required: true,
        describe: 'Path the folder held when a folder delete archived it.',
      },
    },
  },
  restoreWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[workflowId]/restore',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Restore Workflow',
  },
  resumeWorkflow: {
    method: 'POST',
    path: '/api/v2/workflows/[workflowId]/runs/[runId]/resume',
    pathParams: ['workflowId', 'runId'] as const,
    pathParamDocs: {
      workflowId: 'Unique workflow identifier.',
      runId: 'Unique workflow run identifier.',
    },
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
  revertWorkflowVersion: {
    method: 'POST',
    path: '/api/v2/workflows/[workflowId]/versions/[version]/revert',
    pathParams: ['workflowId', 'version'] as const,
    pathParamDocs: {
      workflowId: 'Unique workflow identifier.',
      version: 'Numeric deployment version, or `active` for the currently live version.',
    },
    responseMode: 'json',
    summary: 'Revert Workflow To Version',
    workspaceKeyUnsupported: true,
  },
  revokeSkillEditor: {
    method: 'DELETE',
    path: '/api/v2/skills/[skillId]/editors',
    pathParams: ['skillId'] as const,
    pathParamDocs: {
      skillId:
        'Unique skill identifier. A built-in skill is `builtin-` followed by its name, for example `builtin-research`.',
    },
    responseMode: 'json',
    summary: 'Revoke Skill Editor',
    workspaceKeyUnsupported: true,
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
    path: '/api/v2/workflows/[workflowId]/rollback',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Rollback Workflow',
    workspaceKeyUnsupported: true,
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
  searchFileContent: {
    method: 'GET',
    path: '/api/v2/files/search',
    pathParams: [] as const,
    responseMode: 'json',
    summary: 'Search File Content',
    query: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace to search.' },
      query: {
        kind: 'string',
        required: true,
        describe: 'Regular expression, or exact text when `mode` is `exact`.',
      },
      mode: {
        kind: 'enum',
        values: ['exact', 'regex'] as const,
        default: 'regex',
        describe: 'How `query` is read.',
      },
      maxResults: { kind: 'integer', default: 50, describe: 'Maximum matching lines to return.' },
      folderPaths: {
        kind: 'string',
        describe:
          'Folders the search is confined to, comma-separated. Absent searches the whole workspace. The scope also narrows `indexStatus`, so `complete` describes the folders searched rather than the workspace.',
      },
      includeSubfolders: {
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
          'Whether the scope descends into nested folders. Absent means yes. The listed spellings are the whole accepted vocabulary and are case-sensitive; any other value is rejected.',
      },
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
          'Maximum number of search results to return. Must be a whole number between 1 and 100.',
      },
      tagFilters: {
        kind: 'array',
        describe:
          'Up to 10 filters combined with AND; repeating a tag narrows results. To express OR, run separate searches. Every tag must exist with the same slot and field type in each selected knowledge base or the request is rejected. List valid names with the knowledge-base tag-list operation.',
      },
      searchMode: {
        kind: 'enum',
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
  searchTableRows: {
    method: 'POST',
    path: '/api/v2/tables/[tableId]/rows/search',
    pathParams: ['tableId'] as const,
    pathParamDocs: { tableId: 'Unique table identifier.' },
    responseMode: 'json',
    summary: 'Search Rows',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Unique workspace identifier.' },
      q: { kind: 'string', required: true, describe: 'Case-insensitive cell substring to find.' },
      predicate: {
        kind: 'unknown',
        describe:
          'Recursive non-empty `all`/`any` groups containing groups or conditions; the root cannot be a condition. Limits: 100 members per group, 10 levels, and 500 nodes. The negating operators include nulls and absent cells, multi-select included; combine with `isNotNull` or `isNotEmpty` to exclude them. Pattern operators use `*` as the only wildcard; `%`, `_`, and backslash are literal. Select operators: single-select uses `eq`/`ne`/`in`/`nin`; multi-select uses `contains`/`ncontains`; option names resolve to IDs. Full operand rules are documented on `op`.',
      },
      sort: { kind: 'array', describe: 'Ordered table-row sort specification.' },
    },
  },
  setSecret: {
    method: 'PUT',
    path: '/api/v2/secrets/[name]',
    pathParams: ['name'] as const,
    pathParamDocs: { name: 'Secret to create or replace.' },
    responseMode: 'json',
    summary: 'Set Secret',
    workspaceKeyUnsupported: true,
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
        describe:
          'Write-only secret value. It is never returned. Omit it on a workspace secret to change description or unredacted alone, leaving the stored value untouched; the secret must already exist. Always required for a personal secret, which carries no other writable field.',
      },
      description: {
        kind: 'string',
        describe:
          'What the secret is for, shown to teammates. Workspace scope only — sending it for a personal secret is rejected. Omit it to leave an existing description untouched; send null or an empty string to clear one.',
      },
      unredacted: {
        kind: 'boolean',
        describe:
          'Opt the workspace secret out of redaction: its value then appears in plaintext in run logs, model-visible content, and files, including publicly shared log links. Workspace scope only — sending it for a personal secret is rejected. Omit it to leave the current setting untouched.',
      },
    },
  },
  syncKnowledgeConnector: {
    method: 'POST',
    path: '/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/sync',
    pathParams: ['knowledgeBaseId', 'connectorId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Knowledge base that owns the connector.',
      connectorId: 'Connector selected for the operation.',
    },
    responseMode: 'json',
    summary: 'Sync Knowledge Connector',
    workspaceKeyUnsupported: true,
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
    path: '/api/v2/tables/[tableId]/exports/[exportId]/download',
    pathParams: ['tableId', 'exportId'] as const,
    pathParamDocs: {
      tableId: 'Unique table identifier.',
      exportId: 'Unique table-export identifier.',
    },
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
    path: '/api/v2/workflows/[workflowId]/deploy',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Undeploy Workflow',
    workspaceKeyUnsupported: true,
  },
  undeployWorkflowMcpTool: {
    method: 'DELETE',
    path: '/api/v2/workflow-mcp-servers/[serverId]/tools/[workflowId]',
    pathParams: ['serverId', 'workflowId'] as const,
    pathParamDocs: {
      serverId: 'Unique workflow-MCP server identifier.',
      workflowId: 'Workflow published as a tool on this server.',
    },
    responseMode: 'json',
    summary: 'Unpublish Workflow MCP Tool',
    workspaceKeyUnsupported: true,
  },
  unzipFile: {
    method: 'POST',
    path: '/api/v2/files/[fileId]/unzip',
    pathParams: ['fileId'] as const,
    pathParamDocs: { fileId: 'File identifier.' },
    responseMode: 'json',
    summary: 'Unzip File',
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the archive.' },
    },
  },
  updateCredential: {
    method: 'PATCH',
    path: '/api/v2/credentials/[credentialId]',
    pathParams: ['credentialId'] as const,
    pathParamDocs: { credentialId: 'Credential to update.' },
    responseMode: 'json',
    summary: 'Update Credential',
    workspaceKeyUnsupported: true,
    query: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace expected to own the credential.',
      },
    },
    body: {
      displayName: { kind: 'string', describe: 'New name shown for the credential in Sim.' },
      description: {
        kind: 'string',
        describe: 'New credential description. Send null to clear the stored one.',
      },
      serviceAccountJson: {
        kind: 'string',
        describe: 'Write-only Google service-account JSON key.',
      },
      apiToken: { kind: 'string', describe: 'Write-only provider API token.' },
      domain: { kind: 'string', describe: 'Provider account domain.' },
      atlassianProduct: {
        kind: 'enum',
        values: ['jira', 'confluence'] as const,
        describe:
          'Atlassian product to verify; defaults to Jira on create and preserves the saved product on reconnect.',
      },
      signingSecret: { kind: 'string', describe: 'Write-only webhook signing secret.' },
      botToken: { kind: 'string', describe: 'Write-only bot token.' },
      clientId: { kind: 'string', describe: 'OAuth client identifier.' },
      clientSecret: { kind: 'string', describe: 'Write-only OAuth client secret.' },
      certificateId: { kind: 'string', describe: 'Provider certificate mapping identifier.' },
      orgId: { kind: 'string', describe: 'Provider organization ID.' },
      dataCenter: { kind: 'string', describe: 'Provider data center.' },
      authMethod: { kind: 'string', describe: 'Provider authentication method.' },
      privateKey: { kind: 'string', describe: 'Write-only PEM private key.' },
      username: { kind: 'string', describe: 'Provider run-as username.' },
    },
  },
  updateCustomTool: {
    method: 'PATCH',
    path: '/api/v2/custom-tools/[customToolId]',
    pathParams: ['customToolId'] as const,
    pathParamDocs: { customToolId: 'Unique custom tool identifier.' },
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
    path: '/api/v2/knowledge/[knowledgeBaseId]',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
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
  updateKnowledgeChunk: {
    method: 'PATCH',
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]',
    pathParams: ['knowledgeBaseId', 'documentId', 'chunkId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Unique knowledge base identifier.',
      documentId: 'Unique knowledge document identifier.',
      chunkId: 'Unique chunk identifier.',
    },
    responseMode: 'json',
    summary: 'Update Chunk',
    workspaceKeyUnsupported: true,
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      content: {
        kind: 'string',
        describe:
          'Replacement text. Changing it re-embeds the chunk and re-derives its token and character counts.',
      },
      enabled: {
        kind: 'boolean',
        describe: 'Whether the chunk participates in search. Disabling keeps it indexed.',
      },
    },
  },
  updateKnowledgeConnector: {
    method: 'PATCH',
    path: '/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]',
    pathParams: ['knowledgeBaseId', 'connectorId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Knowledge base that owns the connector.',
      connectorId: 'Connector selected for the operation.',
    },
    responseMode: 'json',
    summary: 'Update Knowledge Connector',
    workspaceKeyUnsupported: true,
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      sourceConfig: {
        kind: 'object',
        describe:
          'Replacement source selection and filtering configuration. Updating a runnable connector queues synchronization; paused connectors remain paused.',
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
    path: '/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/documents',
    pathParams: ['knowledgeBaseId', 'connectorId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Knowledge base that owns the connector.',
      connectorId: 'Connector selected for the operation.',
    },
    responseMode: 'json',
    summary: 'Update Knowledge Connector Documents',
    workspaceKeyUnsupported: true,
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
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]',
    pathParams: ['knowledgeBaseId', 'documentId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Unique knowledge base identifier.',
      documentId: 'Unique knowledge document identifier.',
    },
    responseMode: 'json',
    summary: 'Update Document',
    workspaceKeyUnsupported: true,
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
  updateKnowledgeTag: {
    method: 'PATCH',
    path: '/api/v2/knowledge/[knowledgeBaseId]/tags/[tagId]',
    pathParams: ['knowledgeBaseId', 'tagId'] as const,
    pathParamDocs: {
      knowledgeBaseId: 'Unique knowledge base identifier.',
      tagId: 'Unique tag definition identifier.',
    },
    responseMode: 'json',
    summary: 'Update Tag',
    workspaceKeyUnsupported: true,
    body: {
      workspaceId: {
        kind: 'string',
        required: true,
        describe: 'Workspace that owns the knowledge base.',
      },
      displayName: { kind: 'string', describe: 'New tag display name.' },
      fieldType: {
        kind: 'enum',
        values: ['text', 'number', 'date', 'boolean'] as const,
        describe: 'New value type for the tag.',
      },
    },
  },
  updateMcpServer: {
    method: 'PATCH',
    path: '/api/v2/mcp-servers/[mcpServerId]',
    pathParams: ['mcpServerId'] as const,
    pathParamDocs: { mcpServerId: 'Unique MCP server identifier.' },
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
        describe: 'Transport protocol. Defaults to `streamable-http` on creation.',
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
        describe: 'Per-request timeout in milliseconds. Defaults to 30000 on creation.',
      },
      retries: {
        kind: 'integer',
        default: 3,
        describe: 'Number of retries per request. Defaults to 3 on creation.',
      },
      enabled: {
        kind: 'boolean',
        default: true,
        describe: "Whether workflows can use the server's tools. Defaults to true on creation.",
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
          'Recursive non-empty `all`/`any` groups containing groups or conditions; the root cannot be a condition. Limits: 100 members per group, 10 levels, and 500 nodes. The negating operators include nulls and absent cells, multi-select included; combine with `isNotNull` or `isNotEmpty` to exclude them. Pattern operators use `*` as the only wildcard; `%`, `_`, and backslash are literal. Select operators: single-select uses `eq`/`ne`/`in`/`nin`; multi-select uses `contains`/`ncontains`; option names resolve to IDs. Full operand rules are documented on `op`.',
      },
      data: {
        kind: 'object',
        required: true,
        describe: 'Row-data patch applied to every matching row.',
      },
      limit: { kind: 'integer', describe: 'Maximum matching rows to update.' },
    },
  },
  updateSandbox: {
    method: 'PATCH',
    path: '/api/v2/sandboxes/[sandboxId]',
    pathParams: ['sandboxId'] as const,
    pathParamDocs: { sandboxId: 'Unique sandbox identifier.' },
    responseMode: 'json',
    summary: 'Update Sandbox',
    workspaceKeyUnsupported: true,
    body: {
      workspaceId: { kind: 'string', required: true, describe: 'Workspace that owns the sandbox.' },
      name: {
        kind: 'string',
        describe: 'New display name, unique within the workspace; 1 to 64 characters.',
      },
      language: {
        kind: 'enum',
        values: ['javascript', 'python'] as const,
        describe:
          'Replacement dependency ecosystem. The whole spec is revalidated against it, so a Python dependency list does not survive a switch to JavaScript.',
      },
      dependencies: {
        kind: 'array',
        describe: 'Replacement package list; replaces the whole list.',
      },
      cliTools: {
        kind: 'array',
        describe: 'Replacement managed CLI list; replaces the whole list.',
      },
      systemPackages: {
        kind: 'array',
        describe: 'Replacement Debian package list; replaces the whole list.',
      },
    },
  },
  updateSkill: {
    method: 'PATCH',
    path: '/api/v2/skills/[skillId]',
    pathParams: ['skillId'] as const,
    pathParamDocs: {
      skillId:
        'Unique skill identifier. A built-in skill is `builtin-` followed by its name, for example `builtin-research`.',
    },
    responseMode: 'json',
    summary: 'Update Skill',
    workspaceKeyUnsupported: true,
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
    path: '/api/v2/workflows/[workflowId]',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
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
  updateWorkflowMcpServer: {
    method: 'PATCH',
    path: '/api/v2/workflow-mcp-servers/[serverId]',
    pathParams: ['serverId'] as const,
    pathParamDocs: { serverId: 'Unique workflow-MCP server identifier.' },
    responseMode: 'json',
    summary: 'Update Workflow MCP Server',
    workspaceKeyUnsupported: true,
    body: {
      name: { kind: 'string', describe: 'Server display name, shown to connecting MCP clients.' },
      description: { kind: 'string', describe: 'New server description, or null to clear it.' },
      isPublic: {
        kind: 'boolean',
        describe: 'Whether the server answers MCP clients without a Sim API key.',
      },
    },
  },
  updateWorkflowPublicApi: {
    method: 'PATCH',
    path: '/api/v2/workflows/[workflowId]/deployment',
    pathParams: ['workflowId'] as const,
    pathParamDocs: { workflowId: 'Unique workflow identifier.' },
    responseMode: 'json',
    summary: 'Update Workflow Public API Access',
    workspaceKeyUnsupported: true,
    body: {
      isPublicApi: {
        kind: 'boolean',
        required: true,
        describe:
          'Whether the deployed workflow should accept unauthenticated public API execution.',
      },
    },
  },
  updateWorkflowVersion: {
    method: 'PATCH',
    path: '/api/v2/workflows/[workflowId]/versions/[version]',
    pathParams: ['workflowId', 'version'] as const,
    pathParamDocs: {
      workflowId: 'Unique workflow identifier.',
      version: 'Numeric deployment version.',
    },
    responseMode: 'json',
    summary: 'Update Workflow Version',
    body: {
      name: { kind: 'string', describe: 'New label for the deployment version.' },
      description: {
        kind: 'string',
        describe: 'New release note for the deployment version, or null to clear it.',
      },
    },
  },
  uploadKnowledgeDocument: {
    method: 'POST',
    path: '/api/v2/knowledge/[knowledgeBaseId]/documents',
    pathParams: ['knowledgeBaseId'] as const,
    pathParamDocs: { knowledgeBaseId: 'Unique knowledge base identifier.' },
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
    workspaceKeyUnsupported: true,
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
          'Complete set of row cells keyed by column name. On the update branch this REPLACES the matched row: any column not present here is cleared, unlike a single-row update, which merges.',
      },
      conflictTarget: { kind: 'string', describe: 'Unique column used to detect a conflict.' },
    },
  },
} as const

export type V2OperationName = keyof typeof V2_OPERATIONS
