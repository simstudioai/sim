import { z } from 'zod'

// Tool IDs supported by the Copilot runtime
export const ToolIds = z.enum([
  'get_user_workflow',
  'edit_workflow',
  'run_workflow',
  'get_workflow_console',
  'get_blocks_and_tools',
  'get_blocks_metadata',
  'get_trigger_examples',
  'get_examples_rag',
  'get_operations_examples',
  'search_documentation',
  'search_online',
  'make_api_request',
  'get_environment_variables',
  'set_environment_variables',
  'get_oauth_credentials',
  'gdrive_request_access',
  'list_gdrive_files',
  'read_gdrive_file',
  'reason',
  'list_user_workflows',
  'get_workflow_from_name',
  'get_global_workflow_variables',
  'set_global_workflow_variables',
  'oauth_request_access',
  'get_trigger_blocks',
])
export type ToolId = z.infer<typeof ToolIds>

// Base SSE wrapper for tool_call events emitted by the LLM
const ToolCallSSEBase = z.object({
  type: z.literal('tool_call'),
  data: z.object({
    id: z.string(),
    name: ToolIds,
    arguments: z.record(z.any()),
    partial: z.boolean().default(false),
  }),
})
export type ToolCallSSE = z.infer<typeof ToolCallSSEBase>

// Reusable small schemas
const StringArray = z.array(z.string())
const BooleanOptional = z.boolean().optional()
const NumberOptional = z.number().optional()

// Tool argument schemas (per SSE examples provided)
export const ToolArgSchemas = {
  get_user_workflow: z.object({}),
  // New tools
  list_user_workflows: z.object({}),
  get_workflow_from_name: z.object({ workflow_name: z.string() }),
  // New variable tools
  get_global_workflow_variables: z.object({}),
  set_global_workflow_variables: z.object({
    operations: z.array(
      z.object({
        operation: z.enum(['add', 'delete', 'edit']),
        name: z.string(),
        type: z.enum(['plain', 'number', 'boolean', 'array', 'object']).optional(),
        value: z.string().optional(),
      })
    ),
  }),
  // New
  oauth_request_access: z.object({}),

  edit_workflow: z.object({
    operations: z
      .array(
        z.object({
          operation_type: z.enum(['add', 'edit', 'delete']),
          block_id: z.string(),
          params: z.record(z.any()).optional(),
        })
      )
      .min(1),
  }),

  run_workflow: z.object({
    workflow_input: z.string(),
  }),

  get_workflow_console: z.object({
    limit: NumberOptional,
    includeDetails: BooleanOptional,
  }),

  get_blocks_and_tools: z.object({}),

  get_blocks_metadata: z.object({
    blockIds: StringArray.min(1),
  }),

  get_trigger_blocks: z.object({}),

  get_block_best_practices: z.object({
    blockIds: StringArray.min(1),
  }),

  get_edit_workflow_examples: z.object({
    exampleIds: StringArray.min(1),
  }),

  get_trigger_examples: z.object({}),

  get_examples_rag: z.object({
    query: z.string(),
  }),

  get_operations_examples: z.object({
    query: z.string(),
  }),

  search_documentation: z.object({
    query: z.string(),
    topK: NumberOptional,
  }),

  search_online: z.object({
    query: z.string(),
    num: z.number().optional().default(10),
    type: z.enum(['search', 'news', 'places', 'images']).optional().default('search'),
    gl: z.string().optional(),
    hl: z.string().optional(),
  }),

  make_api_request: z.object({
    url: z.string(),
    method: z.enum(['GET', 'POST', 'PUT']),
    queryParams: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    headers: z.record(z.string()).optional(),
    body: z.union([z.record(z.any()), z.string()]).optional(),
  }),

  get_environment_variables: z.object({}),

  set_environment_variables: z.object({
    variables: z.record(z.string()),
  }),

  get_oauth_credentials: z.object({}),

  gdrive_request_access: z.object({}),

  list_gdrive_files: z.object({
    search_query: z.string().optional(),
    num_results: z.number().optional().default(50),
  }),

  read_gdrive_file: z.object({
    fileId: z.string(),
    type: z.enum(['doc', 'sheet']),
    range: z.string().optional(),
  }),

  reason: z.object({
    reasoning: z.string(),
  }),
} as const
export type ToolArgSchemaMap = typeof ToolArgSchemas

