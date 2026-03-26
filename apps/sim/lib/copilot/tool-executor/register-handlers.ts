import { createLogger } from '@sim/logger'
import {
  CheckDeploymentStatus,
  CompleteJob,
  CreateFolder,
  CreateJob,
  CreateWorkflow,
  CreateWorkspaceMcpServer,
  DeleteFolder,
  DeleteWorkflow,
  DeleteWorkspaceMcpServer,
  DeployApi,
  DeployChat,
  DeployMcp,
  GenerateApiKey,
  GetBlockOutputs,
  GetBlockUpstreamReferences,
  GetDeployedWorkflowState,
  GetDeploymentVersion,
  GetPlatformActions,
  GetWorkflowData,
  Glob as GlobTool,
  Grep as GrepTool,
  ListFolders,
  ListUserWorkspaces,
  ListWorkspaceMcpServers,
  ManageCredential,
  ManageCustomTool,
  ManageJob,
  ManageMcpTool,
  ManageSkill,
  MaterializeFile,
  OauthGetAuthLink,
  OauthRequestAccess,
  OpenResource,
  Read as ReadTool,
  Redeploy,
  RevertToVersion,
  RunBlock,
  RunFromBlock,
  RunWorkflow,
  RunWorkflowUntilBlock,
  SetGlobalWorkflowVariables,
  UpdateJobHistory,
  UpdateWorkspaceMcpServer,
} from '@/lib/copilot/generated/tool-catalog-v1'
import {
  executeDeployApi,
  executeDeployChat,
  executeDeployMcp,
  executeRedeploy,
} from '@/lib/copilot/orchestrator/tool-executor/deployment-tools/deploy'
import {
  executeCheckDeploymentStatus,
  executeCreateWorkspaceMcpServer,
  executeDeleteWorkspaceMcpServer,
  executeGetDeploymentVersion,
  executeListWorkspaceMcpServers,
  executeRevertToVersion,
  executeUpdateWorkspaceMcpServer,
} from '@/lib/copilot/orchestrator/tool-executor/deployment-tools/manage'
import { executeGetPlatformActions } from '@/lib/copilot/orchestrator/tool-executor/get-platform-actions'
import {
  executeCompleteJob,
  executeCreateJob,
  executeManageJob,
  executeUpdateJobHistory,
} from '@/lib/copilot/orchestrator/tool-executor/job-tools'
import { executeManageCredential } from '@/lib/copilot/orchestrator/tool-executor/manage-credential'
import { executeManageCustomTool } from '@/lib/copilot/orchestrator/tool-executor/manage-custom-tool'
import { executeManageMcpTool } from '@/lib/copilot/orchestrator/tool-executor/manage-mcp-tool'
import { executeManageSkill } from '@/lib/copilot/orchestrator/tool-executor/manage-skill'
import { executeMaterializeFile } from '@/lib/copilot/orchestrator/tool-executor/materialize-file'
import {
  executeOAuthGetAuthLink,
  executeOAuthRequestAccess,
} from '@/lib/copilot/orchestrator/tool-executor/oauth-tools'
import { executeOpenResource } from '@/lib/copilot/orchestrator/tool-executor/open-resource'
import {
  executeVfsGlob,
  executeVfsGrep,
  executeVfsRead,
} from '@/lib/copilot/orchestrator/tool-executor/vfs-tools'
import {
  executeCreateFolder,
  executeCreateWorkflow,
  executeDeleteFolder,
  executeDeleteWorkflow,
  executeGenerateApiKey,
  executeRunBlock,
  executeRunFromBlock,
  executeRunWorkflow,
  executeRunWorkflowUntilBlock,
  executeSetGlobalWorkflowVariables,
} from '@/lib/copilot/orchestrator/tool-executor/workflow-tools/mutations'
import {
  executeGetBlockOutputs,
  executeGetBlockUpstreamReferences,
  executeGetDeployedWorkflowState,
  executeGetWorkflowData,
  executeListFolders,
  executeListUserWorkspaces,
} from '@/lib/copilot/orchestrator/tool-executor/workflow-tools/queries'
import { getRegisteredServerToolNames, routeExecution } from '@/lib/copilot/tools/server/router'
import { registerHandlers } from './executor'
import type { ToolExecutionResult, ToolHandler } from './types'

const logger = createLogger('ToolHandlerRegistration')

let registered = false

export function ensureHandlersRegistered(): void {
  if (registered) return
  registered = true
  registerHandlers(buildHandlerMap())
  logger.info('Tool handlers registered')
}

// Bridge: handler implementations accept specific param types (e.g. CreateWorkflowParams)
// while ToolHandler accepts Record<string, unknown>. The params are cast internally by
// each implementation. ExecutionContext extends ToolExecutionContext so context is compatible.
function h(fn: (params: any, context: any) => Promise<any>): ToolHandler {
  return fn as ToolHandler
}

