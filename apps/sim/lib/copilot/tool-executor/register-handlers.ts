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
  FunctionExecute,
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
  MoveFolder,
  MoveWorkflow,
  OauthGetAuthLink,
  OauthRequestAccess,
  OpenResource,
  Read as ReadTool,
  Redeploy,
  RenameWorkflow,
  RestoreResource,
  RevertToVersion,
  RunBlock,
  RunFromBlock,
  RunWorkflow,
  RunWorkflowUntilBlock,
  SetBlockEnabled,
  SetGlobalWorkflowVariables,
  UpdateJobHistory,
  UpdateWorkspaceMcpServer,
} from '@/lib/copilot/generated/tool-catalog-v1'
import { createServerToolHandler } from '@/lib/copilot/tools/registry/server-tool-adapter'
import { getRegisteredServerToolNames } from '@/lib/copilot/tools/server/router'
import {
  executeDeployApi,
  executeDeployChat,
  executeDeployMcp,
  executeRedeploy,
} from '../tools/handlers/deployment/deploy'
import {
  executeCheckDeploymentStatus,
  executeCreateWorkspaceMcpServer,
  executeDeleteWorkspaceMcpServer,
  executeGetDeploymentVersion,
  executeListWorkspaceMcpServers,
  executeRevertToVersion,
  executeUpdateWorkspaceMcpServer,
} from '../tools/handlers/deployment/manage'
import { executeFunctionExecute } from '../tools/handlers/function-execute'
import {
  executeCompleteJob,
  executeCreateJob,
  executeManageJob,
  executeUpdateJobHistory,
} from '../tools/handlers/jobs'
import { executeManageCredential } from '../tools/handlers/management/manage-credential'
import { executeManageCustomTool } from '../tools/handlers/management/manage-custom-tool'
import { executeManageMcpTool } from '../tools/handlers/management/manage-mcp-tool'
import { executeManageSkill } from '../tools/handlers/management/manage-skill'
import { executeMaterializeFile } from '../tools/handlers/materialize-file'
import { executeOAuthGetAuthLink, executeOAuthRequestAccess } from '../tools/handlers/oauth'
import { executeGetPlatformActions } from '../tools/handlers/platform'
import { executeOpenResource } from '../tools/handlers/resources'
import { executeRestoreResource } from '../tools/handlers/restore-resource'
import { executeVfsGlob, executeVfsGrep, executeVfsRead } from '../tools/handlers/vfs'
import {
  executeCreateFolder,
  executeCreateWorkflow,
  executeDeleteFolder,
  executeDeleteWorkflow,
  executeGenerateApiKey,
  executeMoveFolder,
  executeMoveWorkflow,
  executeRenameWorkflow,
  executeRunBlock,
  executeRunFromBlock,
  executeRunWorkflow,
  executeRunWorkflowUntilBlock,
  executeSetBlockEnabled,
  executeSetGlobalWorkflowVariables,
} from '../tools/handlers/workflow/mutations'
import {
  executeGetBlockOutputs,
  executeGetBlockUpstreamReferences,
  executeGetDeployedWorkflowState,
  executeGetWorkflowData,
  executeListFolders,
  executeListUserWorkspaces,
} from '../tools/handlers/workflow/queries'
import { registerHandlers } from './executor'
import type { ToolHandler } from './types'

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
    [RenameWorkflow.id]: h(executeRenameWorkflow),
    [MoveWorkflow.id]: h(executeMoveWorkflow),
    [MoveFolder.id]: h(executeMoveFolder),
    [RunWorkflow.id]: h(executeRunWorkflow),
    [RunWorkflowUntilBlock.id]: h(executeRunWorkflowUntilBlock),
    [RunFromBlock.id]: h(executeRunFromBlock),
    [RunBlock.id]: h(executeRunBlock),
    [SetBlockEnabled.id]: h(executeSetBlockEnabled),
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
    [RestoreResource.id]: h(executeRestoreResource),
    [GetPlatformActions.id]: h(executeGetPlatformActions),
    [MaterializeFile.id]: h(executeMaterializeFile),
    [FunctionExecute.id]: h(executeFunctionExecute),

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
