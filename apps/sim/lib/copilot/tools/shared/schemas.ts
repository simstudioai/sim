import { z } from 'zod'

// ============================================================================
// Common Schemas (shared across multiple tools and API routes)
// ============================================================================

// Generic envelope used by client to validate API responses
export const ExecuteResponseSuccessSchema = z.object({
  success: z.literal(true),
  result: z.unknown(),
})
export type ExecuteResponseSuccess = z.infer<typeof ExecuteResponseSuccessSchema>

/**
 * Standard tool error structure.
 * Used in ToolResult and tool_result events.
 */
export const ToolErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
})
export type ToolError = z.infer<typeof ToolErrorSchema>

/**
 * Standard tool result structure.
 * This is the canonical format for tool execution results across the system.
 */
export const ToolResultSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: ToolErrorSchema.optional(),
})
export type ToolResultType = z.infer<typeof ToolResultSchema>

/**
 * Mark-complete payload schema.
 * Used when calling the Go copilot's mark-complete endpoint.
 */
export const MarkCompletePayloadSchema = z.object({
  /** Tool call ID */
  id: z.string(),
  /** Tool name */
  name: z.string(),
  /** HTTP-like status code (200 = success, 4xx = client error, 5xx = server error) */
  status: z.number().int().min(100).max(599),
  /** Optional message (typically error message or success description) */
  message: z.unknown().optional(),
  /** Optional data payload (tool result data) */
  data: z.unknown().optional(),
})
export type MarkCompletePayload = z.infer<typeof MarkCompletePayloadSchema>

/**
 * Tool result event from Go (received via SSE stream).
 * This represents what we receive back after mark-complete.
 */
export const ToolResultEventSchema = z.object({
  toolCallId: z.string().optional(),
  data: z
    .object({
      id: z.string().optional(),
    })
    .optional(),
  success: z.boolean().optional(),
  failedDependency: z.boolean().optional(),
  result: z
    .object({
      skipped: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
})
export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>

/**
 * Helper to extract toolCallId from tool_result event data.
 * Handles the various formats Go might send.
 */
export function extractToolCallId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const d = data as Record<string, unknown>
  // Try direct toolCallId first
  if (typeof d.toolCallId === 'string') return d.toolCallId
  // Then try nested data.id
  if (d.data && typeof d.data === 'object') {
    const nested = d.data as Record<string, unknown>
    if (typeof nested.id === 'string') return nested.id
  }
  return undefined
}

// get_blocks_and_tools
export const GetBlocksAndToolsInput = z.object({})
export const GetBlocksAndToolsResult = z.object({
  blocks: z.array(
    z
      .object({
        type: z.string(),
        name: z.string(),
        triggerAllowed: z.boolean().optional(),
        longDescription: z.string().optional(),
      })
      .passthrough()
  ),
})
export type GetBlocksAndToolsResultType = z.infer<typeof GetBlocksAndToolsResult>

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

// get_block_options
export const GetBlockOptionsInput = z.object({
  blockId: z.string(),
})
export const GetBlockOptionsResult = z.object({
  blockId: z.string(),
  blockName: z.string(),
  operations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
    })
  ),
})
export type GetBlockOptionsInputType = z.infer<typeof GetBlockOptionsInput>
export type GetBlockOptionsResultType = z.infer<typeof GetBlockOptionsResult>

// get_block_config
export const GetBlockConfigInput = z.object({
  blockType: z.string(),
  operation: z.string().optional(),
  trigger: z.boolean().optional(),
})
export const GetBlockConfigResult = z.object({
  blockType: z.string(),
  blockName: z.string(),
  operation: z.string().optional(),
  trigger: z.boolean().optional(),
  inputs: z.record(z.any()),
  outputs: z.record(z.any()),
})
export type GetBlockConfigInputType = z.infer<typeof GetBlockConfigInput>
export type GetBlockConfigResultType = z.infer<typeof GetBlockConfigResult>

