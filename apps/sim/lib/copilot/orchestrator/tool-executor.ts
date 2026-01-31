import { db } from '@sim/db'
import {
  account,
  chat,
  customTools,
  permissions,
  workflow,
  workflowFolder,
  workflowMcpServer,
  workflowMcpTool,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, desc, eq, inArray, isNull, max, or } from 'drizzle-orm'
import { refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { checkChatAccess, checkWorkflowAccessForChatCreation } from '@/app/api/chat/utils'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'
import { normalizeName } from '@/executor/constants'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/copilot/constants'
import { generateRequestId } from '@/lib/core/utils/request'
import { env } from '@/lib/core/config/env'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { listWorkspaceFiles } from '@/lib/uploads/contexts/workspace'
import { mcpService } from '@/lib/mcp/service'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import {
  deployWorkflow,
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
  undeployWorkflow,
} from '@/lib/workflows/persistence/utils'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import { BlockPathCalculator } from '@/lib/workflows/blocks/block-path-calculator'
import { getBlockOutputPaths } from '@/lib/workflows/blocks/block-outputs'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import { hasValidStartBlock } from '@/lib/workflows/triggers/trigger-utils.server'
import { executeTool } from '@/tools'
import { getTool, resolveToolId } from '@/tools/utils'
import { routeExecution } from '@/lib/copilot/tools/server/router'
import { sanitizeToolName } from '@/lib/mcp/workflow-tool-schema'
import type { ExecutionContext, ToolCallResult, ToolCallState } from '@/lib/copilot/orchestrator/types'

const logger = createLogger('CopilotToolExecutor')
const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

const SERVER_TOOLS = new Set<string>([
  'get_blocks_and_tools',
  'get_blocks_metadata',
  'get_block_options',
  'get_block_config',
  'get_trigger_blocks',
  'edit_workflow',
  'get_workflow_console',
  'search_documentation',
  'search_online',
  'set_environment_variables',
  'get_credentials',
  'make_api_request',
  'knowledge_base',
])

const SIM_WORKFLOW_TOOLS = new Set<string>([
  'get_user_workflow',
  'get_workflow_from_name',
  'list_user_workflows',
  'list_user_workspaces',
  'list_folders',
  'create_workflow',
  'create_folder',
  'get_workflow_data',
  'get_block_outputs',
  'get_block_upstream_references',
  'run_workflow',
  'set_global_workflow_variables',
  'deploy_api',
  'deploy_chat',
  'deploy_mcp',
  'redeploy',
  'check_deployment_status',
  'list_workspace_mcp_servers',
  'create_workspace_mcp_server',
])

/**
 * Execute a tool server-side without calling internal routes.
 */
export async function executeToolServerSide(
  toolCall: ToolCallState,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const toolName = toolCall.name
  const resolvedToolName = resolveToolId(toolName)

  if (SERVER_TOOLS.has(toolName)) {
    return executeServerToolDirect(toolName, toolCall.params || {}, context)
  }

  if (SIM_WORKFLOW_TOOLS.has(toolName)) {
    return executeSimWorkflowTool(toolName, toolCall.params || {}, context)
  }

  const toolConfig = getTool(resolvedToolName)
  if (!toolConfig) {
    logger.warn('Tool not found in registry', { toolName, resolvedToolName })
    return {
      success: false,
      error: `Tool not found: ${toolName}`,
    }
  }

  return executeIntegrationToolDirect(toolCall, toolConfig, context)
}

/**
 * Execute a server tool directly via the server tool router.
 */
async function executeServerToolDirect(
  toolName: string,
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    // Inject workflowId from context if not provided in params
    // This is needed for tools like set_environment_variables that require workflowId
    const enrichedParams = { ...params }
    if (!enrichedParams.workflowId && context.workflowId) {
      enrichedParams.workflowId = context.workflowId
    }

    const result = await routeExecution(toolName, enrichedParams, { userId: context.userId })
    return { success: true, output: result }
  } catch (error) {
    logger.error('Server tool execution failed', {
      toolName,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Server tool execution failed',
    }
  }
}

/**
 * Execute an integration tool directly via the tools registry.
 */
async function executeIntegrationToolDirect(
  toolCall: ToolCallState,
  toolConfig: any,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const { userId, workflowId } = context
  const toolName = resolveToolId(toolCall.name)
  const toolArgs = toolCall.params || {}

  let workspaceId = context.workspaceId
  if (!workspaceId && workflowId) {
    const workflowResult = await db
      .select({ workspaceId: workflow.workspaceId })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)
    workspaceId = workflowResult[0]?.workspaceId ?? undefined
  }

  const decryptedEnvVars =
    context.decryptedEnvVars || (await getEffectiveDecryptedEnv(userId, workspaceId))

  const executionParams: Record<string, any> = resolveEnvVarReferences(
    toolArgs,
    decryptedEnvVars,
    { deep: true }
  ) as Record<string, any>

  if (toolConfig.oauth?.required && toolConfig.oauth.provider) {
    const provider = toolConfig.oauth.provider
    const accounts = await db
      .select()
      .from(account)
      .where(and(eq(account.providerId, provider), eq(account.userId, userId)))
      .limit(1)

    if (!accounts.length) {
      return {
        success: false,
        error: `No ${provider} account connected. Please connect your account first.`,
      }
    }

    const acc = accounts[0]
    const requestId = generateRequestId()
    const { accessToken } = await refreshTokenIfNeeded(requestId, acc as any, acc.id)

    if (!accessToken) {
      return {
        success: false,
        error: `OAuth token not available for ${provider}. Please reconnect your account.`,
      }
    }

    executionParams.accessToken = accessToken
  }

  if (toolConfig.params?.apiKey?.required && !executionParams.apiKey) {
    return {
      success: false,
      error: `API key not provided for ${toolName}. Use {{YOUR_API_KEY_ENV_VAR}} to reference your environment variable.`,
    }
  }

  executionParams._context = {
    workflowId,
    userId,
  }

  if (toolName === 'function_execute') {
    executionParams.envVars = decryptedEnvVars
    executionParams.workflowVariables = {}
    executionParams.blockData = {}
    executionParams.blockNameMapping = {}
    executionParams.language = executionParams.language || 'javascript'
    executionParams.timeout = executionParams.timeout || 30000
  }

  const result = await executeTool(toolName, executionParams)

  return {
    success: result.success,
    output: result.output,
    error: result.error,
  }
}