// Tool-specific SSE schemas (tool_call with typed arguments)
function toolCallSSEFor<TName extends ToolId, TArgs extends z.ZodTypeAny>(
  name: TName,
  argsSchema: TArgs
) {
  return ToolCallSSEBase.extend({
    data: ToolCallSSEBase.shape.data.extend({
      name: z.literal(name),
      arguments: argsSchema,
    }),
  })
}

export const ToolSSESchemas = {
  get_user_workflow: toolCallSSEFor('get_user_workflow', ToolArgSchemas.get_user_workflow),
  // New tools
  list_user_workflows: toolCallSSEFor('list_user_workflows', ToolArgSchemas.list_user_workflows),
  get_workflow_from_name: toolCallSSEFor(
    'get_workflow_from_name',
    ToolArgSchemas.get_workflow_from_name
  ),
  // New variable tools
  get_global_workflow_variables: toolCallSSEFor(
    'get_global_workflow_variables',
    ToolArgSchemas.get_global_workflow_variables
  ),
  set_global_workflow_variables: toolCallSSEFor(
    'set_global_workflow_variables',
    ToolArgSchemas.set_global_workflow_variables
  ),
  edit_workflow: toolCallSSEFor('edit_workflow', ToolArgSchemas.edit_workflow),
  run_workflow: toolCallSSEFor('run_workflow', ToolArgSchemas.run_workflow),
  get_workflow_console: toolCallSSEFor('get_workflow_console', ToolArgSchemas.get_workflow_console),
  get_blocks_and_tools: toolCallSSEFor('get_blocks_and_tools', ToolArgSchemas.get_blocks_and_tools),
  get_blocks_metadata: toolCallSSEFor('get_blocks_metadata', ToolArgSchemas.get_blocks_metadata),
  get_trigger_blocks: toolCallSSEFor('get_trigger_blocks', ToolArgSchemas.get_trigger_blocks),

  get_trigger_examples: toolCallSSEFor('get_trigger_examples', ToolArgSchemas.get_trigger_examples),
  get_examples_rag: toolCallSSEFor('get_examples_rag', ToolArgSchemas.get_examples_rag),
  get_operations_examples: toolCallSSEFor(
    'get_operations_examples',
    ToolArgSchemas.get_operations_examples
  ),
  search_documentation: toolCallSSEFor('search_documentation', ToolArgSchemas.search_documentation),
  search_online: toolCallSSEFor('search_online', ToolArgSchemas.search_online),
  make_api_request: toolCallSSEFor('make_api_request', ToolArgSchemas.make_api_request),
  get_environment_variables: toolCallSSEFor(
    'get_environment_variables',
    ToolArgSchemas.get_environment_variables
  ),
  set_environment_variables: toolCallSSEFor(
    'set_environment_variables',
    ToolArgSchemas.set_environment_variables
  ),
  get_oauth_credentials: toolCallSSEFor(
    'get_oauth_credentials',
    ToolArgSchemas.get_oauth_credentials
  ),
  gdrive_request_access: toolCallSSEFor(
    'gdrive_request_access',
    ToolArgSchemas.gdrive_request_access as any
  ),
  list_gdrive_files: toolCallSSEFor('list_gdrive_files', ToolArgSchemas.list_gdrive_files),
  read_gdrive_file: toolCallSSEFor('read_gdrive_file', ToolArgSchemas.read_gdrive_file),
  reason: toolCallSSEFor('reason', ToolArgSchemas.reason),
  // New
  oauth_request_access: toolCallSSEFor('oauth_request_access', ToolArgSchemas.oauth_request_access),
} as const
export type ToolSSESchemaMap = typeof ToolSSESchemas

// Known result schemas per tool (what tool_result.result should conform to)
// Note: Where legacy variability exists, schema captures the common/expected shape for new runtime.
const BuildOrEditWorkflowResult = z.object({
  yamlContent: z.string(),
  description: z.string().optional(),
  workflowState: z.unknown().optional(),
  data: z
    .object({
      blocksCount: z.number(),
      edgesCount: z.number(),
    })
    .optional(),
})

const ExecutionEntry = z.object({
  id: z.string(),
  executionId: z.string(),
  level: z.string(),
  trigger: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  totalCost: z.number().nullable(),
  totalTokens: z.number().nullable(),
  blockExecutions: z.array(z.any()), // can be detailed per need
  output: z.any().optional(),
  errorMessage: z.string().optional(),
  errorBlock: z
    .object({
      blockId: z.string().optional(),
      blockName: z.string().optional(),
      blockType: z.string().optional(),
    })
    .optional(),
})

