import { z } from 'zod'

// Generic envelope used by client to validate API responses
export const ExecuteResponseSuccessSchema = z.object({
  success: z.literal(true),
  result: z.unknown(),
})
export type ExecuteResponseSuccess = z.infer<typeof ExecuteResponseSuccessSchema>

// get_blocks_metadata
export const GetBlocksMetadataInput = z.object({ blockIds: z.array(z.string()).min(1) })
export const GetBlocksMetadataResult = z.object({ metadata: z.record(z.any()) })
export type GetBlocksMetadataResultType = z.infer<typeof GetBlocksMetadataResult>

// get_trigger_blocks
export const GetTriggerBlocksInput = z.object({})
export const GetTriggerBlocksResult = z.object({
  triggerBlockIds: z.array(z.string()),
})
export type GetTriggerBlocksResultType = z.infer<typeof GetTriggerBlocksResult>

// knowledge_base - shared schema used by client tool, server tool, and registry
export const KnowledgeBaseArgsSchema = z.object({
  operation: z.enum([
    'create',
    'get',
    'query',
    'update',
    'delete',
    'add_file',
    'delete_document',
    'update_document',
    'list_tags',
    'create_tag',
    'update_tag',
    'delete_tag',
    'get_tag_usage',
    'add_connector',
    'update_connector',
    'delete_connector',
    'sync_connector',
  ]),
  args: z
    .object({
      /** Name of the knowledge base (required for create) */
      name: z.string().optional(),
      /** Description of the knowledge base (optional for create) */
      description: z.string().optional(),
      /** Workspace ID to associate with (required for create, optional for list) */
      workspaceId: z.string().optional(),
      /** Knowledge base ID (required for get, query, add_file, list_tags, create_tag, get_tag_usage, add_connector) */
      knowledgeBaseId: z.string().optional(),
      /** Workspace file ID to add as a document (required for add_file). */
      fileId: z.string().optional(),
      /** Legacy workspace file reference for add_file. Prefer fileId. */
      filePath: z.string().optional(),
      /** Search query text (required for query) */
      query: z.string().optional(),
      /** Number of results to return (optional for query, defaults to 5) */
      topK: z.number().min(1).max(50).optional(),
      /** Chunking configuration (optional for create) */
      chunkingConfig: z
        .object({
          maxSize: z.number().min(100).max(4000).default(1024),
          minSize: z.number().min(1).max(2000).default(1),
          overlap: z.number().min(0).max(500).default(200),
        })
        .optional(),
      /** Tag definition ID (required for update_tag, delete_tag) */
      tagDefinitionId: z.string().optional(),
      /** Tag display name (required for create_tag, optional for update_tag) */
      tagDisplayName: z.string().optional(),
      /** Tag field type: text, number, date, boolean (optional for create_tag, defaults to text) */
      tagFieldType: z.enum(['text', 'number', 'date', 'boolean']).optional(),
      /** Connector type from registry, e.g. "confluence" (required for add_connector) */
      connectorType: z.string().optional(),
      /** OAuth credential ID from environment/credentials.json (required for OAuth connectors) */
      credentialId: z.string().optional(),
      /** API key for API key-based connectors (required for API key connectors) */
      apiKey: z.string().optional(),
      /** Connector-specific config matching the schema in knowledgebases/connectors/{type}.json */
      sourceConfig: z.record(z.unknown()).optional(),
      /** Sync interval: 60, 360, 1440, 10080, or 0 for manual only (optional for add_connector, defaults to 1440) */
      syncIntervalMinutes: z.number().int().min(0).optional(),
      /** Connector ID (required for update_connector, delete_connector, sync_connector) */
      connectorId: z.string().optional(),
      /** Connector status: "active" or "paused" (optional for update_connector) */
      connectorStatus: z.enum(['active', 'paused']).optional(),
      /** Tag definition IDs to disable (optional for add_connector) */
      disabledTagIds: z.array(z.string()).optional(),
      /** Document ID (required for delete_document, update_document) */
      documentId: z.string().optional(),
      /** Enable/disable a document (optional for update_document) */
      enabled: z.boolean().optional(),
      /** New filename for a document (optional for update_document) */
      filename: z.string().optional(),
    })
    .optional(),
})
export type KnowledgeBaseArgs = z.infer<typeof KnowledgeBaseArgsSchema>

export const KnowledgeBaseResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.any().optional(),
})
export type KnowledgeBaseResult = z.infer<typeof KnowledgeBaseResultSchema>