async function executeSimWorkflowTool(
  toolName: string,
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  switch (toolName) {
    case 'get_user_workflow':
      return executeGetUserWorkflow(params, context)
    case 'get_workflow_from_name':
      return executeGetWorkflowFromName(params, context)
    case 'list_user_workflows':
      return executeListUserWorkflows(params, context)
    case 'list_user_workspaces':
      return executeListUserWorkspaces(context)
    case 'list_folders':
      return executeListFolders(params, context)
    case 'create_workflow':
      return executeCreateWorkflow(params, context)
    case 'create_folder':
      return executeCreateFolder(params, context)
    case 'get_workflow_data':
      return executeGetWorkflowData(params, context)
    case 'get_block_outputs':
      return executeGetBlockOutputs(params, context)
    case 'get_block_upstream_references':
      return executeGetBlockUpstreamReferences(params, context)
    case 'run_workflow':
      return executeRunWorkflow(params, context)
    case 'set_global_workflow_variables':
      return executeSetGlobalWorkflowVariables(params, context)
    case 'deploy_api':
      return executeDeployApi(params, context)
    case 'deploy_chat':
      return executeDeployChat(params, context)
    case 'deploy_mcp':
      return executeDeployMcp(params, context)
    case 'redeploy':
      return executeRedeploy(context)
    case 'check_deployment_status':
      return executeCheckDeploymentStatus(params, context)
    case 'list_workspace_mcp_servers':
      return executeListWorkspaceMcpServers(params, context)
    case 'create_workspace_mcp_server':
      return executeCreateWorkspaceMcpServer(params, context)
    default:
      return { success: false, error: `Unsupported workflow tool: ${toolName}` }
  }
}

async function ensureWorkflowAccess(workflowId: string, userId: string): Promise<{
  workflow: typeof workflow.$inferSelect
  workspaceId?: string | null
}> {
  const [workflowRecord] = await db
    .select()
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)
  if (!workflowRecord) {
    throw new Error(`Workflow ${workflowId} not found`)
  }

  if (workflowRecord.userId === userId) {
    return { workflow: workflowRecord, workspaceId: workflowRecord.workspaceId }
  }

  if (workflowRecord.workspaceId) {
    const [permissionRow] = await db
      .select({ permissionType: permissions.permissionType })
      .from(permissions)
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workflowRecord.workspaceId),
          eq(permissions.userId, userId)
        )
      )
      .limit(1)
    if (permissionRow) {
      return { workflow: workflowRecord, workspaceId: workflowRecord.workspaceId }
    }
  }

  throw new Error('Unauthorized workflow access')
}

async function getDefaultWorkspaceId(userId: string): Promise<string> {
  const workspaces = await db
    .select({ workspaceId: workspace.id })
    .from(permissions)
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(and(eq(permissions.userId, userId), eq(permissions.entityType, 'workspace')))
    .orderBy(desc(workspace.createdAt))
    .limit(1)

  const workspaceId = workspaces[0]?.workspaceId
  if (!workspaceId) {
    throw new Error('No workspace found for user')
  }

  return workspaceId
}

async function ensureWorkspaceAccess(
  workspaceId: string,
  userId: string,
  requireWrite: boolean
): Promise<void> {
  const [row] = await db
    .select({
      permissionType: permissions.permissionType,
      ownerId: workspace.ownerId,
    })
    .from(permissions)
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId),
        eq(permissions.userId, userId)
      )
    )
    .limit(1)

  if (!row) {
    throw new Error(`Workspace ${workspaceId} not found`)
  }

  const isOwner = row.ownerId === userId
  const permissionType = row.permissionType
  const canWrite = isOwner || permissionType === 'admin' || permissionType === 'write'

  if (requireWrite && !canWrite) {
    throw new Error('Write or admin access required for this workspace')
  }

  if (!requireWrite && !canWrite && permissionType !== 'read') {
    throw new Error('Access denied to workspace')
  }
}