function buildHandlerMap(): Record<string, ToolHandler> {
  return {
    [ListUserWorkspaces.id]: h((_p, c) => executeListUserWorkspaces(c)),
    [ListFolders.id]: h(executeListFolders),
    [GetWorkflowData.id]: h(executeGetWorkflowData),
    [GetBlockOutputs.id]: h(executeGetBlockOutputs),
    [GetBlockUpstreamReferences.id]: h(executeGetBlockUpstreamReferences),
    [GetDeployedWorkflowState.id]: h(executeGetDeployedWorkflowState),

    [CreateWorkflow.id]: h(executeCreateWorkflow),
    [CreateFolder.id]: h(executeCreateFolder),
    [DeleteWorkflow.id]: h(executeDeleteWorkflow),
    [DeleteFolder.id]: h(executeDeleteFolder),
    [RunWorkflow.id]: h(executeRunWorkflow),
    [RunWorkflowUntilBlock.id]: h(executeRunWorkflowUntilBlock),
    [RunFromBlock.id]: h(executeRunFromBlock),
    [RunBlock.id]: h(executeRunBlock),
    [GenerateApiKey.id]: h(executeGenerateApiKey),
    [SetGlobalWorkflowVariables.id]: h(executeSetGlobalWorkflowVariables),

    [DeployApi.id]: h(executeDeployApi),
    [DeployChat.id]: h(executeDeployChat),
    [DeployMcp.id]: h(executeDeployMcp),
    [Redeploy.id]: h(executeRedeploy),
    [CheckDeploymentStatus.id]: h(executeCheckDeploymentStatus),
    [ListWorkspaceMcpServers.id]: h(executeListWorkspaceMcpServers),
    [CreateWorkspaceMcpServer.id]: h(executeCreateWorkspaceMcpServer),
    [UpdateWorkspaceMcpServer.id]: h(executeUpdateWorkspaceMcpServer),
    [DeleteWorkspaceMcpServer.id]: h(executeDeleteWorkspaceMcpServer),
    [GetDeploymentVersion.id]: h(executeGetDeploymentVersion),
    [RevertToVersion.id]: h(executeRevertToVersion),

    [CreateJob.id]: h(executeCreateJob),
    [ManageJob.id]: h(executeManageJob),
    [CompleteJob.id]: h(executeCompleteJob),
    [UpdateJobHistory.id]: h(executeUpdateJobHistory),

    [GrepTool.id]: h(executeVfsGrep),
    [GlobTool.id]: h(executeVfsGlob),
    [ReadTool.id]: h(executeVfsRead),

    [ManageCustomTool.id]: h(executeManageCustomTool),
    [ManageMcpTool.id]: h(executeManageMcpTool),
    [ManageSkill.id]: h(executeManageSkill),
    [ManageCredential.id]: h(executeManageCredential),
    [OauthGetAuthLink.id]: h(executeOAuthGetAuthLink),
    [OauthRequestAccess.id]: h(executeOAuthRequestAccess),
    [OpenResource.id]: h(executeOpenResource),
    [GetPlatformActions.id]: h(executeGetPlatformActions),
    [MaterializeFile.id]: h(executeMaterializeFile),

    ...buildServerToolHandlers(),
  }
}

function buildServerToolHandlers(): Record<string, ToolHandler> {
  const toolNames = getRegisteredServerToolNames()
  const handlers: Record<string, ToolHandler> = {}
  for (const toolId of toolNames) {
    handlers[toolId] = createServerToolHandler(toolId)
  }
  return handlers
}

function createServerToolHandler(toolId: string): ToolHandler {
  return async (params, context): Promise<ToolExecutionResult> => {
    const enrichedParams = { ...params }
    if (!enrichedParams.workflowId && context.workflowId)
      enrichedParams.workflowId = context.workflowId
    if (!enrichedParams.workspaceId && context.workspaceId)
      enrichedParams.workspaceId = context.workspaceId

    try {
      const result = await routeExecution(toolId, enrichedParams, {
        userId: context.userId,
        workspaceId: context.workspaceId,
        userPermission: context.userPermission ?? undefined,
        chatId: context.chatId,
        abortSignal: context.abortSignal,
      })

      const rec =
        result && typeof result === 'object' && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : null
      if (rec?.success === false) {
        const message =
          (typeof rec.error === 'string' && rec.error) ||
          (typeof rec.message === 'string' && rec.message) ||
          `${toolId} failed`
        return { success: false, error: message, output: result }
      }
      return { success: true, output: result }
    } catch (error) {
      logger.error('Server tool execution failed', {
        toolId,
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Server tool execution failed',
      }
    }
  }
}
