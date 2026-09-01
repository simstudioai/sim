import {
  CancelWorkflowRun,
  ConnectSlackBot,
  Cp as CpTool,
  CreateWorkflow,
  CreateWorkspaceMcpServer,
  DeleteWorkspaceMcpServer,
  DeployAsApi,
  DeployAsChat,
  DeployAsMcp,
  DiffWorkflows,
  GenerateApiKey,
  GetBlockOutputs,
  GetBlockUpstreamReferences,
  GetDeployedWorkflowState,
  GetDeploymentStatus,
  GetWorkflowData,
  GetWorkflowRunOptions,
  Glob as GlobTool,
  Grep as GrepTool,
  ListDeploymentVersions,
  ListIntegrationTools,
  ListWorkspaceMcpServers,
  LoadDeployment,
  ManageCredential,
  ManageCustomTool,
  ManageMcpConnection,
  ManageSandbox,
  ManageSkill,
  Mkdir as MkdirTool,
  Mv as MvTool,
  OauthGetAuthLink,
  OauthRequestAccess,
  OpenResource,
  PromoteToLive,
  PublishCustomBlock,
  Read as ReadTool,
  Redeploy,
  RestoreResource,
  Rm as RmTool,
  RunBlock,
  RunCode,
  RunFromBlock,
  RunFunction,
  RunWorkflow,
  RunWorkflowUntilBlock,
  SaveUpload,
  SetBlockEnabled,
  SetGlobalWorkflowVariables,
  UpdateDeploymentVersion,
  UpdateWorkspaceMcpServer,
} from '@/lib/copilot/generated/tool-catalog-v1'
import { createServerToolHandler } from '@/lib/copilot/tools/registry/server-tool-adapter'
import { getRegisteredServerToolNames } from '@/lib/copilot/tools/server/router'
import { executeDeployCustomBlock } from '../tools/handlers/deployment/custom-block'
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
  executeDiffWorkflows,
  executeGetDeploymentLog,
  executeListWorkspaceMcpServers,
  executeLoadDeployment,
  executePromoteToLive,
  executeUpdateDeploymentVersion,
  executeUpdateWorkspaceMcpServer,
} from '../tools/handlers/deployment/manage'
import { executeFunctionExecute } from '../tools/handlers/function-execute'
import { executeListIntegrationTools } from '../tools/handlers/integration-tools'
import { executeConnectSlackBot } from '../tools/handlers/management/connect-slack-bot'
import { executeManageCredential } from '../tools/handlers/management/manage-credential'
import { executeManageCustomTool } from '../tools/handlers/management/manage-custom-tool'
import { executeManageMcpTool } from '../tools/handlers/management/manage-mcp-tool'
import { executeManageSandbox } from '../tools/handlers/management/manage-sandbox'
import { executeManageSkill } from '../tools/handlers/management/manage-skill'
import { executeMaterializeFile } from '../tools/handlers/materialize-file'
import { executeOAuthGetAuthLink, executeOAuthRequestAccess } from '../tools/handlers/oauth'
import { executeOpenResource } from '../tools/handlers/resources'
import { executeRestoreResource } from '../tools/handlers/restore-resource'
import { executeRunCode } from '../tools/handlers/run-code'
import { executeVfsGlob, executeVfsGrep, executeVfsRead } from '../tools/handlers/vfs'
import {
  executeVfsCp,
  executeVfsMkdir,
  executeVfsMv,
  executeVfsRm,
} from '../tools/handlers/vfs-mutate'
import {
  executeCancelWorkflowRun,
  executeCreateWorkflow,
  executeGenerateApiKey,
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
  executeGetWorkflowRunOptions,
} from '../tools/handlers/workflow/queries'
import type { ToolHandler } from './types'

// Bridge: handler implementations accept specific param types (e.g. CreateWorkflowParams)
// while ToolHandler accepts Record<string, unknown>. The params are cast internally by
// each implementation. ExecutionContext extends ToolExecutionContext so context is compatible.
function h(fn: (params: any, context: any) => Promise<any>): ToolHandler {
  return fn as ToolHandler
}

