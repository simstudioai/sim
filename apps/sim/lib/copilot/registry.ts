import { z } from 'zod'
import { KnowledgeBaseArgsSchema, KnowledgeBaseResultSchema } from './tools/shared/schemas'

// Tool IDs supported by the Copilot runtime
export const ToolIds = z.enum([
  'get_user_workflow',
  'edit_workflow',
  'run_workflow',
  'get_workflow_console',
  'get_blocks_and_tools',
  'get_blocks_metadata',
  'get_block_options',
  'get_block_config',
  'get_trigger_examples',
  'get_examples_rag',
  'get_operations_examples',
  'search_documentation',
  'search_online',
  'search_patterns',
  'search_errors',
  'remember_debug',
  'make_api_request',
  'set_environment_variables',
  'get_credentials',
  'reason',
  'list_user_workflows',
  'get_workflow_from_name',
  'get_workflow_data',
  'set_global_workflow_variables',
  'oauth_request_access',
  'get_trigger_blocks',
  'deploy_workflow',
  'check_deployment_status',
  'navigate_ui',
  'knowledge_base',
  'manage_custom_tool',
  'manage_mcp_tool',
  'sleep',
  'get_block_outputs',
  'get_block_upstream_references',
])
export type ToolId = z.infer<typeof ToolIds>

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

const StringArray = z.array(z.string())
const BooleanOptional = z.boolean().optional()
const NumberOptional = z.number().optional()

