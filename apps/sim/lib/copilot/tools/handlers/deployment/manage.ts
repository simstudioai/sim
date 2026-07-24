import { db } from '@sim/db'
import { chat, workflow, workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { toError } from '@sim/utils/errors'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import {
  performCreateWorkflowMcpServer,
  performDeleteWorkflowMcpServer,
  performUpdateWorkflowMcpServer,
} from '@/lib/mcp/orchestration'
import { generateWorkflowDiffSummary } from '@/lib/workflows/comparison'
import {
  getWorkflowDeploymentSummary,
  performActivateVersion,
  performRevertToVersion,
} from '@/lib/workflows/orchestration'
import {
  listWorkflowVersions,
  updateDeploymentVersionMetadata,
} from '@/lib/workflows/persistence/utils'
import { checkNeedsRedeployment } from '@/app/api/workflows/utils'
import { ensureWorkflowAccess, ensureWorkspaceAccess } from '../access'
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
import { resolveWorkflowStateRef } from './state-refs'

export async function executeCheckDeploymentStatus(
  params: CheckDeploymentStatusParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)
    const workspaceId = workflowRecord.workspaceId

    const [apiDeploy, chatDeploy, deploymentSummary] = await Promise.all([
      db
        .select({ deployedAt: workflow.deployedAt })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1),
      db
        .select({
          id: chat.id,
          identifier: chat.identifier,
          title: chat.title,
          description: chat.description,
          authType: chat.authType,
          allowedEmails: chat.allowedEmails,
          outputConfigs: chat.outputConfigs,
          includeThinking: chat.includeThinking,
          includeToolCalls: chat.includeToolCalls,
          password: chat.password,
          customizations: chat.customizations,
        })
        .from(chat)
        .where(and(eq(chat.workflowId, workflowId), isNull(chat.archivedAt)))
        .limit(1),
      getWorkflowDeploymentSummary(workflowId),
    ])

    /**
     * Deployed means an active version snapshot exists; the legacy
     * `workflow.isDeployed` flag is not consulted so this can never
     * contradict the attached `activeDeployment` summary.
     */
    const isApiDeployed = deploymentSummary.activeDeployment !== null
    const needsRedeployment = isApiDeployed ? await checkNeedsRedeployment(workflowId) : false
    const apiDetails = {
      isDeployed: isApiDeployed,
      deployedAt: apiDeploy[0]?.deployedAt || null,
      endpoint: isApiDeployed ? `/api/workflows/${workflowId}/execute` : null,
      apiKey: workflowRecord.workspaceId ? 'Workspace API keys' : 'Personal API keys',
      needsRedeployment,
      activeDeployment: deploymentSummary.activeDeployment,
      latestDeploymentAttempt: deploymentSummary.latestDeploymentAttempt,
      warnings: deploymentSummary.warnings ?? [],
    }

    const isChatDeployed = !!chatDeploy[0]
    const chatCustomizations =
      (chatDeploy[0]?.customizations as
        | { welcomeMessage?: string; primaryColor?: string }
        | undefined) || {}
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
      includeThinking: chatDeploy[0]?.includeThinking ?? false,
      includeToolCalls: chatDeploy[0]?.includeToolCalls ?? chatDeploy[0]?.includeThinking ?? false,
      welcomeMessage: chatCustomizations.welcomeMessage || null,
      primaryColor: chatCustomizations.primaryColor || null,
      hasPassword: Boolean(chatDeploy[0]?.password),
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
    } = { isDeployed: false, servers: [] }
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
    return { success: false, error: toError(error).message }
  }
}

export async function executeListWorkspaceMcpServers(
  params: ListWorkspaceMcpServersParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    let workspaceId = params.workspaceId || context.workspaceId
    const workflowId = context.workflowId

    if (!workspaceId && workflowId) {
      const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)
      workspaceId = workflowRecord.workspaceId ?? undefined
    }

    if (!workspaceId) {
      return { success: false, error: 'workspaceId is required' }
    }
    await ensureWorkspaceAccess(workspaceId, context.userId, 'read')

    const servers = await db
      .select({
        id: workflowMcpServer.id,
        name: workflowMcpServer.name,
        description: workflowMcpServer.description,
      })
      .from(workflowMcpServer)
      .where(
        and(eq(workflowMcpServer.workspaceId, workspaceId), isNull(workflowMcpServer.deletedAt))
      )

    const serverIds = servers.map((server) => server.id)
    const tools =
      serverIds.length > 0
        ? await db
            .select({
              serverId: workflowMcpTool.serverId,
              toolName: workflowMcpTool.toolName,
            })
            .from(workflowMcpTool)
            .where(
              and(inArray(workflowMcpTool.serverId, serverIds), isNull(workflowMcpTool.archivedAt))
            )
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
    return { success: false, error: toError(error).message }
  }
}