export const ToolResultSchemas = {
  get_user_workflow: z.object({ yamlContent: z.string() }).or(z.string()),
  // New tools
  list_user_workflows: z.object({ workflow_names: z.array(z.string()) }),
  get_workflow_from_name: z
    .object({ yamlContent: z.string() })
    .or(z.object({ userWorkflow: z.string() }))
    .or(z.string()),
  // New variable tools
  get_global_workflow_variables: z
    .object({ variables: z.record(z.any()) })
    .or(z.array(z.object({ name: z.string(), value: z.any() }))),
  set_global_workflow_variables: z
    .object({ variables: z.record(z.any()) })
    .or(z.object({ message: z.any().optional(), data: z.any().optional() })),
  // New
  oauth_request_access: z.object({
    granted: z.boolean().optional(),
    message: z.string().optional(),
  }),

  edit_workflow: BuildOrEditWorkflowResult,
  run_workflow: z.object({
    executionId: z.string().optional(),
    message: z.any().optional(),
    data: z.any().optional(),
  }),
  get_workflow_console: z.object({ entries: z.array(ExecutionEntry) }),
  get_blocks_and_tools: z.object({ blocks: z.array(z.any()), tools: z.array(z.any()) }),
  get_blocks_metadata: z.object({ metadata: z.record(z.any()) }),
  get_trigger_blocks: z.object({ triggerBlockIds: z.array(z.string()) }),
  get_block_best_practices: z.object({ bestPractices: z.array(z.any()) }),
  get_edit_workflow_examples: z.object({
    examples: z.array(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        operations: z.array(z.any()).optional(),
      })
    ),
  }),
  get_trigger_examples: z.object({
    examples: z.array(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        operations: z.array(z.any()).optional(),
      })
    ),
  }),
  get_examples_rag: z.object({
    examples: z.array(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        operations: z.array(z.any()).optional(),
      })
    ),
  }),
  get_operations_examples: z.object({
    examples: z.array(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        operations: z.array(z.any()).optional(),
      })
    ),
  }),
  search_documentation: z.object({ results: z.array(z.any()) }),
  search_online: z.object({ results: z.array(z.any()) }),
  make_api_request: z.object({
    status: z.number(),
    statusText: z.string().optional(),
    headers: z.record(z.string()).optional(),
    body: z.any().optional(),
  }),
  get_environment_variables: z.object({ variables: z.record(z.string()) }),
  set_environment_variables: z
    .object({ variables: z.record(z.string()) })
    .or(z.object({ message: z.any().optional(), data: z.any().optional() })),
  get_oauth_credentials: z.object({
    credentials: z.array(
      z.object({ id: z.string(), provider: z.string(), isDefault: z.boolean().optional() })
    ),
  }),
  gdrive_request_access: z.object({
    granted: z.boolean().optional(),
    message: z.string().optional(),
  }),
  list_gdrive_files: z.object({
    files: z.array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        mimeType: z.string().optional(),
        size: z.number().optional(),
      })
    ),
  }),
  read_gdrive_file: z.object({ content: z.string().optional(), data: z.any().optional() }),
  reason: z.object({ reasoning: z.string() }),
} as const
export type ToolResultSchemaMap = typeof ToolResultSchemas

// Consolidated registry entry per tool
export const ToolRegistry = Object.freeze(
  (Object.keys(ToolArgSchemas) as ToolId[]).reduce(
    (acc, toolId) => {
      const args = (ToolArgSchemas as any)[toolId] as z.ZodTypeAny
      const sse = (ToolSSESchemas as any)[toolId] as z.ZodTypeAny
      const result = (ToolResultSchemas as any)[toolId] as z.ZodTypeAny
      acc[toolId] = { id: toolId, args, sse, result }
      return acc
    },
    {} as Record<
      ToolId,
      { id: ToolId; args: z.ZodTypeAny; sse: z.ZodTypeAny; result: z.ZodTypeAny }
    >
  )
)
export type ToolRegistryMap = typeof ToolRegistry

// Convenience helper types inferred from schemas
export type InferArgs<T extends ToolId> = z.infer<(typeof ToolArgSchemas)[T]>
export type InferResult<T extends ToolId> = z.infer<(typeof ToolResultSchemas)[T]>
export type InferToolCallSSE<T extends ToolId> = z.infer<(typeof ToolSSESchemas)[T]>
