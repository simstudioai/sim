import { createLogger } from '@sim/logger'
import { executeCopilotCustomToolUseCase } from '@/lib/copilot/application/execute-custom-tool-use-case'
import { executeCopilotFileUseCase } from '@/lib/copilot/application/execute-file-use-case'
import { executeCopilotMcpServerUseCase } from '@/lib/copilot/application/execute-mcp-server-use-case'
import {
  executeCopilotWorkflowUseCase,
  messageForCopilotWorkflowError,
} from '@/lib/copilot/application/execute-workflow-use-case'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { formatNormalizedWorkflowForCopilot } from '@/lib/copilot/tools/shared/workflow-utils'
import { listAvailableCustomToolsUseCase } from '@/lib/custom-tools/application/use-cases'
import { discoverMcpToolsUseCase } from '@/lib/mcp/application/use-cases'
import {
  readCopilotWorkflowBlockOutputs,
  readCopilotWorkflowRunOptions,
  readCopilotWorkflowUpstreamReferences,
} from '@/lib/workflows/application/read-workflow-copilot-metadata'
import { readWorkflowDefinition } from '@/lib/workflows/application/read-workflow-definition'
import { listAllWorkspaceFiles } from '@/lib/workspace-files/application/list-workspace-files'
import type { Loop, Parallel } from '@/stores/workflows/workflow/types'
import type {
  GetBlockOutputsParams,
  GetBlockUpstreamReferencesParams,
  GetDeployedWorkflowStateParams,
  GetWorkflowDataParams,
  GetWorkflowRunOptionsParams,
} from '../param-types'

const logger = createLogger('WorkflowQueries')

export async function executeGetWorkflowRunOptions(
  params: GetWorkflowRunOptionsParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }

    const { options } = await executeCopilotWorkflowUseCase(
      context,
      readCopilotWorkflowRunOptions,
      { workflowId, assertedWorkspaceId: context.workspaceId }
    )

    if (options.length === 0) {
      return {
        success: true,
        output: {
          workflowId,
          default: null,
          triggers: [],
          message:
            'No runnable trigger blocks found. Add a Start/API/Input/Chat trigger or an external (webhook/integration) trigger before running.',
        },
      }
    }

    const guidanceFor = (kind: string): string => {
      switch (kind) {
        case 'fields':
          return 'Build workflow_input matching inputSchema. Copy mockPayload only if you have no better values.'
        case 'event_payload':
          return 'Construct an event payload matching inputSchema, or run with useMockPayload: true if you cannot build one.'
        case 'chat':
          return 'Provide workflow_input shaped like { "input": "<message>" }.'
        default:
          return 'No input required.'
      }
    }

    const triggers = options.map((option) => {
      const callExample =
        option.inputKind === 'none'
          ? { triggerBlockId: option.triggerBlockId }
          : { triggerBlockId: option.triggerBlockId, workflow_input: option.mockPayload }
      return { ...option, guidance: guidanceFor(option.inputKind), callExample }
    })

    const defaultOption = options.find((option) => option.isDefault)

    return {
      success: true,
      output: {
        workflowId,
        default: defaultOption
          ? {
              triggerBlockId: defaultOption.triggerBlockId,
              reason: `Highest-priority trigger (${defaultOption.blockName})`,
            }
          : null,
        triggers,
      },
    }
  } catch (error) {
    return { success: false, error: messageForCopilotWorkflowError(error) }
  }
}

export async function executeGetWorkflowData(
  params: GetWorkflowDataParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    const dataType = params.data_type || params.dataType || ''
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    if (!dataType) {
      return { success: false, error: 'data_type is required' }
    }

    if (dataType === 'global_variables') {
      const { workflow: workflowRecord } = await executeCopilotWorkflowUseCase(
        context,
        readWorkflowDefinition,
        { workflowId, assertedWorkspaceId: context.workspaceId, state: 'draft' }
      )
      const variablesRecord = (workflowRecord.variables as Record<string, unknown>) || {}
      const variables = Object.values(variablesRecord).map((v) => {
        const variable = v as Record<string, unknown> | null
        return {
          id: String(variable?.id || ''),
          name: String(variable?.name || ''),
          value: variable?.value,
        }
      })
      return { success: true, output: { variables } }
    }

    const workspaceId = context.workspaceId
    if (dataType === 'custom_tools') {
      if (!workspaceId) {
        return { success: false, error: 'workspaceId is required' }
      }
      const { tools: toolsRows } = await executeCopilotCustomToolUseCase(
        context,
        listAvailableCustomToolsUseCase,
        {
          workspaceId,
        }
      )

      const customToolsData = toolsRows.map((tool) => {
        const schema = tool.schema as Record<string, unknown> | null
        const fn = (schema?.function ?? {}) as Record<string, unknown>
        return {
          id: String(tool.id || ''),
          title: String(tool.title || ''),
          functionName: String(fn.name || ''),
          description: String(fn.description || ''),
          parameters: fn.parameters,
        }
      })

      return { success: true, output: { customTools: customToolsData } }
    }

    if (dataType === 'mcp_tools') {
      if (!workspaceId) {
        return { success: false, error: 'workspaceId is required' }
      }
      const { tools } = await executeCopilotMcpServerUseCase(context, discoverMcpToolsUseCase, {
        workspaceId,
        refresh: false,
      })
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
      const { files } = await executeCopilotFileUseCase(context, listAllWorkspaceFiles, {
        workspaceId,
        scope: 'active',
      })
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
    return { success: false, error: messageForCopilotWorkflowError(error) }
  }
}

export async function executeGetBlockOutputs(
  params: GetBlockOutputsParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const payload = await executeCopilotWorkflowUseCase(context, readCopilotWorkflowBlockOutputs, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      blockIds: params.blockIds,
    })
    return { success: true, output: payload }
  } catch (error) {
    return { success: false, error: messageForCopilotWorkflowError(error) }
  }
}

export async function executeGetBlockUpstreamReferences(
  params: GetBlockUpstreamReferencesParams,
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
    const payload = await executeCopilotWorkflowUseCase(
      context,
      readCopilotWorkflowUpstreamReferences,
      { workflowId, assertedWorkspaceId: context.workspaceId, blockIds: params.blockIds }
    )
    return { success: true, output: payload }
  } catch (error) {
    return { success: false, error: messageForCopilotWorkflowError(error) }
  }
}

export async function executeGetDeployedWorkflowState(
  params: GetDeployedWorkflowStateParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }

    const { workflow: workflowRecord, state: deployedState } = await executeCopilotWorkflowUseCase(
      context,
      readWorkflowDefinition,
      { workflowId, assertedWorkspaceId: context.workspaceId, state: 'deployed' }
    )
    if (deployedState) {
      const formatted = formatNormalizedWorkflowForCopilot({
        blocks: deployedState.blocks,
        edges: deployedState.edges,
        loops: deployedState.loops as Record<string, Loop>,
        parallels: deployedState.parallels as Record<string, Parallel>,
      })

      return {
        success: true,
        output: {
          workflowId,
          workflowName: workflowRecord.name || '',
          isDeployed: true,
          deploymentVersionId:
            'deploymentVersionId' in deployedState ? deployedState.deploymentVersionId : undefined,
          deployedState: formatted,
        },
      }
    }
    return {
      success: true,
      output: {
        workflowId,
        workflowName: workflowRecord.name || '',
        isDeployed: false,
        message: 'Workflow has not been deployed yet.',
      },
    }
  } catch (error) {
    return { success: false, error: messageForCopilotWorkflowError(error) }
  }
}
