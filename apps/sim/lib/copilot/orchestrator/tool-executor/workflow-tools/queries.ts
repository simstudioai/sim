import { db } from '@sim/db'
import { customTools, permissions, workflow, workflowFolder, workspace } from '@sim/db/schema'
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/orchestrator/types'
import {
  extractWorkflowNames,
  formatNormalizedWorkflowForCopilot,
  normalizeWorkflowName,
} from '@/lib/copilot/tools/shared/workflow-utils'
import { mcpService } from '@/lib/mcp/service'
import { listWorkspaceFiles } from '@/lib/uploads/contexts/workspace'
import { getBlockOutputPaths } from '@/lib/workflows/blocks/block-outputs'
import { BlockPathCalculator } from '@/lib/workflows/blocks/block-path-calculator'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import { normalizeName } from '@/executor/constants'
import {
  ensureWorkflowAccess,
  ensureWorkspaceAccess,
  getAccessibleWorkflowsForUser,
  getDefaultWorkspaceId,
} from '../access'
import type {
  GetBlockOutputsParams,
  GetBlockUpstreamReferencesParams,
  GetUserWorkflowParams,
  GetWorkflowDataParams,
  GetWorkflowFromNameParams,
  ListFoldersParams,
  ListUserWorkflowsParams,
} from '../param-types'

export async function executeGetUserWorkflow(
  params: GetUserWorkflowParams,
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
    const userWorkflow = formatNormalizedWorkflowForCopilot(normalized)
    if (!userWorkflow) {
      return { success: false, error: 'Workflow has no normalized data' }
    }

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

export async function executeGetWorkflowFromName(
  params: GetWorkflowFromNameParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowName = typeof params.workflow_name === 'string' ? params.workflow_name.trim() : ''
    if (!workflowName) {
      return { success: false, error: 'workflow_name is required' }
    }

    const workflows = await getAccessibleWorkflowsForUser(context.userId)

    const targetName = normalizeWorkflowName(workflowName)
    const match = workflows.find((w) => normalizeWorkflowName(w.name) === targetName)
    if (!match) {
      return { success: false, error: `Workflow not found: ${workflowName}` }
    }

    const normalized = await loadWorkflowFromNormalizedTables(match.id)
    const userWorkflow = formatNormalizedWorkflowForCopilot(normalized)
    if (!userWorkflow) {
      return { success: false, error: 'Workflow has no normalized data' }
    }

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

export async function executeListUserWorkflows(
  params: ListUserWorkflowsParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workspaceId = params?.workspaceId as string | undefined
    const folderId = params?.folderId as string | undefined

    const workflows = await getAccessibleWorkflowsForUser(context.userId, { workspaceId, folderId })

    const names = extractWorkflowNames(workflows)

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

export async function executeListUserWorkspaces(
  context: ExecutionContext
): Promise<ToolCallResult> {
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

export async function executeListFolders(
  params: ListFoldersParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workspaceId =
      (params?.workspaceId as string | undefined) || (await getDefaultWorkspaceId(context.userId))

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

export async function executeGetBlockOutputs(
  params: GetBlockOutputsParams,
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
    const blockIds =
      Array.isArray(params.blockIds) && params.blockIds.length > 0
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
        const canSelfReference = block.type === 'approval' || block.type === 'human_in_the_loop'
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
