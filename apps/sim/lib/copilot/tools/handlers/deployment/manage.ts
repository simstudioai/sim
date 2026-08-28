import { messageForCopilotApplicationError } from '@/lib/copilot/application/error'
import { executeCopilotMcpServerUseCase } from '@/lib/copilot/application/execute-mcp-server-use-case'
import {
  executeCopilotWorkflowUseCase,
  messageForCopilotWorkflowError,
} from '@/lib/copilot/application/execute-workflow-use-case'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { requireCopilotWorkspace } from '@/lib/copilot/tools/server/workspace-scope'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  createWorkflowMcpDeploymentServer,
  deleteWorkflowMcpDeploymentServer,
  listWorkflowMcpDeployments,
  updateWorkflowMcpDeploymentServer,
} from '@/lib/mcp/application/workflow-deployments'
import {
  activateWorkflowVersion,
  revertWorkflowVersion,
  updateWorkflowVersion,
} from '@/lib/workflows/application/deployments'
import { listWorkflowVersions } from '@/lib/workflows/application/list-workflow-versions'
import { readWorkflowDeploymentOverview } from '@/lib/workflows/application/read-workflow-deployment-overview'
import { readWorkflowStateReferences } from '@/lib/workflows/application/read-workflow-state-references'
import { generateWorkflowDiffSummary } from '@/lib/workflows/comparison'
import type {
  CheckDeploymentStatusParams,
  CreateWorkspaceMcpServerParams,
  DeleteWorkspaceMcpServerParams,
  DiffWorkflowsParams,
  GetDeploymentLogParams,
  ListWorkspaceMcpServersParams,
  LoadDeploymentParams,
  PromoteToLiveParams,
  UpdateDeploymentVersionParams,
  UpdateWorkspaceMcpServerParams,
} from '../param-types'
import { getCopilotDeploymentIdempotencyKey, getHistoricalDeploymentAttemptError } from './context'
import { parseWorkflowRef } from './state-refs'

export async function executeCheckDeploymentStatus(
  params: CheckDeploymentStatusParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const deployment = await executeCopilotWorkflowUseCase(
      context,
      readWorkflowDeploymentOverview,
      {
        workflowId,
        assertedWorkspaceId: context.workspaceId,
      }
    )
    const workflowRecord = deployment.workflow

    /**
     * Deployed means an active version snapshot exists; the legacy
     * `workflow.isDeployed` flag is not consulted so this can never
     * contradict the attached `activeDeployment` summary.
     */
    const isApiDeployed = deployment.isDeployed
    const currentDeploymentAttempt = deployment.latestDeploymentAttempt?.isCurrent
      ? deployment.latestDeploymentAttempt
      : null
    const apiDetails = {
      isDeployed: isApiDeployed,
      deployedAt: workflowRecord.deployedAt || null,
      endpoint: isApiDeployed ? `/api/workflows/${workflowId}/execute` : null,
      apiKey: workflowRecord.workspaceId ? 'Workspace API keys' : 'Personal API keys',
      needsRedeployment: deployment.needsRedeployment,
      activeDeployment: deployment.activeDeployment,
      latestDeploymentAttempt: deployment.latestDeploymentAttempt,
      currentDeploymentAttempt,
      warnings: deployment.warnings ?? [],
    }

    const chatDeploy = deployment.chatDeployment
    const isChatDeployed = chatDeploy !== null
    const chatCustomizations =
      (chatDeploy?.customizations as
        | { welcomeMessage?: string; primaryColor?: string }
        | undefined) || {}
    const chatDetails = {
      isDeployed: isChatDeployed,
      chatId: chatDeploy?.id || null,
      identifier: chatDeploy?.identifier || null,
      chatUrl: isChatDeployed ? `/chat/${chatDeploy?.identifier}` : null,
      title: chatDeploy?.title || null,
      description: chatDeploy?.description || null,
      authType: chatDeploy?.authType || null,
      allowedEmails: chatDeploy?.allowedEmails || null,
      outputConfigs: chatDeploy?.outputConfigs || null,
      includeThinking: chatDeploy?.includeThinking ?? false,
      includeToolCalls: chatDeploy?.includeToolCalls ?? false,
      welcomeMessage: chatCustomizations.welcomeMessage || null,
      primaryColor: chatCustomizations.primaryColor || null,
      hasPassword: Boolean(chatDeploy?.password),
    }

    const mcpDetails: {
      isDeployed: boolean
      servers: Array<{
        serverId: string
        serverName: string
        toolName: string
        toolDescription: string | null
        parameterSchema: unknown
        toolId: string
      }>
      truncated: boolean
    } = {
      isDeployed: false,
      servers: [],
      truncated: deployment.mcpToolsTruncated,
    }
    if (deployment.mcpTools.length > 0) {
      mcpDetails.isDeployed = true
      mcpDetails.servers = deployment.mcpTools
    }

    const isDeployed = apiDetails.isDeployed || chatDetails.isDeployed || mcpDetails.isDeployed
    return {
      success: true,
      output: { isDeployed, api: apiDetails, chat: chatDetails, mcp: mcpDetails },
    }
  } catch (error) {
    return {
      success: false,
      error: messageForCopilotWorkflowError(error, 'Failed to check deployment status'),
    }
  }
}

