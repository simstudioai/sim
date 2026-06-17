import {
  MothershipStreamV1ToolPhase,
  MothershipStreamV1ToolStatus,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { Read as ReadTool, WorkspaceFile } from '@/lib/copilot/generated/tool-catalog-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import {
  extractResourcesFromToolResult,
  isResourceToolName,
} from '@/lib/copilot/resources/extraction'
import { isWorkflowToolName } from '@/lib/copilot/tools/workflow-tools'
import { invalidateResourceQueries } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import {
  DEPLOY_TOOL_NAMES,
  extractResourceFromReadResult,
  FILE_SUBAGENT_ID,
  FOLDER_TOOL_NAMES,
  WORKFLOW_MUTATION_TOOL_NAMES,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-helpers'
import {
  MAIN_SPAN,
  resolveToolId,
  type ToolNode,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/turn-model'
import { deploymentKeys } from '@/hooks/queries/deployments'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { workflowKeys } from '@/hooks/queries/workflows'

type ToolEvent = Extract<PersistedStreamEventEnvelope, { type: 'tool' }>

/** The display agent id for a tool's owning span (undefined on the main lane). */
function agentIdForSpan(ctx: StreamLoopContext, spanId: string): string | undefined {
  if (spanId === MAIN_SPAN) return undefined
  const agent = ctx.state.model.nodes.get(spanId)
  return agent?.kind === 'agent' ? agent.agentId : undefined
}

/**
 * Runs the external side effects of a finished tool (resource extraction, query
 * invalidation, file-resource promotion, preview cleanup, onToolResult). The
 * tool's lifecycle/status is owned by the model; this reads the settled node and
 * only performs side effects, so the model stays the single source of state.
 */
function runToolResultSideEffects(ctx: StreamLoopContext, node: ToolNode): void {
  const { deps } = ctx
  const name = node.name
  const output = node.result?.output
  const isSuccess = node.status === 'success'
  const params = node.args
  const calledBy = agentIdForSpan(ctx, node.spanId)

  if (name === ReadTool.id && isSuccess) {
    const resource = extractResourceFromReadResult(
      typeof params?.path === 'string' ? params.path : undefined,
      output
    )
    if (resource && deps.addResource(resource)) {
      deps.onResourceEventRef.current?.()
    }
  }

  if (DEPLOY_TOOL_NAMES.has(name) && isSuccess) {
    const out = output as Record<string, unknown> | undefined
    const deployedWorkflowId = (out?.workflowId as string) ?? undefined
    if (deployedWorkflowId && typeof out?.isDeployed === 'boolean') {
      deps.queryClient.invalidateQueries({ queryKey: deploymentKeys.info(deployedWorkflowId) })
      deps.queryClient.invalidateQueries({ queryKey: deploymentKeys.versions(deployedWorkflowId) })
      deps.queryClient.invalidateQueries({ queryKey: workflowKeys.list(deps.workspaceId) })
    }
  }

  if (FOLDER_TOOL_NAMES.has(name) && isSuccess) {
    deps.queryClient.invalidateQueries({ queryKey: folderKeys.list(deps.workspaceId) })
  }
  if (WORKFLOW_MUTATION_TOOL_NAMES.has(name) && isSuccess) {
    deps.queryClient.invalidateQueries({ queryKey: workflowKeys.list(deps.workspaceId) })
  }

  const extractedResources =
    isSuccess && isResourceToolName(name)
      ? extractResourcesFromToolResult(name, params, output)
      : []
  for (const resource of extractedResources) {
    invalidateResourceQueries(deps.queryClient, deps.workspaceId, resource.type, resource.id)
  }

  if ((name === 'edit_content' || name === WorkspaceFile.id) && isSuccess) {
    const out = output as Record<string, unknown> | undefined
    const editData =
      out && typeof out.data === 'object' && out.data !== null
        ? (out.data as Record<string, unknown>)
        : undefined
    const editedFileId =
      (typeof editData?.id === 'string' ? editData.id : undefined) ??
      deps.previewSessionRef.current?.fileId
    if (editedFileId) {
      const editedFileName =
        (typeof editData?.name === 'string' ? editData.name : undefined) ??
        deps.previewSessionRef.current?.fileName ??
        'File'
      deps.promoteFileResource(editedFileId, editedFileName)
      if (
        deps.activeResourceIdRef.current === null ||
        deps.activeResourceIdRef.current === 'streaming-file' ||
        deps.activeResourceIdRef.current === editedFileId
      ) {
        deps.setActiveResourceId(editedFileId)
      }
      invalidateResourceQueries(deps.queryClient, deps.workspaceId, 'file', editedFileId)
    }
  }

  deps.onToolResultRef.current?.(name, isSuccess, output)

  const workspaceFileOperation =
    name === WorkspaceFile.id && typeof params?.operation === 'string'
      ? params.operation
      : undefined
  const shouldKeepWorkspacePreviewOpen =
    name === WorkspaceFile.id &&
    (workspaceFileOperation === 'append' ||
      workspaceFileOperation === 'update' ||
      workspaceFileOperation === 'patch')

  if ((name === WorkspaceFile.id || name === 'edit_content') && !shouldKeepWorkspacePreviewOpen) {
    if (name === WorkspaceFile.id) {
      deps.removePreviewSessionImmediate(node.id)
    }
    const fileResource = extractedResources.find((r) => r.type === 'file')
    if (fileResource) {
      deps.promoteFileResource(fileResource.id, fileResource.title)
      deps.setActiveResourceId(fileResource.id)
      invalidateResourceQueries(deps.queryClient, deps.workspaceId, 'file', fileResource.id)
    } else if (calledBy !== FILE_SUBAGENT_ID) {
      deps.setResources((rs) => rs.filter((r) => r.id !== 'streaming-file'))
    }
  }
}

/**
 * Side effects for tool events. State (the tool node, its status, args, and the
 * edit_content row merge) is owned by `reduceEvent`; this handler routes preview
 * phases, fires client workflow tools, and runs result side effects, then
 * flushes the model-derived snapshot.
 */
export function handleToolEvent(ctx: StreamLoopContext, parsed: ToolEvent): void {
  const { state, ops, deps } = ctx
  const payload = parsed.payload
  const rawId = payload.toolCallId

  if ('previewPhase' in payload) {
    // The file preview panel is a separate concern: forward the phase to the
    // preview controller, never coupling it to tool-row status.
    deps.onPreviewPhase(payload, parsed.stream?.streamId)
    return
  }

  if (payload.phase === MothershipStreamV1ToolPhase.args_delta) {
    ops.flushText()
    return
  }

  const node = state.model.nodes.get(resolveToolId(state.model, rawId))

  if (payload.phase === MothershipStreamV1ToolPhase.result) {
    if (node?.kind === 'tool' && node.result) runToolResultSideEffects(ctx, node)
    ops.flush()
    return
  }

  // Call phase. If a buffered result-before-call was applied to this node by the
  // reducer, run its side effects now (the result event had no node to act on).
  if (node?.kind === 'tool' && node.result) runToolResultSideEffects(ctx, node)

  const name = payload.toolName
  const isPartial =
    payload.partial === true || payload.status === MothershipStreamV1ToolStatus.generating
  if (isWorkflowToolName(name) && !isPartial) {
    const shouldStartWorkflowTool =
      !deps.options.suppressedWorkflowToolStartIds?.has(rawId) &&
      node?.kind === 'tool' &&
      node.status === 'running' &&
      !node.result
    if (shouldStartWorkflowTool) {
      const args = payload.arguments as Record<string, unknown> | undefined
      deps.startClientWorkflowTool(rawId, name, args ?? {})
    }
  }
  ops.flush()
}