// knowledge_base - shared schema used by client tool, server tool, and registry
export const KnowledgeBaseArgsSchema = z.object({
  operation: z.enum(['create', 'list', 'get', 'query']),
  args: z
    .object({
      /** Name of the knowledge base (required for create) */
      name: z.string().optional(),
      /** Description of the knowledge base (optional for create) */
      description: z.string().optional(),
      /** Workspace ID to associate with (required for create, optional for list) */
      workspaceId: z.string().optional(),
      /** Knowledge base ID (required for get, query) */
      knowledgeBaseId: z.string().optional(),
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

// ============================================================================
// Search Tools
// ============================================================================

// search_documentation
export const SearchDocumentationInput = z.object({
  query: z.string().min(1),
  topK: z.number().min(1).max(50).optional().default(10),
  threshold: z.number().min(0).max(1).optional(),
})
export const SearchDocumentationResult = z.object({
  results: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      url: z.string(),
      content: z.string(),
      similarity: z.number(),
    })
  ),
  query: z.string(),
  totalResults: z.number(),
})
export type SearchDocumentationInputType = z.infer<typeof SearchDocumentationInput>
export type SearchDocumentationResultType = z.infer<typeof SearchDocumentationResult>

// search_online
export const SearchOnlineInput = z.object({
  query: z.string().min(1),
  num: z.number().min(1).max(100).optional().default(10),
  type: z.string().optional().default('search'),
  gl: z.string().optional(),
  hl: z.string().optional(),
})
export const SearchOnlineResult = z.object({
  results: z.array(z.record(z.unknown())),
  query: z.string(),
  type: z.string(),
  totalResults: z.number(),
  source: z.enum(['exa', 'serper']),
})
export type SearchOnlineInputType = z.infer<typeof SearchOnlineInput>
export type SearchOnlineResultType = z.infer<typeof SearchOnlineResult>

// make_api_request
export const MakeApiRequestInput = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT']),
  queryParams: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
})
export const MakeApiRequestResult = z.object({
  data: z.unknown(),
  status: z.number(),
  headers: z.record(z.unknown()).optional(),
  truncated: z.boolean().optional(),
  totalChars: z.number().optional(),
  previewChars: z.number().optional(),
  note: z.string().optional(),
})
export type MakeApiRequestInputType = z.infer<typeof MakeApiRequestInput>
export type MakeApiRequestResultType = z.infer<typeof MakeApiRequestResult>

// ============================================================================
// Workflow Tools
// ============================================================================

// edit_workflow - input is complex, using passthrough for flexibility
export const EditWorkflowInput = z.object({
  workflowId: z.string(),
  operations: z.array(z.record(z.unknown())),
  currentUserWorkflow: z.unknown().optional(),
})
export const EditWorkflowResult = z.object({
  success: z.boolean(),
  workflowState: z.unknown(),
  inputValidationErrors: z.array(z.string()).optional(),
  inputValidationMessage: z.string().optional(),
  skippedItems: z.array(z.string()).optional(),
  skippedItemsMessage: z.string().optional(),
})
export type EditWorkflowInputType = z.infer<typeof EditWorkflowInput>
export type EditWorkflowResultType = z.infer<typeof EditWorkflowResult>

// get_workflow_console
export const GetWorkflowConsoleInput = z.object({
  workflowId: z.string(),
  limit: z.number().min(1).max(50).optional().default(2),
  includeDetails: z.boolean().optional().default(false),
})
export const GetWorkflowConsoleResult = z.array(
  z.object({
    executionId: z.string(),
    startedAt: z.string(),
    blocks: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        startedAt: z.string(),
        endedAt: z.string(),
        durationMs: z.number(),
        output: z.unknown(),
        error: z.string().optional(),
      })
    ),
  })
)
export type GetWorkflowConsoleInputType = z.infer<typeof GetWorkflowConsoleInput>
export type GetWorkflowConsoleResultType = z.infer<typeof GetWorkflowConsoleResult>

// list_user_workflows
export const ListUserWorkflowsInput = z.object({})
export const ListUserWorkflowsResult = z.object({
  workflow_names: z.array(z.string()),
  count: z.number(),
})
export type ListUserWorkflowsInputType = z.infer<typeof ListUserWorkflowsInput>
export type ListUserWorkflowsResultType = z.infer<typeof ListUserWorkflowsResult>

// ============================================================================
// User Tools
// ============================================================================

// get_credentials
export const GetCredentialsInput = z.object({
  workflowId: z.string().optional(),
})
export const GetCredentialsResult = z.object({
  oauth: z.object({
    connected: z.object({
      credentials: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          provider: z.string(),
          serviceName: z.string(),
          lastUsed: z.string(),
          isDefault: z.boolean(),
          accessToken: z.string().nullable(),
        })
      ),
      total: z.number(),
    }),
    notConnected: z.object({
      services: z.array(
        z.object({
          providerId: z.string(),
          name: z.string(),
          description: z.string().optional(),
          baseProvider: z.string().optional(),
        })
      ),
      total: z.number(),
    }),
  }),
  environment: z.object({
    variableNames: z.array(z.string()),
    count: z.number(),
    personalVariables: z.array(z.string()),
    workspaceVariables: z.array(z.string()),
    conflicts: z.array(z.string()).optional(),
  }),
})
export type GetCredentialsInputType = z.infer<typeof GetCredentialsInput>
export type GetCredentialsResultType = z.infer<typeof GetCredentialsResult>

// set_environment_variables
export const SetEnvironmentVariablesInput = z.object({
  variables: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    })
  ),
  workspaceId: z.string().optional(),
})
export const SetEnvironmentVariablesResult = z.object({
  success: z.boolean(),
  message: z.string(),
  savedCount: z.number().optional(),
  variables: z.array(z.string()).optional(),
})