export function buildHandlerMap(): Record<string, ToolHandler> {
  return {
    [GetWorkflowData.id]: h(executeGetWorkflowData),
    [GetWorkflowRunOptions.id]: h(executeGetWorkflowRunOptions),
    [GetBlockOutputs.id]: h(executeGetBlockOutputs),
    [GetBlockUpstreamReferences.id]: h(executeGetBlockUpstreamReferences),
    [GetDeployedWorkflowState.id]: h(executeGetDeployedWorkflowState),

    [CreateWorkflow.id]: h(executeCreateWorkflow),
    // rename_workflow / move_workflow were removed from the mothership catalog
    // in favor of mv; the executors stay registered under literal names so
    // in-flight checkpoints still resume. Delete after the mv release soaks.
    rename_workflow: h(executeRenameWorkflow),
    move_workflow: h(executeMoveWorkflow),
    [RunWorkflow.id]: h(executeRunWorkflow),
    [CancelWorkflowRun.id]: h(executeCancelWorkflowRun),
    [RunWorkflowUntilBlock.id]: h(executeRunWorkflowUntilBlock),
    [RunFromBlock.id]: h(executeRunFromBlock),
    [RunBlock.id]: h(executeRunBlock),
    [SetBlockEnabled.id]: h(executeSetBlockEnabled),
    [GenerateApiKey.id]: h(executeGenerateApiKey),
    [SetGlobalWorkflowVariables.id]: h(executeSetGlobalWorkflowVariables),

    [DeployAsApi.id]: h(executeDeployApi),
    [DeployAsChat.id]: h(executeDeployChat),
    [DeployAsMcp.id]: h(executeDeployMcp),
    [PublishCustomBlock.id]: h(executeDeployCustomBlock),
    [Redeploy.id]: h(executeRedeploy),
    [GetDeploymentStatus.id]: h(executeCheckDeploymentStatus),
    [ListWorkspaceMcpServers.id]: h(executeListWorkspaceMcpServers),
    [CreateWorkspaceMcpServer.id]: h(executeCreateWorkspaceMcpServer),
    [UpdateWorkspaceMcpServer.id]: h(executeUpdateWorkspaceMcpServer),
    [DeleteWorkspaceMcpServer.id]: h(executeDeleteWorkspaceMcpServer),
    [ListDeploymentVersions.id]: h(executeGetDeploymentLog),
    [DiffWorkflows.id]: h(executeDiffWorkflows),
    [LoadDeployment.id]: h(executeLoadDeployment),
    [PromoteToLive.id]: h(executePromoteToLive),
    [UpdateDeploymentVersion.id]: h(executeUpdateDeploymentVersion),

    [GrepTool.id]: h(executeVfsGrep),
    [GlobTool.id]: h(executeVfsGlob),
    [ReadTool.id]: h(executeVfsRead),
    [MvTool.id]: h(executeVfsMv),
    [CpTool.id]: h(executeVfsCp),
    [MkdirTool.id]: h(executeVfsMkdir),
    [RmTool.id]: h(executeVfsRm),

    [ManageCustomTool.id]: h(executeManageCustomTool),
    [ManageMcpConnection.id]: h(executeManageMcpTool),
    [ManageSandbox.id]: h(executeManageSandbox),
    [ManageSkill.id]: h(executeManageSkill),
    [ManageCredential.id]: h(executeManageCredential),
    [ConnectSlackBot.id]: h(executeConnectSlackBot),
    [OauthGetAuthLink.id]: h(executeOAuthGetAuthLink),
    // Rolling-deploy compatibility for calls/checkpoints created before OAuth
    // moved into terminal credential cards. New agents no longer receive this
    // tool, but old calls must remain resumable until both services have soaked.
    [OauthRequestAccess.id]: h(executeOAuthRequestAccess),
    [OpenResource.id]: h(executeOpenResource),
    [RestoreResource.id]: h(executeRestoreResource),
    [ListIntegrationTools.id]: h(executeListIntegrationTools),
    [SaveUpload.id]: h(executeMaterializeFile),
    [RunFunction.id]: h(executeFunctionExecute),
    [RunCode.id]: h(executeRunCode),

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
