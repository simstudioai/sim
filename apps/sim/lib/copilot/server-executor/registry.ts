/**
 * Server Tool Registry
 *
 * Central registry for all server-executed tools. This replaces the scattered
 * executor files with a single, declarative registry.
 *
 * Benefits:
 * - Single source of truth for tool registration
 * - Type-safe with Zod schemas
 * - No duplicate wrapper code
 * - Easy to add new tools
 */

import { createLogger } from '@sim/logger'
import type { z } from 'zod'
import { getBlockConfigServerTool } from '../tools/server/blocks/get-block-config'
import { getBlockOptionsServerTool } from '../tools/server/blocks/get-block-options'
// Import server tool implementations
import { getBlocksAndToolsServerTool } from '../tools/server/blocks/get-blocks-and-tools'
import { getBlocksMetadataServerTool } from '../tools/server/blocks/get-blocks-metadata-tool'
import { getTriggerBlocksServerTool } from '../tools/server/blocks/get-trigger-blocks'
import { searchDocumentationServerTool } from '../tools/server/docs/search-documentation'
import { knowledgeBaseServerTool } from '../tools/server/knowledge/knowledge-base'
import { CheckoffTodoInput, checkoffTodoServerTool } from '../tools/server/other/checkoff-todo'
import { makeApiRequestServerTool } from '../tools/server/other/make-api-request'
import {
  MarkTodoInProgressInput,
  markTodoInProgressServerTool,
} from '../tools/server/other/mark-todo-in-progress'
import { searchOnlineServerTool } from '../tools/server/other/search-online'
import { SleepInput, sleepServerTool } from '../tools/server/other/sleep'
import { setContextServerTool } from '../tools/server/context/set-context'
import { getCredentialsServerTool } from '../tools/server/user/get-credentials'
import { setEnvironmentVariablesServerTool } from '../tools/server/user/set-environment-variables'
import {
  CheckDeploymentStatusInput,
  checkDeploymentStatusServerTool,
} from '../tools/server/workflow/check-deployment-status'
import {
  CreateWorkspaceMcpServerInput,
  createWorkspaceMcpServerServerTool,
} from '../tools/server/workflow/create-workspace-mcp-server'
import { DeployApiInput, deployApiServerTool } from '../tools/server/workflow/deploy-api'
import { DeployChatInput, deployChatServerTool } from '../tools/server/workflow/deploy-chat'
import { DeployMcpInput, deployMcpServerTool } from '../tools/server/workflow/deploy-mcp'
import { editWorkflowServerTool } from '../tools/server/workflow/edit-workflow'
import {
  GetBlockOutputsInput,
  getBlockOutputsServerTool,
} from '../tools/server/workflow/get-block-outputs'
import {
  GetUserWorkflowInput,
  getUserWorkflowServerTool,
} from '../tools/server/workflow/get-user-workflow'
import { getWorkflowConsoleServerTool } from '../tools/server/workflow/get-workflow-console'
import {
  GetWorkflowFromNameInput,
  getWorkflowFromNameServerTool,
} from '../tools/server/workflow/get-workflow-from-name'
import { listUserWorkflowsServerTool } from '../tools/server/workflow/list-user-workflows'
import {
  ListWorkspaceMcpServersInput,
  listWorkspaceMcpServersServerTool,
} from '../tools/server/workflow/list-workspace-mcp-servers'
import { RedeployInput, redeployServerTool } from '../tools/server/workflow/redeploy'
import { RunWorkflowInput, runWorkflowServerTool } from '../tools/server/workflow/run-workflow'
import {
  SetGlobalWorkflowVariablesInput,
  setGlobalWorkflowVariablesServerTool,
} from '../tools/server/workflow/set-global-workflow-variables'
import {
  GetBlockUpstreamReferencesInput,
  getBlockUpstreamReferencesServerTool,
} from '../tools/server/workflow/get-block-upstream-references'
import {
  GetWorkflowDataInput,
  getWorkflowDataServerTool,
} from '../tools/server/workflow/get-workflow-data'
import {
  ManageCustomToolInput,
  manageCustomToolServerTool,
} from '../tools/server/workflow/manage-custom-tool'
import {
  ManageMcpToolInput,
  manageMcpToolServerTool,
} from '../tools/server/workflow/manage-mcp-tool'
// Import schemas
import {
  EditWorkflowInput,
  GetBlockConfigInput,
  GetBlockOptionsInput,
  GetBlocksAndToolsInput,
  GetBlocksMetadataInput,
  GetCredentialsInput,
  GetTriggerBlocksInput,
  GetWorkflowConsoleInput,
  KnowledgeBaseArgsSchema,
  ListUserWorkflowsInput,
  MakeApiRequestInput,
  SearchDocumentationInput,
  SearchOnlineInput,
  SetContextInput,
  SetEnvironmentVariablesInput,
} from '../tools/shared/schemas'
import type { ExecutionContext, ToolResult } from './types'
import { errorResult, successResult } from './types'