export const ToolArgSchemas = {
  get_user_workflow: z.object({}),
  list_user_workflows: z.object({}),
  get_workflow_from_name: z.object({ workflow_name: z.string() }),
  get_workflow_data: z.object({
    data_type: z.enum(['global_variables', 'custom_tools', 'mcp_tools', 'files']),
  }),
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
  oauth_request_access: z.object({
    providerName: z.string(),
  }),

  deploy_workflow: z.object({
    action: z.enum(['deploy', 'undeploy']).optional().default('deploy'),
    deployType: z.enum(['api', 'chat']).optional().default('api'),
  }),

  check_deployment_status: z.object({
    workflowId: z.string().optional(),
  }),

  navigate_ui: z.object({
    destination: z.enum(['workflow', 'logs', 'templates', 'vector_db', 'settings']),
    workflowName: z.string().optional(),
  }),

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

  get_block_options: z.object({
    blockId: z.string().describe('The block type ID (e.g., "google_sheets", "slack", "gmail")'),
  }),

  get_block_config: z.object({
    blockType: z.string().describe('The block type ID (e.g., "google_sheets", "slack", "gmail")'),
    operation: z
      .string()
      .optional()
      .describe(
        'Optional operation ID (e.g., "read", "write"). If not provided, returns full block schema.'
      ),
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

  search_patterns: z.object({
    queries: z.array(z.string()).min(1).max(3),
    limit: z.number().optional().default(3),
  }),

  search_errors: z.object({
    query: z.string(),
    limit: z.number().optional().default(5),
  }),

  remember_debug: z.object({
    operation: z.enum(['add', 'edit', 'delete']),
    id: z.string().optional(),
    problem: z.string().optional(),
    solution: z.string().optional(),
    description: z.string().optional(),
  }),

  make_api_request: z.object({
    url: z.string(),
    method: z.enum(['GET', 'POST', 'PUT']),
    queryParams: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    headers: z.record(z.string()).optional(),
    body: z.union([z.record(z.any()), z.string()]).optional(),
  }),

  set_environment_variables: z.object({
    variables: z.record(z.string()),
  }),

  get_credentials: z.object({}),

  reason: z.object({
    reasoning: z.string(),
  }),

  knowledge_base: KnowledgeBaseArgsSchema,

  manage_custom_tool: z.object({
    operation: z
      .enum(['add', 'edit', 'delete'])
      .describe('The operation to perform: add (create new), edit (update existing), or delete'),
    toolId: z
      .string()
      .optional()
      .describe(
        'Required for edit and delete operations. The database ID of the custom tool (e.g., "0robnW7_JUVwZrDkq1mqj"). Use get_workflow_data with data_type "custom_tools" to get the list of tools and their IDs. Do NOT use the function name - use the actual "id" field from the tool.'
      ),
    schema: z
      .object({
        type: z.literal('function'),
        function: z.object({
          name: z.string().describe('The function name (camelCase, e.g. getWeather)'),
          description: z.string().optional().describe('What the function does'),
          parameters: z.object({
            type: z.string(),
            properties: z.record(z.any()),
            required: z.array(z.string()).optional(),
          }),
        }),
      })
      .optional()
      .describe('Required for add. The OpenAI function calling format schema.'),
    code: z
      .string()
      .optional()
      .describe(
        'Required for add. The JavaScript function body code. Use {{ENV_VAR}} for environment variables and reference parameters directly by name.'
      ),
  }),

  manage_mcp_tool: z.object({
    operation: z
      .enum(['add', 'edit', 'delete'])
      .describe('The operation to perform: add (create new), edit (update existing), or delete'),
    serverId: z
      .string()
      .optional()
      .describe(
        'Required for edit and delete operations. The database ID of the MCP server. Use the MCP settings panel or API to get server IDs.'
      ),
    config: z
      .object({
        name: z.string().describe('The display name for the MCP server'),
        transport: z
          .enum(['streamable-http'])
          .optional()
          .default('streamable-http')
          .describe('Transport protocol (currently only streamable-http is supported)'),
        url: z.string().optional().describe('The MCP server endpoint URL (required for add)'),
        headers: z
          .record(z.string())
          .optional()
          .describe('Optional HTTP headers to send with requests'),
        timeout: z.number().optional().describe('Request timeout in milliseconds (default: 30000)'),
        enabled: z.boolean().optional().describe('Whether the server is enabled (default: true)'),
      })
      .optional()
      .describe('Required for add and edit operations. The MCP server configuration.'),
  }),

  sleep: z.object({
    seconds: z
      .number()
      .min(0)
      .max(180)
      .describe('The number of seconds to sleep (0-180, max 3 minutes)'),
  }),

  get_block_outputs: z.object({
    blockIds: z
      .array(z.string())
      .optional()
      .describe(
        'Optional array of block UUIDs. If provided, returns outputs only for those blocks. If not provided, returns outputs for all blocks in the workflow.'
      ),
  }),

  get_block_upstream_references: z.object({
    blockIds: z
      .array(z.string())
      .min(1)
      .describe(
        'Array of block UUIDs. Returns all upstream references (block outputs and variables) accessible to each block based on workflow connections.'
      ),
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
  // Workflow data tool (variables, custom tools, MCP tools, files)
  get_workflow_data: toolCallSSEFor('get_workflow_data', ToolArgSchemas.get_workflow_data),
  set_global_workflow_variables: toolCallSSEFor(
    'set_global_workflow_variables',
    ToolArgSchemas.set_global_workflow_variables
  ),
  edit_workflow: toolCallSSEFor('edit_workflow', ToolArgSchemas.edit_workflow),
  run_workflow: toolCallSSEFor('run_workflow', ToolArgSchemas.run_workflow),
  get_workflow_console: toolCallSSEFor('get_workflow_console', ToolArgSchemas.get_workflow_console),
  get_blocks_and_tools: toolCallSSEFor('get_blocks_and_tools', ToolArgSchemas.get_blocks_and_tools),
  get_blocks_metadata: toolCallSSEFor('get_blocks_metadata', ToolArgSchemas.get_blocks_metadata),
  get_block_options: toolCallSSEFor('get_block_options', ToolArgSchemas.get_block_options),
  get_block_config: toolCallSSEFor('get_block_config', ToolArgSchemas.get_block_config),
  get_trigger_blocks: toolCallSSEFor('get_trigger_blocks', ToolArgSchemas.get_trigger_blocks),

  get_trigger_examples: toolCallSSEFor('get_trigger_examples', ToolArgSchemas.get_trigger_examples),
  get_examples_rag: toolCallSSEFor('get_examples_rag', ToolArgSchemas.get_examples_rag),
  get_operations_examples: toolCallSSEFor(
    'get_operations_examples',
    ToolArgSchemas.get_operations_examples
  ),
  search_documentation: toolCallSSEFor('search_documentation', ToolArgSchemas.search_documentation),
  search_online: toolCallSSEFor('search_online', ToolArgSchemas.search_online),
  search_patterns: toolCallSSEFor('search_patterns', ToolArgSchemas.search_patterns),
  search_errors: toolCallSSEFor('search_errors', ToolArgSchemas.search_errors),
  remember_debug: toolCallSSEFor('remember_debug', ToolArgSchemas.remember_debug),
  make_api_request: toolCallSSEFor('make_api_request', ToolArgSchemas.make_api_request),
  set_environment_variables: toolCallSSEFor(
    'set_environment_variables',
    ToolArgSchemas.set_environment_variables
  ),
  get_credentials: toolCallSSEFor('get_credentials', ToolArgSchemas.get_credentials),
  reason: toolCallSSEFor('reason', ToolArgSchemas.reason),
  // New
  oauth_request_access: toolCallSSEFor('oauth_request_access', ToolArgSchemas.oauth_request_access),
  deploy_workflow: toolCallSSEFor('deploy_workflow', ToolArgSchemas.deploy_workflow),
  check_deployment_status: toolCallSSEFor(
    'check_deployment_status',
    ToolArgSchemas.check_deployment_status
  ),
  navigate_ui: toolCallSSEFor('navigate_ui', ToolArgSchemas.navigate_ui),
  knowledge_base: toolCallSSEFor('knowledge_base', ToolArgSchemas.knowledge_base),
  manage_custom_tool: toolCallSSEFor('manage_custom_tool', ToolArgSchemas.manage_custom_tool),
  manage_mcp_tool: toolCallSSEFor('manage_mcp_tool', ToolArgSchemas.manage_mcp_tool),
  sleep: toolCallSSEFor('sleep', ToolArgSchemas.sleep),
  get_block_outputs: toolCallSSEFor('get_block_outputs', ToolArgSchemas.get_block_outputs),
  get_block_upstream_references: toolCallSSEFor(
    'get_block_upstream_references',
    ToolArgSchemas.get_block_upstream_references
  ),
} as const
export type ToolSSESchemaMap = typeof ToolSSESchemas

// Known result schemas per tool (what tool_result.result should conform to)
// Note: Where legacy variability exists, schema captures the common/expected shape for new runtime.
const BuildOrEditWorkflowResult = z.object({
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
  get_user_workflow: z.string(),
  list_user_workflows: z.object({ workflow_names: z.array(z.string()) }),
  get_workflow_from_name: z.object({ userWorkflow: z.string() }).or(z.string()),
  get_workflow_data: z.union([
    z.object({
      variables: z.array(z.object({ id: z.string(), name: z.string(), value: z.any() })),
    }),
    z.object({
      customTools: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          functionName: z.string(),
          description: z.string(),
          parameters: z.any().optional(),
        })
      ),
    }),
    z.object({
      mcpTools: z.array(
        z.object({
          name: z.string(),
          serverId: z.string(),
          serverName: z.string(),
          description: z.string(),
          inputSchema: z.any().optional(),
        })
      ),
    }),
    z.object({
      files: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          key: z.string(),
          path: z.string(),
          size: z.number(),
          type: z.string(),
          uploadedAt: z.string(),
        })
      ),
    }),
  ]),
  set_global_workflow_variables: z
    .object({ variables: z.record(z.any()) })
    .or(z.object({ message: z.any().optional(), data: z.any().optional() })),
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
  get_block_options: z.object({
    blockId: z.string(),
    blockName: z.string(),
    operations: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
      })
    ),
  }),
  get_block_config: z.object({
    blockType: z.string(),
    blockName: z.string(),
    operation: z.string().optional(),
    inputs: z.record(z.any()),
    outputs: z.record(z.any()),
  }),
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
  search_patterns: z.object({
    patterns: z.array(
      z.object({
        blocks_involved: z.array(z.string()).optional(),
        description: z.string().optional(),
        pattern_category: z.string().optional(),
        pattern_name: z.string().optional(),
        use_cases: z.array(z.string()).optional(),
        workflow_json: z.any().optional(),
      })
    ),
  }),
  search_errors: z.object({
    results: z.array(
      z.object({
        problem: z.string().optional(),
        solution: z.string().optional(),
        context: z.string().optional(),
        similarity: z.number().optional(),
      })
    ),
  }),
  remember_debug: z.object({
    success: z.boolean(),
    message: z.string().optional(),
    id: z.string().optional(),
  }),
  make_api_request: z.object({
    status: z.number(),
    statusText: z.string().optional(),
    headers: z.record(z.string()).optional(),
    body: z.any().optional(),
  }),
  set_environment_variables: z
    .object({ variables: z.record(z.string()) })
    .or(z.object({ message: z.any().optional(), data: z.any().optional() })),
  get_credentials: z.object({
    oauth: z.object({
      credentials: z.array(
        z.object({ id: z.string(), provider: z.string(), isDefault: z.boolean().optional() })
      ),
      total: z.number(),
    }),
    environment: z.object({
      variableNames: z.array(z.string()),
      count: z.number(),
    }),
  }),
  reason: z.object({ reasoning: z.string() }),
  deploy_workflow: z.object({
    action: z.enum(['deploy', 'undeploy']).optional(),
    deployType: z.enum(['api', 'chat']).optional(),
    isDeployed: z.boolean().optional(),
    deployedAt: z.string().optional(),
    needsApiKey: z.boolean().optional(),
    message: z.string().optional(),
    endpoint: z.string().optional(),
    curlCommand: z.string().optional(),
    apiKeyPlaceholder: z.string().optional(),
    openedModal: z.boolean().optional(),
  }),
  check_deployment_status: z.object({
    isDeployed: z.boolean(),
    deploymentTypes: z.array(z.string()),
    apiDeployed: z.boolean(),
    chatDeployed: z.boolean(),
    deployedAt: z.string().nullable(),
  }),
  navigate_ui: z.object({
    destination: z.enum(['workflow', 'logs', 'templates', 'vector_db', 'settings']),
    workflowName: z.string().optional(),
    navigated: z.boolean(),
  }),
  knowledge_base: KnowledgeBaseResultSchema,
  manage_custom_tool: z.object({
    success: z.boolean(),
    operation: z.enum(['add', 'edit', 'delete']),
    toolId: z.string().optional(),
    title: z.string().optional(),
    message: z.string().optional(),
  }),
  manage_mcp_tool: z.object({
    success: z.boolean(),
    operation: z.enum(['add', 'edit', 'delete']),
    serverId: z.string().optional(),
    serverName: z.string().optional(),
    message: z.string().optional(),
  }),
  sleep: z.object({
    success: z.boolean(),
    seconds: z.number(),
    message: z.string().optional(),
  }),
  get_block_outputs: z.object({
    blocks: z.array(
      z.object({
        blockId: z.string(),
        blockName: z.string(),
        blockType: z.string(),
        outputs: z.array(z.string()),
        insideSubflowOutputs: z.array(z.string()).optional(),
        outsideSubflowOutputs: z.array(z.string()).optional(),
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
  }),
  get_block_upstream_references: z.object({
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
  }),
} as const
export type ToolResultSchemaMap = typeof ToolResultSchemas

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

export type InferArgs<T extends ToolId> = z.infer<(typeof ToolArgSchemas)[T]>
export type InferResult<T extends ToolId> = z.infer<(typeof ToolResultSchemas)[T]>
export type InferToolCallSSE<T extends ToolId> = z.infer<(typeof ToolSSESchemas)[T]>