export async function executeListWorkspaceMcpServers(
  params: ListWorkspaceMcpServersParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workspaceId = requireCopilotWorkspace(context, params.workspaceId)
    const result = await executeCopilotMcpServerUseCase(context, listWorkflowMcpDeployments, {
      workspaceId,
    })
    return {
      success: true,
      output: {
        servers: result.servers,
        count: result.servers.length,
        truncated: result.truncated,
      },
    }
  } catch (error) {
    return { success: false, error: messageForCopilotApplicationError(error) }
  }
}

export async function executeCreateWorkspaceMcpServer(
  params: CreateWorkspaceMcpServerParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workspaceId = requireCopilotWorkspace(context, params.workspaceId)

    const name = params.name?.trim()
    if (!name) {
      return { success: false, error: 'name is required' }
    }

    const result = await executeCopilotMcpServerUseCase(
      context,
      createWorkflowMcpDeploymentServer,
      {
        workspaceId,
        name,
        description: params.description,
        isPublic: params.isPublic,
        workflowIds: params.workflowIds,
      }
    )

    return { success: true, output: { server: result.server, addedTools: result.addedTools } }
  } catch (error) {
    return { success: false, error: messageForCopilotApplicationError(error) }
  }
}

export async function executeUpdateWorkspaceMcpServer(
  params: UpdateWorkspaceMcpServerParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const serverId = params.serverId
    if (!serverId) {
      return { success: false, error: 'serverId is required' }
    }

    const updates: { name?: string; description?: string | null; isPublic?: boolean } = {}
    if (typeof params.name === 'string') {
      const name = params.name.trim()
      if (!name) return { success: false, error: 'name cannot be empty' }
      updates.name = name
    }
    if (typeof params.description === 'string') {
      updates.description = params.description.trim() || null
    }
    if (typeof params.isPublic === 'boolean') {
      updates.isPublic = params.isPublic
    }

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'At least one of name, description, or isPublic is required' }
    }

    await executeCopilotMcpServerUseCase(context, updateWorkflowMcpDeploymentServer, {
      serverId,
      ...updates,
    })

    return { success: true, output: { serverId, ...updates } }
  } catch (error) {
    return { success: false, error: messageForCopilotApplicationError(error) }
  }
}

export async function executeDeleteWorkspaceMcpServer(
  params: DeleteWorkspaceMcpServerParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const serverId = params.serverId
    if (!serverId) {
      return { success: false, error: 'serverId is required' }
    }

    const result = await executeCopilotMcpServerUseCase(
      context,
      deleteWorkflowMcpDeploymentServer,
      {
        serverId,
      }
    )

    return { success: true, output: { serverId, name: result.server.name, deleted: true } }
  } catch (error) {
    return { success: false, error: messageForCopilotApplicationError(error) }
  }
}

export async function executeGetDeploymentLog(
  params: GetDeploymentLogParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const { versions: rows } = await executeCopilotWorkflowUseCase(context, listWorkflowVersions, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
    })

    const versions = rows.map((r) => ({
      id: r.id,
      version: r.version,
      name: r.name ?? undefined,
      description: r.description ?? undefined,
      isActive: r.isActive,
      latestOperationStatus: r.latestOperationStatus ?? undefined,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy ?? undefined,
    }))

    return { success: true, output: { workflowId, count: versions.length, versions } }
  } catch (error) {
    return {
      success: false,
      error: messageForCopilotWorkflowError(error, 'Failed to list deployment versions'),
    }
  }
}

// Cap individual sub-block before/after values so a large diff can't blow the
// tool-result budget. Oversized values are replaced with an elision marker.
const MAX_DIFF_VALUE_BYTES = 2000

function guardDiffValue(value: unknown): unknown {
  try {
    const json = JSON.stringify(value)
    if (json && json.length > MAX_DIFF_VALUE_BYTES) {
      return { elided: true, bytes: json.length }
    }
  } catch {
    return { elided: true, reason: 'unserializable' }
  }
  return value
}

export async function executeDiffWorkflows(
  params: DiffWorkflowsParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    if (params.ref1 === undefined || params.ref2 === undefined) {
      return { success: false, error: 'ref1 and ref2 are required' }
    }

    const { references } = await executeCopilotWorkflowUseCase(
      context,
      readWorkflowStateReferences,
      {
        workflowId,
        assertedWorkspaceId: context.workspaceId,
        references: [parseWorkflowRef(params.ref1), parseWorkflowRef(params.ref2)],
      }
    )
    const [side1, side2] = references

    // ref1 = base/previous, ref2 = target/current: added = present in ref2 only.
    const summary = generateWorkflowDiffSummary(side2.state, side1.state)
    const diff = {
      ...summary,
      modifiedBlocks: summary.modifiedBlocks.map((block) => ({
        ...block,
        changes: block.changes.map((change) => ({
          field: change.field,
          oldValue: guardDiffValue(change.oldValue),
          newValue: guardDiffValue(change.newValue),
        })),
      })),
    }

    return {
      success: true,
      output: {
        workflowId,
        ref1: { ref: side1.ref, version: side1.version, isActive: side1.isActive },
        ref2: { ref: side2.ref, version: side2.version, isActive: side2.isActive },
        diff,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: messageForCopilotWorkflowError(error, 'Failed to compare workflow versions'),
    }
  }
}