const logger = createLogger('ToolRegistry')

/**
 * Context type for server tools.
 * This is the full execution context passed to tools that need workflow/workspace info.
 */
type ServerToolContext =
  | {
      userId: string
      workflowId?: string
      workspaceId?: string
    }
  | undefined

/**
 * Helper to create a typed executor wrapper.
 * This provides a clean boundary between our registry (unknown args)
 * and the underlying typed server tools.
 *
 * The generic TArgs is inferred from the Zod schema, ensuring type safety
 * at compile time while allowing runtime validation.
 */
function createExecutor<TArgs, TResult>(
  serverTool: { execute: (args: TArgs, ctx?: ServerToolContext) => Promise<TResult> },
  options: { passContext: boolean } = { passContext: true }
): (args: unknown, ctx: ServerToolContext) => Promise<unknown> {
  return (args, ctx) => {
    // After Zod validation, we know args matches TArgs
    // This cast is safe because validation happens before execution
    const typedArgs = args as TArgs
    return options.passContext ? serverTool.execute(typedArgs, ctx) : serverTool.execute(typedArgs)
  }
}

/**
 * Tool registration entry.
 */
interface ToolRegistration {
  /** Zod schema for input validation (optional) */
  inputSchema?: z.ZodType
  /** Whether this tool requires authentication */
  requiresAuth: boolean
  /** The underlying execute function */
  execute: (args: unknown, context: ServerToolContext) => Promise<unknown>
}

/**
 * The tool registry - maps tool names to their configurations.
 *
 * Each tool is registered with:
 * - inputSchema: Zod schema for validation (optional)
 * - requiresAuth: Whether userId is required
 * - execute: The underlying server tool's execute function
 */