// user_table - shared schema used by server tool and registry
export const UserTableArgsSchema = z.object({
  operation: z.enum([
    'create',
    'create_from_file',
    'import_file',
    'get',
    'get_schema',
    'delete',
    'insert_row',
    'batch_insert_rows',
    'get_row',
    'query_rows',
    'update_row',
    'delete_row',
    'update_rows_by_filter',
    'delete_rows_by_filter',
    'batch_update_rows',
    'batch_delete_rows',
    'add_column',
    'rename_column',
    'delete_column',
    'update_column',
    'rename',
  ]),
  args: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      schema: z.any().optional(),
      tableId: z.string().optional(),
      rowId: z.string().optional(),
      data: z.record(z.any()).optional(),
      rows: z.array(z.record(z.any())).optional(),
      updates: z.array(z.object({ rowId: z.string(), data: z.record(z.any()) })).optional(),
      rowIds: z.array(z.string()).optional(),
      values: z.record(z.any()).optional(),
      filter: z.any().optional(),
      sort: z.record(z.enum(['asc', 'desc'])).optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      fileId: z.string().optional(),
      filePath: z.string().optional(),
      column: z
        .object({
          name: z.string(),
          type: z.string(),
          unique: z.boolean().optional(),
          position: z.number().optional(),
        })
        .optional(),
      columnName: z.string().optional(),
      columnNames: z.array(z.string()).optional(),
      newName: z.string().optional(),
      newType: z.string().optional(),
      unique: z.boolean().optional(),
    })
    .optional(),
})
export type UserTableArgs = z.infer<typeof UserTableArgsSchema>

export const UserTableResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.any().optional(),
})
export type UserTableResult = z.infer<typeof UserTableResultSchema>

// workspace_file - shared schema used by server tool and Go catalog
export const WorkspaceFileArgsSchema = z.object({
  operation: z.enum(['write', 'update', 'delete', 'rename', 'patch']),
  args: z
    .object({
      fileId: z.string().optional(),
      fileName: z.string().optional(),
      content: z.string().optional(),
      contentType: z.string().optional(),
      workspaceId: z.string().optional(),
      newName: z.string().optional(),
      edits: z
        .array(z.object({ search: z.string(), replace: z.string() }))
        .describe(
          'List of search/replace pairs applied sequentially — each edit operates on the result of the previous one. Search strings must be unique within the file.'
        )
        .optional(),
    })
    .optional(),
})
export type WorkspaceFileArgs = z.infer<typeof WorkspaceFileArgsSchema>

export const WorkspaceFileResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.any().optional(),
})
export type WorkspaceFileResult = z.infer<typeof WorkspaceFileResultSchema>

export const GetBlockOutputsInput = z.object({
  blockIds: z.array(z.string()).optional(),
})
export const GetBlockOutputsResult = z.object({
  blocks: z.array(
    z.object({
      blockId: z.string(),
      blockName: z.string(),
      blockType: z.string(),
      triggerMode: z.boolean().optional(),
      outputs: z.array(z.string()),
      insideSubflowOutputs: z.array(z.string()).optional(),
      outsideSubflowOutputs: z.array(z.string()).optional(),
    })
  ),
  variables: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        tag: z.string(),
      })
    )
    .optional(),
})
export type GetBlockOutputsInputType = z.infer<typeof GetBlockOutputsInput>
export type GetBlockOutputsResultType = z.infer<typeof GetBlockOutputsResult>

export const GetBlockUpstreamReferencesInput = z.object({
  blockIds: z.array(z.string()).min(1),
})
export const GetBlockUpstreamReferencesResult = z.object({
  results: z.array(
    z.object({
      blockId: z.string(),
      blockName: z.string(),
      insideSubflows: z
        .array(
          z.object({
            blockId: z.string(),
            blockName: z.string(),
            blockType: z.string(),
          })
        )
        .optional(),
      accessibleBlocks: z.array(
        z.object({
          blockId: z.string(),
          blockName: z.string(),
          blockType: z.string(),
          triggerMode: z.boolean().optional(),
          outputs: z.array(z.string()),
          accessContext: z.enum(['inside', 'outside']).optional(),
        })
      ),
      variables: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          type: z.string(),
          tag: z.string(),
        })
      ),
    })
  ),
})
export type GetBlockUpstreamReferencesInputType = z.infer<typeof GetBlockUpstreamReferencesInput>
export type GetBlockUpstreamReferencesResultType = z.infer<typeof GetBlockUpstreamReferencesResult>