async function executeGetUserWorkflow(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }

    const { workflow: workflowRecord, workspaceId } = await ensureWorkflowAccess(
      workflowId,
      context.userId
    )

    const normalized = await loadWorkflowFromNormalizedTables(workflowId)
    if (!normalized) {
      return { success: false, error: 'Workflow has no normalized data' }
    }

    const workflowState = {
      blocks: normalized.blocks || {},
      edges: normalized.edges || [],
      loops: normalized.loops || {},
      parallels: normalized.parallels || {},
    }
    const sanitized = sanitizeForCopilot(workflowState)
    const userWorkflow = JSON.stringify(sanitized, null, 2)

    // Return workflow ID so copilot can use it for subsequent tool calls
    return {
      success: true,
      output: {
        workflowId,
        workflowName: workflowRecord.name || '',
        workspaceId,
        userWorkflow,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeGetWorkflowFromName(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowName = typeof params.workflow_name === 'string' ? params.workflow_name.trim() : ''
    if (!workflowName) {
      return { success: false, error: 'workflow_name is required' }
    }

    const workspaceIds = await db
      .select({ entityId: permissions.entityId })
      .from(permissions)
      .where(and(eq(permissions.userId, context.userId), eq(permissions.entityType, 'workspace')))

    const workspaceIdList = workspaceIds.map((row) => row.entityId)

    const workflowConditions = [eq(workflow.userId, context.userId)]
    if (workspaceIdList.length > 0) {
      workflowConditions.push(inArray(workflow.workspaceId, workspaceIdList))
    }
    const workflows = await db
      .select()
      .from(workflow)
      .where(or(...workflowConditions))

    const match = workflows.find(
      (w) => String(w.name || '').trim().toLowerCase() === workflowName.toLowerCase()
    )
    if (!match) {
      return { success: false, error: `Workflow not found: ${workflowName}` }
    }

    const normalized = await loadWorkflowFromNormalizedTables(match.id)
    if (!normalized) {
      return { success: false, error: 'Workflow has no normalized data' }
    }

    const workflowState = {
      blocks: normalized.blocks || {},
      edges: normalized.edges || [],
      loops: normalized.loops || {},
      parallels: normalized.parallels || {},
    }
    const sanitized = sanitizeForCopilot(workflowState)
    const userWorkflow = JSON.stringify(sanitized, null, 2)

    // Return workflow ID and workspaceId so copilot can use them for subsequent tool calls
    return {
      success: true,
      output: {
        workflowId: match.id,
        workflowName: match.name || '',
        workspaceId: match.workspaceId,
        userWorkflow,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeListUserWorkflows(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workspaceId = params?.workspaceId as string | undefined
    const folderId = params?.folderId as string | undefined

    const workspaceIds = await db
      .select({ entityId: permissions.entityId })
      .from(permissions)
      .where(and(eq(permissions.userId, context.userId), eq(permissions.entityType, 'workspace')))

    const workspaceIdList = workspaceIds.map((row) => row.entityId)

    const workflowConditions = [eq(workflow.userId, context.userId)]
    if (workspaceIdList.length > 0) {
      workflowConditions.push(inArray(workflow.workspaceId, workspaceIdList))
    }
    if (workspaceId) {
      workflowConditions.push(eq(workflow.workspaceId, workspaceId))
    }
    if (folderId) {
      workflowConditions.push(eq(workflow.folderId, folderId))
    }
    const workflows = await db
      .select()
      .from(workflow)
      .where(or(...workflowConditions))
      .orderBy(asc(workflow.sortOrder), asc(workflow.createdAt), asc(workflow.id))

    // Return both names (for backward compatibility) and full workflow info with IDs
    const names = workflows
      .map((w) => (typeof w.name === 'string' ? w.name : null))
      .filter((n): n is string => Boolean(n))

    const workflowList = workflows.map((w) => ({
      workflowId: w.id,
      workflowName: w.name || '',
      workspaceId: w.workspaceId,
      folderId: w.folderId,
    }))

    return { success: true, output: { workflow_names: names, workflows: workflowList } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeListUserWorkspaces(context: ExecutionContext): Promise<ToolCallResult> {
  try {
    const workspaces = await db
      .select({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        ownerId: workspace.ownerId,
        permissionType: permissions.permissionType,
      })
      .from(permissions)
      .innerJoin(workspace, eq(permissions.entityId, workspace.id))
      .where(and(eq(permissions.userId, context.userId), eq(permissions.entityType, 'workspace')))
      .orderBy(desc(workspace.createdAt))

    const output = workspaces.map((row) => ({
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName,
      role: row.ownerId === context.userId ? 'owner' : row.permissionType,
    }))

    return { success: true, output: { workspaces: output } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeListFolders(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workspaceId = (params?.workspaceId as string | undefined) ||
      (await getDefaultWorkspaceId(context.userId))

    await ensureWorkspaceAccess(workspaceId, context.userId, false)

    const folders = await db
      .select({
        folderId: workflowFolder.id,
        folderName: workflowFolder.name,
        parentId: workflowFolder.parentId,
        sortOrder: workflowFolder.sortOrder,
      })
      .from(workflowFolder)
      .where(eq(workflowFolder.workspaceId, workspaceId))
      .orderBy(asc(workflowFolder.sortOrder), asc(workflowFolder.createdAt))

    return {
      success: true,
      output: {
        workspaceId,
        folders,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeCreateWorkflow(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const name = typeof params?.name === 'string' ? params.name.trim() : ''
    if (!name) {
      return { success: false, error: 'name is required' }
    }

    const workspaceId = params?.workspaceId || (await getDefaultWorkspaceId(context.userId))
    const folderId = params?.folderId || null
    const description = typeof params?.description === 'string' ? params.description : null

    await ensureWorkspaceAccess(workspaceId, context.userId, true)

    const workflowId = crypto.randomUUID()
    const now = new Date()

    const folderCondition = folderId ? eq(workflow.folderId, folderId) : isNull(workflow.folderId)
    const [maxResult] = await db
      .select({ maxOrder: max(workflow.sortOrder) })
      .from(workflow)
      .where(and(eq(workflow.workspaceId, workspaceId), folderCondition))
    const sortOrder = (maxResult?.maxOrder ?? 0) + 1

    await db.insert(workflow).values({
      id: workflowId,
      userId: context.userId,
      workspaceId,
      folderId,
      sortOrder,
      name,
      description,
      color: '#3972F6',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      runCount: 0,
      variables: {},
    })

    const { workflowState } = buildDefaultWorkflowArtifacts()
    const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowState)
    if (!saveResult.success) {
      throw new Error(saveResult.error || 'Failed to save workflow state')
    }

    return {
      success: true,
      output: {
        workflowId,
        workflowName: name,
        workspaceId,
        folderId,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeCreateFolder(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const name = typeof params?.name === 'string' ? params.name.trim() : ''
    if (!name) {
      return { success: false, error: 'name is required' }
    }

    const workspaceId = params?.workspaceId || (await getDefaultWorkspaceId(context.userId))
    const parentId = params?.parentId || null

    await ensureWorkspaceAccess(workspaceId, context.userId, true)

    const [maxOrder] = await db
      .select({ maxOrder: max(workflowFolder.sortOrder) })
      .from(workflowFolder)
      .where(
        and(
          eq(workflowFolder.workspaceId, workspaceId),
          parentId ? eq(workflowFolder.parentId, parentId) : isNull(workflowFolder.parentId)
        )
      )
      .limit(1)

    const sortOrder = (maxOrder?.maxOrder ?? 0) + 1
    const folderId = crypto.randomUUID()

    await db.insert(workflowFolder).values({
      id: folderId,
      name,
      userId: context.userId,
      workspaceId,
      parentId,
      color: '#6B7280',
      sortOrder,
    })

    return {
      success: true,
      output: {
        folderId,
        folderName: name,
        workspaceId,
        parentId,
        sortOrder,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeGetWorkflowData(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const dataType = params.data_type
    if (!dataType) {
      return { success: false, error: 'data_type is required' }
    }
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }

    const { workflow: workflowRecord, workspaceId } = await ensureWorkflowAccess(
      workflowId,
      context.userId
    )

    if (dataType === 'global_variables') {
      const variablesRecord = (workflowRecord.variables as Record<string, any>) || {}
      const variables = Object.values(variablesRecord).map((v: any) => ({
        id: String(v?.id || ''),
        name: String(v?.name || ''),
        value: v?.value,
      }))
      return { success: true, output: { variables } }
    }

    if (dataType === 'custom_tools') {
      if (!workspaceId) {
        return { success: false, error: 'workspaceId is required' }
      }
      const conditions = [
        eq(customTools.workspaceId, workspaceId),
        and(eq(customTools.userId, context.userId), isNull(customTools.workspaceId)),
      ]
      const toolsRows = await db
        .select()
        .from(customTools)
        .where(or(...conditions))
        .orderBy(desc(customTools.createdAt))

      const customToolsData = toolsRows.map((tool) => ({
        id: String(tool.id || ''),
        title: String(tool.title || ''),
        functionName: String((tool.schema as any)?.function?.name || ''),
        description: String((tool.schema as any)?.function?.description || ''),
        parameters: (tool.schema as any)?.function?.parameters,
      }))

      return { success: true, output: { customTools: customToolsData } }
    }

    if (dataType === 'mcp_tools') {
      if (!workspaceId) {
        return { success: false, error: 'workspaceId is required' }
      }
      const tools = await mcpService.discoverTools(context.userId, workspaceId, false)
      const mcpTools = tools.map((tool) => ({
        name: String(tool.name || ''),
        serverId: String(tool.serverId || ''),
        serverName: String(tool.serverName || ''),
        description: String(tool.description || ''),
        inputSchema: tool.inputSchema,
      }))
      return { success: true, output: { mcpTools } }
    }

    if (dataType === 'files') {
      if (!workspaceId) {
        return { success: false, error: 'workspaceId is required' }
      }
      const files = await listWorkspaceFiles(workspaceId)
      const fileResults = files.map((file) => ({
        id: String(file.id || ''),
        name: String(file.name || ''),
        key: String(file.key || ''),
        path: String(file.path || ''),
        size: Number(file.size || 0),
        type: String(file.type || ''),
        uploadedAt: String(file.uploadedAt || ''),
      }))
      return { success: true, output: { files: fileResults } }
    }

    return { success: false, error: `Unknown data_type: ${dataType}` }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeGetBlockOutputs(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    await ensureWorkflowAccess(workflowId, context.userId)

    const normalized = await loadWorkflowFromNormalizedTables(workflowId)
    if (!normalized) {
      return { success: false, error: 'Workflow has no normalized data' }
    }

    const blocks = normalized.blocks || {}
    const loops = normalized.loops || {}
    const parallels = normalized.parallels || {}
    const blockIds = Array.isArray(params.blockIds) && params.blockIds.length > 0
      ? params.blockIds
      : Object.keys(blocks)

    const results: Array<{
      blockId: string
      blockName: string
      blockType: string
      outputs: string[]
      insideSubflowOutputs?: string[]
      outsideSubflowOutputs?: string[]
      triggerMode?: boolean
    }> = []

    for (const blockId of blockIds) {
      const block = blocks[blockId]
      if (!block?.type) continue
      const blockName = block.name || block.type

      if (block.type === 'loop' || block.type === 'parallel') {
        const insidePaths = getSubflowInsidePaths(block.type, blockId, loops, parallels)
        results.push({
          blockId,
          blockName,
          blockType: block.type,
          outputs: [],
          insideSubflowOutputs: formatOutputsWithPrefix(insidePaths, blockName),
          outsideSubflowOutputs: formatOutputsWithPrefix(['results'], blockName),
          triggerMode: block.triggerMode,
        })
        continue
      }

      const outputs = getBlockOutputPaths(block.type, block.subBlocks, block.triggerMode)
      results.push({
        blockId,
        blockName,
        blockType: block.type,
        outputs: formatOutputsWithPrefix(outputs, blockName),
        triggerMode: block.triggerMode,
      })
    }

    const variables = await getWorkflowVariablesForTool(workflowId)

    const payload = { blocks: results, variables }
    return { success: true, output: payload }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeGetBlockUpstreamReferences(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    if (!Array.isArray(params.blockIds) || params.blockIds.length === 0) {
      return { success: false, error: 'blockIds array is required' }
    }

    await ensureWorkflowAccess(workflowId, context.userId)
    const normalized = await loadWorkflowFromNormalizedTables(workflowId)
    if (!normalized) {
      return { success: false, error: 'Workflow has no normalized data' }
    }

    const blocks = normalized.blocks || {}
    const edges = normalized.edges || []
    const loops = normalized.loops || {}
    const parallels = normalized.parallels || {}

    const graphEdges = edges.map((edge: any) => ({ source: edge.source, target: edge.target }))
    const variableOutputs = await getWorkflowVariablesForTool(workflowId)

    const results: any[] = []

    for (const blockId of params.blockIds) {
      const targetBlock = blocks[blockId]
      if (!targetBlock) continue

      const insideSubflows: Array<{ blockId: string; blockName: string; blockType: string }> = []
      const containingLoopIds = new Set<string>()
      const containingParallelIds = new Set<string>()

      Object.values(loops as Record<string, any>).forEach((loop) => {
        if (loop?.nodes?.includes(blockId)) {
          containingLoopIds.add(loop.id)
          const loopBlock = blocks[loop.id]
          if (loopBlock) {
            insideSubflows.push({
              blockId: loop.id,
              blockName: loopBlock.name || loopBlock.type,
              blockType: 'loop',
            })
          }
        }
      })

      Object.values(parallels as Record<string, any>).forEach((parallel) => {
        if (parallel?.nodes?.includes(blockId)) {
          containingParallelIds.add(parallel.id)
          const parallelBlock = blocks[parallel.id]
          if (parallelBlock) {
            insideSubflows.push({
              blockId: parallel.id,
              blockName: parallelBlock.name || parallelBlock.type,
              blockType: 'parallel',
            })
          }
        }
      })

      const ancestorIds = BlockPathCalculator.findAllPathNodes(graphEdges, blockId)
      const accessibleIds = new Set<string>(ancestorIds)
      accessibleIds.add(blockId)

      const starterBlock = Object.values(blocks).find((b: any) => isInputDefinitionTrigger(b.type))
      if (starterBlock && ancestorIds.includes((starterBlock as any).id)) {
        accessibleIds.add((starterBlock as any).id)
      }

      containingLoopIds.forEach((loopId) => {
        accessibleIds.add(loopId)
        loops[loopId]?.nodes?.forEach((nodeId: string) => accessibleIds.add(nodeId))
      })

      containingParallelIds.forEach((parallelId) => {
        accessibleIds.add(parallelId)
        parallels[parallelId]?.nodes?.forEach((nodeId: string) => accessibleIds.add(nodeId))
      })

      const accessibleBlocks: any[] = []

      for (const accessibleBlockId of accessibleIds) {
        const block = blocks[accessibleBlockId]
        if (!block?.type) continue
        const canSelfReference =
          block.type === 'approval' || block.type === 'human_in_the_loop'
        if (accessibleBlockId === blockId && !canSelfReference) continue

        const blockName = block.name || block.type
        let accessContext: 'inside' | 'outside' | undefined
        let outputPaths: string[]

        if (block.type === 'loop' || block.type === 'parallel') {
          const isInside =
            (block.type === 'loop' && containingLoopIds.has(accessibleBlockId)) ||
            (block.type === 'parallel' && containingParallelIds.has(accessibleBlockId))
          accessContext = isInside ? 'inside' : 'outside'
          outputPaths = isInside
            ? getSubflowInsidePaths(block.type, accessibleBlockId, loops, parallels)
            : ['results']
        } else {
          outputPaths = getBlockOutputPaths(block.type, block.subBlocks, block.triggerMode)
        }

        const formattedOutputs = formatOutputsWithPrefix(outputPaths, blockName)
        const entry: any = {
          blockId: accessibleBlockId,
          blockName,
          blockType: block.type,
          outputs: formattedOutputs,
        }
        if (block.triggerMode) entry.triggerMode = true
        if (accessContext) entry.accessContext = accessContext
        accessibleBlocks.push(entry)
      }

      results.push({
        blockId,
        blockName: targetBlock.name || targetBlock.type,
        blockType: targetBlock.type,
        accessibleBlocks,
        insideSubflows,
        variables: variableOutputs,
      })
    }

    const payload = { results }
    return { success: true, output: payload }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeRunWorkflow(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }

    const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)

    const result = await executeWorkflow(
      {
        id: workflowRecord.id,
        userId: workflowRecord.userId,
        workspaceId: workflowRecord.workspaceId,
        variables: workflowRecord.variables || {},
      },
      generateRequestId(),
      params.workflow_input || params.input || undefined,
      context.userId
    )

    return {
      success: result.success,
      output: {
        executionId: result.executionId,
        success: result.success,
        output: result.output,
        logs: result.logs,
      },
      error: result.success ? undefined : result.error || 'Workflow execution failed',
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeSetGlobalWorkflowVariables(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const operations = Array.isArray(params.operations) ? params.operations : []
    const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)

    const currentVarsRecord = (workflowRecord.variables as Record<string, any>) || {}
    const byName: Record<string, any> = {}
    Object.values(currentVarsRecord).forEach((v: any) => {
      if (v && typeof v === 'object' && v.id && v.name) byName[String(v.name)] = v
    })

    for (const op of operations) {
      const key = String(op?.name || '')
      if (!key) continue
      const nextType = op?.type || byName[key]?.type || 'plain'
      const coerceValue = (value: any, type: string) => {
        if (value === undefined) return value
        if (type === 'number') {
          const n = Number(value)
          return Number.isNaN(n) ? value : n
        }
        if (type === 'boolean') {
          const v = String(value).trim().toLowerCase()
          if (v === 'true') return true
          if (v === 'false') return false
          return value
        }
        if (type === 'array' || type === 'object') {
          try {
            const parsed = JSON.parse(String(value))
            if (type === 'array' && Array.isArray(parsed)) return parsed
            if (type === 'object' && parsed && typeof parsed === 'object' && !Array.isArray(parsed))
              return parsed
          } catch {}
          return value
        }
        return value
      }

      if (op.operation === 'delete') {
        delete byName[key]
        continue
      }
      const typedValue = coerceValue(op.value, nextType)
      if (op.operation === 'add') {
        byName[key] = {
          id: crypto.randomUUID(),
          workflowId,
          name: key,
          type: nextType,
          value: typedValue,
        }
        continue
      }
      if (op.operation === 'edit') {
        if (!byName[key]) {
          byName[key] = {
            id: crypto.randomUUID(),
            workflowId,
            name: key,
            type: nextType,
            value: typedValue,
          }
        } else {
          byName[key] = {
            ...byName[key],
            type: nextType,
            value: typedValue,
          }
        }
      }
    }

    const nextVarsRecord = Object.fromEntries(
      Object.values(byName).map((v: any) => [String(v.id), v])
    )

    await db
      .update(workflow)
      .set({ variables: nextVarsRecord, updatedAt: new Date() })
      .where(eq(workflow.id, workflowId))

    return { success: true, output: { updated: Object.values(byName).length } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeDeployApi(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const action = params.action === 'undeploy' ? 'undeploy' : 'deploy'
    const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)

    if (action === 'undeploy') {
      const result = await undeployWorkflow({ workflowId })
      if (!result.success) {
        return { success: false, error: result.error || 'Failed to undeploy workflow' }
      }
      return { success: true, output: { workflowId, isDeployed: false } }
    }

    const result = await deployWorkflow({
      workflowId,
      deployedBy: context.userId,
      workflowName: workflowRecord.name || undefined,
    })
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to deploy workflow' }
    }

    return {
      success: true,
      output: { workflowId, isDeployed: true, deployedAt: result.deployedAt, version: result.version },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeDeployChat(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }

    const action = params.action === 'undeploy' ? 'undeploy' : 'deploy'
    if (action === 'undeploy') {
      const existing = await db.select().from(chat).where(eq(chat.workflowId, workflowId)).limit(1)
      if (!existing.length) {
        return { success: false, error: 'No active chat deployment found for this workflow' }
      }
      const { hasAccess } = await checkChatAccess(existing[0].id, context.userId)
      if (!hasAccess) {
        return { success: false, error: 'Unauthorized chat access' }
      }
      await db.delete(chat).where(eq(chat.id, existing[0].id))
      return { success: true, output: { success: true, action: 'undeploy', isDeployed: false } }
    }

    const { hasAccess } = await checkWorkflowAccessForChatCreation(workflowId, context.userId)
    if (!hasAccess) {
      return { success: false, error: 'Workflow not found or access denied' }
    }

    const existing = await db.select().from(chat).where(eq(chat.workflowId, workflowId)).limit(1)
    const existingDeployment = existing[0] || null

    const identifier = String(params.identifier || existingDeployment?.identifier || '').trim()
    const title = String(params.title || existingDeployment?.title || '').trim()
    if (!identifier || !title) {
      return { success: false, error: 'Chat identifier and title are required' }
    }

    const identifierPattern = /^[a-z0-9-]+$/
    if (!identifierPattern.test(identifier)) {
      return { success: false, error: 'Identifier can only contain lowercase letters, numbers, and hyphens' }
    }

    const existingIdentifier = await db
      .select()
      .from(chat)
      .where(eq(chat.identifier, identifier))
      .limit(1)
    if (existingIdentifier.length > 0 && existingIdentifier[0].id !== existingDeployment?.id) {
      return { success: false, error: 'Identifier already in use' }
    }

    const deployResult = await deployWorkflow({
      workflowId,
      deployedBy: context.userId,
    })
    if (!deployResult.success) {
      return { success: false, error: deployResult.error || 'Failed to deploy workflow' }
    }

    const payload = {
      workflowId,
      identifier,
      title,
      description: String(params.description || existingDeployment?.description || ''),
      customizations: {
        primaryColor:
          params.customizations?.primaryColor ||
          existingDeployment?.customizations?.primaryColor ||
          'var(--brand-primary-hover-hex)',
        welcomeMessage:
          params.customizations?.welcomeMessage ||
          existingDeployment?.customizations?.welcomeMessage ||
          'Hi there! How can I help you today?',
      },
      authType: params.authType || existingDeployment?.authType || 'public',
      password: params.password,
      allowedEmails: params.allowedEmails || existingDeployment?.allowedEmails || [],
      outputConfigs: params.outputConfigs || existingDeployment?.outputConfigs || [],
    }

    if (existingDeployment) {
      await db
        .update(chat)
        .set({
          identifier: payload.identifier,
          title: payload.title,
          description: payload.description,
          customizations: payload.customizations,
          authType: payload.authType,
          password: payload.password || existingDeployment.password,
          allowedEmails:
            payload.authType === 'email' || payload.authType === 'sso' ? payload.allowedEmails : [],
          outputConfigs: payload.outputConfigs,
          updatedAt: new Date(),
        })
        .where(eq(chat.id, existingDeployment.id))
    } else {
      await db.insert(chat).values({
        id: crypto.randomUUID(),
        workflowId,
        userId: context.userId,
        identifier: payload.identifier,
        title: payload.title,
        description: payload.description,
        customizations: payload.customizations,
        isActive: true,
        authType: payload.authType,
        password: payload.password || null,
        allowedEmails:
          payload.authType === 'email' || payload.authType === 'sso' ? payload.allowedEmails : [],
        outputConfigs: payload.outputConfigs,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }

    return { success: true, output: { success: true, action: 'deploy', isDeployed: true, identifier } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeDeployMcp(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }

    const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)
    const workspaceId = workflowRecord.workspaceId
    if (!workspaceId) {
      return { success: false, error: 'workspaceId is required' }
    }

    if (!workflowRecord.isDeployed) {
      return {
        success: false,
        error: 'Workflow must be deployed before adding as an MCP tool. Use deploy_api first.',
      }
    }

    const serverId = params.serverId
    if (!serverId) {
      return {
        success: false,
        error: 'serverId is required. Use list_workspace_mcp_servers to get available servers.',
      }
    }

    const existingTool = await db
      .select()
      .from(workflowMcpTool)
      .where(and(eq(workflowMcpTool.serverId, serverId), eq(workflowMcpTool.workflowId, workflowId)))
      .limit(1)

    const toolName = sanitizeToolName(params.toolName || workflowRecord.name || `workflow_${workflowId}`)
    const toolDescription =
      params.toolDescription || workflowRecord.description || `Execute ${workflowRecord.name} workflow`
    const parameterSchema = params.parameterSchema || {}

    if (existingTool.length > 0) {
      const toolId = existingTool[0].id
      await db
        .update(workflowMcpTool)
        .set({
          toolName,
          toolDescription,
          parameterSchema,
          updatedAt: new Date(),
        })
        .where(eq(workflowMcpTool.id, toolId))
      return { success: true, output: { toolId, toolName, toolDescription, updated: true } }
    }

    const toolId = crypto.randomUUID()
    await db.insert(workflowMcpTool).values({
      id: toolId,
      serverId,
      workflowId,
      toolName,
      toolDescription,
      parameterSchema,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    return { success: true, output: { toolId, toolName, toolDescription, updated: false } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeRedeploy(context: ExecutionContext): Promise<ToolCallResult> {
  try {
    const workflowId = context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    await ensureWorkflowAccess(workflowId, context.userId)

    const result = await deployWorkflow({ workflowId, deployedBy: context.userId })
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to redeploy workflow' }
    }
    return {
      success: true,
      output: { workflowId, deployedAt: result.deployedAt || null, version: result.version },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeCheckDeploymentStatus(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)
    const workspaceId = workflowRecord.workspaceId

    const [apiDeploy, chatDeploy] = await Promise.all([
      db
        .select()
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1),
      db.select().from(chat).where(eq(chat.workflowId, workflowId)).limit(1),
    ])

    const isApiDeployed = apiDeploy[0]?.isDeployed || false
    const apiDetails = {
      isDeployed: isApiDeployed,
      deployedAt: apiDeploy[0]?.deployedAt || null,
      endpoint: isApiDeployed ? `/api/workflows/${workflowId}/execute` : null,
      apiKey: workflowRecord.workspaceId ? 'Workspace API keys' : 'Personal API keys',
      needsRedeployment: false,
    }

    const isChatDeployed = !!chatDeploy[0]
    const chatDetails = {
      isDeployed: isChatDeployed,
      chatId: chatDeploy[0]?.id || null,
      identifier: chatDeploy[0]?.identifier || null,
      chatUrl: isChatDeployed ? `/chat/${chatDeploy[0]?.identifier}` : null,
      title: chatDeploy[0]?.title || null,
      description: chatDeploy[0]?.description || null,
      authType: chatDeploy[0]?.authType || null,
      allowedEmails: chatDeploy[0]?.allowedEmails || null,
      outputConfigs: chatDeploy[0]?.outputConfigs || null,
      welcomeMessage: chatDeploy[0]?.customizations?.welcomeMessage || null,
      primaryColor: chatDeploy[0]?.customizations?.primaryColor || null,
      hasPassword: Boolean(chatDeploy[0]?.password),
    }

    const mcpDetails = { isDeployed: false, servers: [] as any[] }
    if (workspaceId) {
      const servers = await db
        .select({
          serverId: workflowMcpServer.id,
          serverName: workflowMcpServer.name,
          toolName: workflowMcpTool.toolName,
          toolDescription: workflowMcpTool.toolDescription,
          parameterSchema: workflowMcpTool.parameterSchema,
          toolId: workflowMcpTool.id,
        })
        .from(workflowMcpTool)
        .innerJoin(workflowMcpServer, eq(workflowMcpTool.serverId, workflowMcpServer.id))
        .where(eq(workflowMcpTool.workflowId, workflowId))

      if (servers.length > 0) {
        mcpDetails.isDeployed = true
        mcpDetails.servers = servers
      }
    }

    const isDeployed = apiDetails.isDeployed || chatDetails.isDeployed || mcpDetails.isDeployed
    return {
      success: true,
      output: { isDeployed, api: apiDetails, chat: chatDetails, mcp: mcpDetails },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeListWorkspaceMcpServers(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)
    const workspaceId = workflowRecord.workspaceId
    if (!workspaceId) {
      return { success: false, error: 'workspaceId is required' }
    }

    const servers = await db
      .select({
        id: workflowMcpServer.id,
        name: workflowMcpServer.name,
        description: workflowMcpServer.description,
      })
      .from(workflowMcpServer)
      .where(eq(workflowMcpServer.workspaceId, workspaceId))

    const serverIds = servers.map((server) => server.id)
    const tools =
      serverIds.length > 0
        ? await db
            .select({
              serverId: workflowMcpTool.serverId,
              toolName: workflowMcpTool.toolName,
            })
            .from(workflowMcpTool)
            .where(inArray(workflowMcpTool.serverId, serverIds))
        : []

    const toolNamesByServer: Record<string, string[]> = {}
    for (const tool of tools) {
      if (!toolNamesByServer[tool.serverId]) {
        toolNamesByServer[tool.serverId] = []
      }
      toolNamesByServer[tool.serverId].push(tool.toolName)
    }

    const serversWithToolNames = servers.map((server) => ({
      ...server,
      toolCount: toolNamesByServer[server.id]?.length || 0,
      toolNames: toolNamesByServer[server.id] || [],
    }))

    return { success: true, output: { servers: serversWithToolNames, count: servers.length } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeCreateWorkspaceMcpServer(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)
    const workspaceId = workflowRecord.workspaceId
    if (!workspaceId) {
      return { success: false, error: 'workspaceId is required' }
    }

    const name = params.name?.trim()
    if (!name) {
      return { success: false, error: 'name is required' }
    }

    const serverId = crypto.randomUUID()
    const [server] = await db
      .insert(workflowMcpServer)
      .values({
        id: serverId,
        workspaceId,
        createdBy: context.userId,
        name,
        description: params.description?.trim() || null,
        isPublic: params.isPublic ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    const workflowIds: string[] = params.workflowIds || []
    const addedTools: Array<{ workflowId: string; toolName: string }> = []

    if (workflowIds.length > 0) {
      const workflows = await db
        .select()
        .from(workflow)
        .where(inArray(workflow.id, workflowIds))

      for (const wf of workflows) {
        if (wf.workspaceId !== workspaceId || !wf.isDeployed) {
          continue
        }
        const hasStartBlock = await hasValidStartBlock(wf.id)
        if (!hasStartBlock) {
          continue
        }
    const toolName = sanitizeToolName(wf.name || `workflow_${wf.id}`)
        await db.insert(workflowMcpTool).values({
          id: crypto.randomUUID(),
          serverId,
          workflowId: wf.id,
          toolName,
          toolDescription: wf.description || `Execute ${wf.name} workflow`,
          parameterSchema: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        addedTools.push({ workflowId: wf.id, toolName })
      }
    }

    return { success: true, output: { server, addedTools } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function getWorkflowVariablesForTool(
  workflowId: string
): Promise<Array<{ id: string; name: string; type: string; tag: string }>> {
  const [workflowRecord] = await db
    .select({ variables: workflow.variables })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  const variablesRecord = (workflowRecord?.variables as Record<string, any>) || {}
  return Object.values(variablesRecord)
    .filter((v: any) => v?.name && String(v.name).trim() !== '')
    .map((v: any) => ({
      id: String(v.id || ''),
      name: String(v.name || ''),
      type: String(v.type || 'plain'),
      tag: `variable.${normalizeName(String(v.name || ''))}`,
    }))
}

function getSubflowInsidePaths(
  blockType: 'loop' | 'parallel',
  blockId: string,
  loops: Record<string, any>,
  parallels: Record<string, any>
): string[] {
  const paths = ['index']
  if (blockType === 'loop') {
    const loopType = loops[blockId]?.loopType || 'for'
    if (loopType === 'forEach') {
      paths.push('currentItem', 'items')
    }
  } else {
    const parallelType = parallels[blockId]?.parallelType || 'count'
    if (parallelType === 'collection') {
      paths.push('currentItem', 'items')
    }
  }
  return paths
}

function formatOutputsWithPrefix(paths: string[], blockName: string): string[] {
  const normalizedName = normalizeName(blockName)
  return paths.map((path) => `${normalizedName}.${path}`)
}

/**
 * Notify the copilot backend that a tool has completed.
 */
export async function markToolComplete(
  toolCallId: string,
  toolName: string,
  status: number,
  message?: any,
  data?: any
): Promise<boolean> {
  try {
    const response = await fetch(`${SIM_AGENT_API_URL}/api/tools/mark-complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify({
        id: toolCallId,
        name: toolName,
        status,
        message,
        data,
      }),
    })

    if (!response.ok) {
      logger.warn('Mark-complete call failed', { toolCallId, status: response.status })
      return false
    }

    return true
  } catch (error) {
    logger.error('Mark-complete call failed', {
      toolCallId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Prepare execution context with cached environment values.
 */
export async function prepareExecutionContext(
  userId: string,
  workflowId: string
): Promise<ExecutionContext> {
  let workspaceId: string | undefined
  const workflowResult = await db
    .select({ workspaceId: workflow.workspaceId })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)
  workspaceId = workflowResult[0]?.workspaceId ?? undefined

  const decryptedEnvVars = await getEffectiveDecryptedEnv(userId, workspaceId)

  return {
    userId,
    workflowId,
    workspaceId,
    decryptedEnvVars,
  }
}