const TOOL_REGISTRY: Record<string, ToolRegistration> = {
  // ─────────────────────────────────────────────────────────────────────────
  // Block Tools
  // ─────────────────────────────────────────────────────────────────────────
  get_blocks_and_tools: {
    inputSchema: GetBlocksAndToolsInput,
    requiresAuth: true,
    execute: createExecutor(getBlocksAndToolsServerTool),
  },
  get_block_config: {
    inputSchema: GetBlockConfigInput,
    requiresAuth: true,
    execute: createExecutor(getBlockConfigServerTool),
  },
  get_block_options: {
    inputSchema: GetBlockOptionsInput,
    requiresAuth: true,
    execute: createExecutor(getBlockOptionsServerTool),
  },
  get_blocks_metadata: {
    inputSchema: GetBlocksMetadataInput,
    requiresAuth: true,
    execute: createExecutor(getBlocksMetadataServerTool),
  },
  get_trigger_blocks: {
    inputSchema: GetTriggerBlocksInput,
    requiresAuth: true,
    execute: createExecutor(getTriggerBlocksServerTool),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Workflow Tools
  // ─────────────────────────────────────────────────────────────────────────
  edit_workflow: {
    inputSchema: EditWorkflowInput,
    requiresAuth: true,
    execute: createExecutor(editWorkflowServerTool),
  },
  get_workflow_console: {
    inputSchema: GetWorkflowConsoleInput,
    requiresAuth: false, // Tool validates workflowId itself
    execute: createExecutor(getWorkflowConsoleServerTool, { passContext: false }),
  },
  list_user_workflows: {
    inputSchema: ListUserWorkflowsInput,
    requiresAuth: true,
    execute: createExecutor(listUserWorkflowsServerTool),
  },
  get_workflow_from_name: {
    inputSchema: GetWorkflowFromNameInput,
    requiresAuth: true,
    execute: createExecutor(getWorkflowFromNameServerTool),
  },
  check_deployment_status: {
    inputSchema: CheckDeploymentStatusInput,
    requiresAuth: true,
    execute: createExecutor(checkDeploymentStatusServerTool),
  },
  list_workspace_mcp_servers: {
    inputSchema: ListWorkspaceMcpServersInput,
    requiresAuth: true,
    execute: createExecutor(listWorkspaceMcpServersServerTool),
  },
  set_global_workflow_variables: {
    inputSchema: SetGlobalWorkflowVariablesInput,
    requiresAuth: true,
    execute: createExecutor(setGlobalWorkflowVariablesServerTool),
  },
  redeploy: {
    inputSchema: RedeployInput,
    requiresAuth: true,
    execute: createExecutor(redeployServerTool),
  },
  create_workspace_mcp_server: {
    inputSchema: CreateWorkspaceMcpServerInput,
    requiresAuth: true,
    execute: createExecutor(createWorkspaceMcpServerServerTool),
  },
  deploy_api: {
    inputSchema: DeployApiInput,
    requiresAuth: true,
    execute: createExecutor(deployApiServerTool),
  },
  deploy_chat: {
    inputSchema: DeployChatInput,
    requiresAuth: true,
    execute: createExecutor(deployChatServerTool),
  },
  deploy_mcp: {
    inputSchema: DeployMcpInput,
    requiresAuth: true,
    execute: createExecutor(deployMcpServerTool),
  },
  run_workflow: {
    inputSchema: RunWorkflowInput,
    requiresAuth: true,
    execute: createExecutor(runWorkflowServerTool),
  },
  get_user_workflow: {
    inputSchema: GetUserWorkflowInput,
    requiresAuth: true,
    execute: createExecutor(getUserWorkflowServerTool),
  },
  get_block_outputs: {
    inputSchema: GetBlockOutputsInput,
    requiresAuth: true,
    execute: createExecutor(getBlockOutputsServerTool),
  },
  get_block_upstream_references: {
    inputSchema: GetBlockUpstreamReferencesInput,
    requiresAuth: true,
    execute: createExecutor(getBlockUpstreamReferencesServerTool),
  },
  get_workflow_data: {
    inputSchema: GetWorkflowDataInput,
    requiresAuth: true,
    execute: createExecutor(getWorkflowDataServerTool),
  },
  manage_custom_tool: {
    inputSchema: ManageCustomToolInput,
    requiresAuth: true,
    execute: createExecutor(manageCustomToolServerTool),
  },
  manage_mcp_tool: {
    inputSchema: ManageMcpToolInput,
    requiresAuth: true,
    execute: createExecutor(manageMcpToolServerTool),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Search Tools
  // ─────────────────────────────────────────────────────────────────────────
  search_documentation: {
    inputSchema: SearchDocumentationInput,
    requiresAuth: false,
    execute: createExecutor(searchDocumentationServerTool, { passContext: false }),
  },
  search_online: {
    inputSchema: SearchOnlineInput,
    requiresAuth: false,
    execute: createExecutor(searchOnlineServerTool, { passContext: false }),
  },
  make_api_request: {
    inputSchema: MakeApiRequestInput,
    requiresAuth: false,
    execute: createExecutor(makeApiRequestServerTool, { passContext: false }),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Knowledge Tools
  // ─────────────────────────────────────────────────────────────────────────
  knowledge_base: {
    inputSchema: KnowledgeBaseArgsSchema,
    requiresAuth: true,
    execute: createExecutor(knowledgeBaseServerTool),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // User Tools
  // ─────────────────────────────────────────────────────────────────────────
  get_credentials: {
    inputSchema: GetCredentialsInput,
    requiresAuth: true,
    execute: createExecutor(getCredentialsServerTool),
  },
  set_environment_variables: {
    inputSchema: SetEnvironmentVariablesInput,
    requiresAuth: true,
    execute: createExecutor(setEnvironmentVariablesServerTool),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Context Tools (for headless mode)
  // ─────────────────────────────────────────────────────────────────────────
  set_context: {
    inputSchema: SetContextInput,
    requiresAuth: true,
    execute: createExecutor(setContextServerTool),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Todo Tools
  // ─────────────────────────────────────────────────────────────────────────
  checkoff_todo: {
    inputSchema: CheckoffTodoInput,
    requiresAuth: false, // Just returns success, no auth needed
    execute: createExecutor(checkoffTodoServerTool, { passContext: false }),
  },
  mark_todo_in_progress: {
    inputSchema: MarkTodoInProgressInput,
    requiresAuth: false,
    execute: createExecutor(markTodoInProgressServerTool, { passContext: false }),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Utility Tools
  // ─────────────────────────────────────────────────────────────────────────
  sleep: {
    inputSchema: SleepInput,
    requiresAuth: false,
    execute: createExecutor(sleepServerTool, { passContext: false }),
  },
}

/**
 * List of all server-executed tool names.
 * Export this so clients know which tools NOT to execute locally.
 */
export const SERVER_EXECUTED_TOOLS = Object.keys(TOOL_REGISTRY)

/**
 * Check if a tool is registered for server execution.
 */
export function isServerExecutedTool(toolName: string): boolean {
  return toolName in TOOL_REGISTRY
}

/**
 * Execute a tool with proper validation and error handling.
 *
 * This is the main entry point for tool execution. It:
 * 1. Looks up the tool in the registry
 * 2. Validates input against the schema (if provided)
 * 3. Checks authentication requirements
 * 4. Executes the tool
 * 5. Returns a standardized ToolResult
 */
export async function executeRegisteredTool(
  toolName: string,
  args: unknown,
  context: ExecutionContext
): Promise<ToolResult> {
  const registration = TOOL_REGISTRY[toolName]

  if (!registration) {
    logger.warn('Unknown tool requested', { toolName })
    return errorResult('UNKNOWN_TOOL', `Tool '${toolName}' is not registered for server execution`)
  }

  // Check authentication requirement
  if (registration.requiresAuth && !context.userId) {
    logger.error('Authentication required but not provided', { toolName })
    return errorResult('AUTH_REQUIRED', `Tool '${toolName}' requires authentication`)
  }

  // Validate input if schema is provided
  let validatedArgs: unknown = args ?? {}
  if (registration.inputSchema) {
    const parseResult = registration.inputSchema.safeParse(args ?? {})
    if (!parseResult.success) {
      logger.warn('Input validation failed', {
        toolName,
        errors: parseResult.error.flatten(),
      })
      return errorResult('VALIDATION_ERROR', 'Invalid input arguments', {
        errors: parseResult.error.flatten().fieldErrors,
      })
    }
    validatedArgs = parseResult.data
  }

  // Execute the tool
  try {
    // Pass the full execution context so tools can access workflowId/workspaceId
    const toolContext = context.userId
      ? {
          userId: context.userId,
          workflowId: context.workflowId,
          workspaceId: context.workspaceId,
        }
      : undefined
    const result = await registration.execute(validatedArgs, toolContext)
    return successResult(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Tool execution failed', { toolName, error: message })
    return errorResult('EXECUTION_ERROR', message)
  }
}