function resolveLoadVersion(
  raw: number | string
): { ok: true; version: number | 'active' } | { ok: false; error: string } {
  if (typeof raw === 'number' && Number.isFinite(raw)) return { ok: true, version: raw }
  if (typeof raw === 'string') {
    const t = raw.trim().toLowerCase()
    if (t === 'live' || t === 'active') return { ok: true, version: 'active' }
    if (t === 'draft' || t === 'current') {
      return {
        ok: false,
        error: 'Cannot load "draft" — load_deployment restores a deployed version into the draft',
      }
    }
    if (/^\d+$/.test(t)) return { ok: true, version: Number.parseInt(t, 10) }
  }
  return {
    ok: false,
    error: `Invalid version "${String(raw)}": expected a version number or "live"`,
  }
}

export async function executeLoadDeployment(
  params: LoadDeploymentParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    if (params.version === undefined || params.version === null) {
      return { success: false, error: 'version is required' }
    }
    const target = resolveLoadVersion(params.version)
    if (!target.ok) {
      return { success: false, error: target.error }
    }

    const result = await executeCopilotWorkflowUseCase(context, revertWorkflowVersion, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      version: target.version,
      executionActorUserId: context.userId,
    })

    const label = target.version === 'active' ? 'the live deployment' : `version ${target.version}`
    return {
      success: true,
      output: {
        workflowId,
        message: `Loaded ${label} into the workflow draft`,
        lastSaved: result.lastSaved,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: messageForCopilotWorkflowError(error, 'Failed to load deployment'),
    }
  }
}

function normalizePromoteVersion(raw: number | string): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number.parseInt(raw.trim(), 10)
  return null
}

export async function executePromoteToLive(
  params: PromoteToLiveParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    if (params.version === undefined || params.version === null) {
      return { success: false, error: 'version is required' }
    }
    const version = normalizePromoteVersion(params.version)
    if (version === null) {
      return {
        success: false,
        error:
          'version must be a deployment version number (use load_deployment to change the draft; "live" is already live)',
      }
    }

    const result = await executeCopilotWorkflowUseCase(context, activateWorkflowVersion, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      version,
      transition: 'activate',
      requestId: generateRequestId(),
      idempotencyKey: getCopilotDeploymentIdempotencyKey(context, 'promote_to_live'),
    })

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to promote version' }
    }
    const historicalAttemptError = getHistoricalDeploymentAttemptError(
      result.latestDeploymentAttempt,
      'promotion'
    )
    if (historicalAttemptError) return { success: false, error: historicalAttemptError }

    const isActive = result.activeDeployment?.version === version
    if (!isActive) {
      const detail =
        result.warnings?.[0] ??
        `Promotion of version ${version} is ${result.latestDeploymentAttempt?.status ?? 'unknown'}, not active.`
      return {
        success: false,
        error: `${detail} Do not submit a new promotion; check the existing attempt's status.`,
      }
    }
    return {
      success: true,
      output: {
        workflowId,
        version,
        message: `Promoted version ${version} to live`,
        deployedAt: result.deployedAt ? new Date(result.deployedAt).toISOString() : undefined,
        lifecycleStatus: result.latestDeploymentAttempt?.status ?? null,
        readiness: result.latestDeploymentAttempt?.readiness ?? null,
        error: result.latestDeploymentAttempt?.error ?? null,
        warnings: result.warnings,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: messageForCopilotWorkflowError(error, 'Failed to promote deployment version'),
    }
  }
}

export async function executeUpdateDeploymentVersion(
  params: UpdateDeploymentVersionParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    if (params.version === undefined || params.version === null) {
      return { success: false, error: 'version is required' }
    }
    const version = normalizePromoteVersion(params.version)
    if (version === null) {
      return {
        success: false,
        error:
          'version must be a deployment version number (use list_deployment_versions to find it)',
      }
    }

    const name = typeof params.name === 'string' ? params.name.trim() : undefined
    const description =
      typeof params.description === 'string' ? params.description.trim() : undefined
    if (name === undefined && description === undefined) {
      return { success: false, error: 'Provide a name and/or description to update' }
    }

    const updated = await executeCopilotWorkflowUseCase(context, updateWorkflowVersion, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      version,
      ...(name !== undefined ? { name: name || null } : {}),
      ...(description !== undefined ? { description: description || null } : {}),
    })
    return {
      success: true,
      output: { workflowId, version, name: updated.name, description: updated.description },
    }
  } catch (error) {
    return {
      success: false,
      error: messageForCopilotWorkflowError(error, 'Failed to update deployment version'),
    }
  }
}
