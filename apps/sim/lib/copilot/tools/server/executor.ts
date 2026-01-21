import { createLogger } from '@sim/logger'
import { routeExecution } from './router'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'

const logger = createLogger('ServerToolExecutor')

export interface ServerToolContext {
  workflowId: string
  userId: string
  persistChanges?: boolean
}

export interface ServerToolResult {
  success: boolean
  result?: unknown
  error?: string
}

/**
 * Execute any copilot tool completely server-side.
 * This is the central dispatcher for headless/API operation.
 */
export async function executeToolServerSide(
  toolCall: { name: string; args: Record<string, unknown> },
  context: ServerToolContext
): Promise<ServerToolResult> {
  const { name, args } = toolCall
  const { workflowId, userId, persistChanges = true } = context

  logger.info('Executing tool server-side', { name, workflowId, userId })

  try {
    const result = await executeToolInternal(name, args, context)
    return { success: true, result }
  } catch (error) {
    logger.error('Server-side tool execution failed', {
      name,
      workflowId,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Tool execution failed',
    }
  }
}

async function executeToolInternal(
  name: string,
  args: Record<string, unknown>,
  context: ServerToolContext
): Promise<unknown> {
  const { workflowId, userId, persistChanges = true } = context

  switch (name) {
    case 'edit_workflow': {
      // Execute edit_workflow with direct persistence
      const result = await routeExecution(
        'edit_workflow',
        {
          ...args,
          workflowId,
          // Don't require currentUserWorkflow - server tool will load from DB
        },
        { userId }
      )

      // Persist directly to database if enabled
      if (persistChanges && result.workflowState) {
        try {
          await saveWorkflowToNormalizedTables(workflowId, result.workflowState)
          logger.info('Workflow changes persisted directly', { workflowId })
        } catch (error) {
          logger.error('Failed to persist workflow changes', { error, workflowId })
          // Don't throw - return the result anyway
        }
      }

      return result
    }

    case 'run_workflow': {
      // Import dynamically to avoid circular dependencies
      const { executeWorkflow } = await import('@/lib/workflows/executor/execute-workflow')

      const result = await executeWorkflow({
        workflowId,
        input: (args.workflow_input as Record<string, unknown>) || {},
        isClientSession: false,
      })

      return result
    }

    case 'deploy_api':
    case 'deploy_chat':
    case 'deploy_mcp': {
      // Import dynamically
      const { deployWorkflow } = await import('@/lib/workflows/persistence/utils')

      const deployType = name.replace('deploy_', '')
      const result = await deployWorkflow({
        workflowId,
        deployedBy: userId,
      })

      return { ...result, deployType }
    }

    case 'redeploy': {
      const { deployWorkflow } = await import('@/lib/workflows/persistence/utils')

      const result = await deployWorkflow({
        workflowId,
        deployedBy: userId,
      })

      return result
    }

    // Server tools that already exist in the router
    case 'get_blocks_and_tools':
    case 'get_blocks_metadata':
    case 'get_block_options':
    case 'get_block_config':
    case 'get_trigger_blocks':
    case 'get_workflow_console':
    case 'search_documentation':
    case 'search_online':
    case 'set_environment_variables':
    case 'get_credentials':
    case 'make_api_request':
    case 'knowledge_base': {
      return routeExecution(name, args, { userId })
    }

    // Tools that just need workflowId context
    case 'get_user_workflow':
    case 'get_workflow_data': {
      const { loadWorkflowFromNormalizedTables } = await import(
        '@/lib/workflows/persistence/utils'
      )
      const { sanitizeForCopilot } = await import('@/lib/workflows/sanitization/json-sanitizer')

      const workflowData = await loadWorkflowFromNormalizedTables(workflowId)
      if (!workflowData) {
        throw new Error('Workflow not found')
      }

      const sanitized = sanitizeForCopilot({
        blocks: workflowData.blocks,
        edges: workflowData.edges,
        loops: workflowData.loops,
        parallels: workflowData.parallels,
      })

      return { workflow: JSON.stringify(sanitized, null, 2) }
    }

    case 'list_user_workflows': {
      const { db } = await import('@sim/db')
      const { workflow: workflowTable } = await import('@sim/db/schema')
      const { eq } = await import('drizzle-orm')

      const workflows = await db
        .select({
          id: workflowTable.id,
          name: workflowTable.name,
          description: workflowTable.description,
          isDeployed: workflowTable.isDeployed,
          createdAt: workflowTable.createdAt,
          updatedAt: workflowTable.updatedAt,
        })
        .from(workflowTable)
        .where(eq(workflowTable.userId, userId))

      return { workflows }
    }

    case 'check_deployment_status': {
      const { db } = await import('@sim/db')
      const { workflow: workflowTable } = await import('@sim/db/schema')
      const { eq } = await import('drizzle-orm')

      const [wf] = await db
        .select({
          isDeployed: workflowTable.isDeployed,
          deployedAt: workflowTable.deployedAt,
        })
        .from(workflowTable)
        .where(eq(workflowTable.id, workflowId))
        .limit(1)

      return {
        isDeployed: wf?.isDeployed || false,
        deployedAt: wf?.deployedAt || null,
      }
    }

    default: {
      logger.warn('Unknown tool for server-side execution', { name })
      throw new Error(`Tool ${name} is not available for server-side execution`)
    }
  }
}

/**
 * Check if a tool can be executed server-side
 */
export function isServerExecutableTool(toolName: string): boolean {
  const serverExecutableTools = new Set([
    // Core editing tools
    'edit_workflow',
    'run_workflow',

    // Deployment tools
    'deploy_api',
    'deploy_chat',
    'deploy_mcp',
    'redeploy',
    'check_deployment_status',

    // Existing server tools
    'get_blocks_and_tools',
    'get_blocks_metadata',
    'get_block_options',
    'get_block_config',
    'get_trigger_blocks',
    'get_workflow_console',
    'search_documentation',
    'search_online',
    'set_environment_variables',
    'get_credentials',
    'make_api_request',
    'knowledge_base',

    // Workflow info tools
    'get_user_workflow',
    'get_workflow_data',
    'list_user_workflows',
  ])

  return serverExecutableTools.has(toolName)
}

/**
 * Get list of tools that require client-side execution
 */
export function getClientOnlyTools(): string[] {
  return [
    'navigate_ui', // Requires DOM
    'oauth_request_access', // Requires browser auth flow
  ]
}