export async function executeCreateWorkspaceMcpServer(
  params: CreateWorkspaceMcpServerParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    let workspaceId = params.workspaceId || context.workspaceId
    const workflowId = context.workflowId

    if (!workspaceId && workflowId) {
      const { workflow: workflowRecord } = await ensureWorkflowAccess(
        workflowId,
        context.userId,
        'write'
      )
      workspaceId = workflowRecord.workspaceId ?? undefined
    }

    if (!workspaceId) {
      return { success: false, error: 'workspaceId is required' }
    }
    await ensureWorkspaceAccess(workspaceId, context.userId, 'admin')

    const name = params.name?.trim()
    if (!name) {
      return { success: false, error: 'name is required' }
    }

    const result = await performCreateWorkflowMcpServer({
      workspaceId,
      userId: context.userId,
      name,
      description: params.description,
      isPublic: params.isPublic,
      workflowIds: params.workflowIds,
    })
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to create MCP server' }
    }

    return { success: true, output: { server: result.server, addedTools: result.addedTools || [] } }
  } catch (error) {
    return { success: false, error: toError(error).message }
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

    const [existing] = await db
      .select({
        id: workflowMcpServer.id,
        workspaceId: workflowMcpServer.workspaceId,
      })
      .from(workflowMcpServer)
      .where(eq(workflowMcpServer.id, serverId))
      .limit(1)

    if (!existing) {
      return { success: false, error: 'MCP server not found' }
    }

    await ensureWorkspaceAccess(existing.workspaceId, context.userId, 'write')

    const result = await performUpdateWorkflowMcpServer({
      serverId,
      workspaceId: existing.workspaceId,
      userId: context.userId,
      ...updates,
    })
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to update MCP server' }
    }

    return { success: true, output: { serverId, ...updates } }
  } catch (error) {
    return { success: false, error: toError(error).message }
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

    const [existing] = await db
      .select({
        id: workflowMcpServer.id,
        name: workflowMcpServer.name,
        workspaceId: workflowMcpServer.workspaceId,
      })
      .from(workflowMcpServer)
      .where(and(eq(workflowMcpServer.id, serverId), isNull(workflowMcpServer.deletedAt)))
      .limit(1)

    if (!existing) {
      return { success: false, error: 'MCP server not found' }
    }

    await ensureWorkspaceAccess(existing.workspaceId, context.userId, 'admin')

    const result = await performDeleteWorkflowMcpServer({
      serverId,
      workspaceId: existing.workspaceId,
      userId: context.userId,
    })
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to delete MCP server' }
    }

    return { success: true, output: { serverId, name: existing.name, deleted: true } }
  } catch (error) {
    return { success: false, error: toError(error).message }
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
    await ensureWorkflowAccess(workflowId, context.userId)

    const { versions: rows } = await listWorkflowVersions(workflowId)

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
    return { success: false, error: toError(error).message }
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

    // resolveWorkflowStateRef enforces read access on the workflow.
    const [side1, side2] = await Promise.all([
      resolveWorkflowStateRef(workflowId, params.ref1, context.userId),
      resolveWorkflowStateRef(workflowId, params.ref2, context.userId),
    ])

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
    return { success: false, error: toError(error).message }
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

    const { workflow: workflowRecord } = await ensureWorkflowAccess(
      workflowId,
      context.userId,
      'admin'
    )
    const result = await performRevertToVersion({
      workflowId,
      version: target.version,
      userId: context.userId,
      workflow: workflowRecord as Record<string, unknown>,
    })

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to load deployment' }
    }

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
    return { success: false, error: toError(error).message }
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

    const { workflow: workflowRecord } = await ensureWorkflowAccess(
      workflowId,
      context.userId,
      'admin'
    )
    const result = await performActivateVersion({
      workflowId,
      version,
      userId: context.userId,
    })

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to promote version' }
    }

    const isActive = result.latestDeploymentAttempt?.status === 'active'
    return {
      success: true,
      output: {
        workflowId,
        version,
        message: isActive
          ? `Promoted version ${version} to live`
          : `Started preparing version ${version} for promotion`,
        deployedAt: result.deployedAt ? new Date(result.deployedAt).toISOString() : undefined,
        lifecycleStatus: result.latestDeploymentAttempt?.status ?? null,
        readiness: result.latestDeploymentAttempt?.readiness ?? null,
        error: result.latestDeploymentAttempt?.error ?? null,
        warnings: result.warnings,
      },
    }
  } catch (error) {
    return { success: false, error: toError(error).message }
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
        error: 'version must be a deployment version number (use get_deployment_log to find it)',
      }
    }

    const name = typeof params.name === 'string' ? params.name.trim() : undefined
    const description =
      typeof params.description === 'string' ? params.description.trim() : undefined
    if (name === undefined && description === undefined) {
      return { success: false, error: 'Provide a name and/or description to update' }
    }

    await ensureWorkflowAccess(workflowId, context.userId, 'write')

    const updated = await updateDeploymentVersionMetadata({
      workflowId,
      version,
      ...(name !== undefined ? { name: name || null } : {}),
      ...(description !== undefined ? { description: description || null } : {}),
    })
    if (!updated) {
      return { success: false, error: `Deployment version ${version} not found` }
    }

    return {
      success: true,
      output: { workflowId, version, name: updated.name, description: updated.description },
    }
  } catch (error) {
    return { success: false, error: toError(error).message }
  }
}
