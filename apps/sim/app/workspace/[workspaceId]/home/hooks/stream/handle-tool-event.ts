import { MothershipStreamV1ToolPhase } from '@/lib/mothership/generated/mothership-stream-v1'
import {
  ApplyFileEdit,
  ConnectSlackBot,
  PrepareFileEdit,
} from '@/lib/mothership/generated/tool-catalog-v1'
import {
  extractResourcesFromToolResult,
  isResourceToolName,
} from '@/lib/mothership/resources/extraction'
import { invalidateResourceQueries } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import {
  type ClientToolStart,
  resolveClientToolStart,
  type ToolEvent,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/client-tool-start'
import type {
  StreamLoopContext,
  StreamLoopDeps,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import {
  DEPLOY_TOOL_NAMES,
  FILE_SUBAGENT_ID,
  FOLDER_TOOL_NAMES,
  WORKFLOW_MUTATION_TOOL_NAMES,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-helpers'
import {
  MAIN_SPAN,
  resolveToolId,
  type ToolNode,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/turn-model'
import { resolveFileResourceSelectionId } from '@/app/workspace/[workspaceId]/home/resource-view-policy'
import { deploymentKeys } from '@/hooks/queries/deployments'
import { oauthCredentialKeys } from '@/hooks/queries/oauth/oauth-credentials'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'
import { invalidateSelectorQueries } from '@/hooks/queries/utils/selector-keys'

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
function runToolResultSideEffects(ctx: StreamLoopContext, node: ToolNode, replay: boolean): void {
  const { deps } = ctx
  if (!deps.workspaceId) return
  const name = node.name
  const output = node.result?.output
  const isSuccess = node.status === 'success'
  const params = node.args
  const calledBy = agentIdForSpan(ctx, node.spanId)

  if (DEPLOY_TOOL_NAMES.has(name) && isSuccess) {
    const out = output as Record<string, unknown> | undefined
    const deployedWorkflowId = (out?.workflowId as string) ?? undefined
    if (deployedWorkflowId && typeof out?.isDeployed === 'boolean') {
      deps.queryClient.invalidateQueries({ queryKey: deploymentKeys.info(deployedWorkflowId) })
      deps.queryClient.invalidateQueries({ queryKey: deploymentKeys.versions(deployedWorkflowId) })
      void invalidateWorkflowLists(deps.queryClient, deps.workspaceId)
    }
  }

  if (FOLDER_TOOL_NAMES.has(name) && isSuccess) {
    deps.queryClient.invalidateQueries({ queryKey: folderKeys.list(deps.workspaceId) })
  }
  if (name === ConnectSlackBot.id && isSuccess) {
    void deps.queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.lists() })
    void deps.queryClient.invalidateQueries({ queryKey: oauthCredentialKeys.lists() })
    void invalidateSelectorQueries(deps.queryClient)
  }
  if (WORKFLOW_MUTATION_TOOL_NAMES.has(name) && isSuccess) {
    // `rm` archives, so the archived list moves too — and the shared helper also
    // refreshes the workflow selector lists that `@`-mentions and pickers read.
    void invalidateWorkflowLists(deps.queryClient, deps.workspaceId, ['active', 'archived'])
  }

  const extractedResources =
    isSuccess && isResourceToolName(name)
      ? extractResourcesFromToolResult(name, params, output)
      : []
  for (const resource of extractedResources) {
    invalidateResourceQueries(deps.queryClient, deps.workspaceId, resource.type, resource.id)
  }

  if (!replay && (name === ApplyFileEdit.id || name === PrepareFileEdit.id) && isSuccess) {
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
      deps.onResourceEventRef.current?.(
        resolveFileResourceSelectionId(deps.resourcesRef.current, editedFileId, deps.workspaceId)
      )
      invalidateResourceQueries(deps.queryClient, deps.workspaceId, 'file', editedFileId)
    }
  }

  deps.onToolResultRef.current?.(name, isSuccess, output)

  const workspaceFileOperation =
    name === PrepareFileEdit.id && typeof params?.operation === 'string'
      ? params.operation
      : undefined
  const shouldKeepWorkspacePreviewOpen =
    name === PrepareFileEdit.id &&
    (workspaceFileOperation === 'append' ||
      workspaceFileOperation === 'update' ||
      workspaceFileOperation === 'patch')

  if (
    !replay &&
    (name === PrepareFileEdit.id || name === ApplyFileEdit.id) &&
    !shouldKeepWorkspacePreviewOpen
  ) {
    if (name === PrepareFileEdit.id) {
      deps.removePreviewSessionImmediate(node.id)
    }
    const fileResource = extractedResources.find((r) => r.type === 'file')
    if (fileResource) {
      deps.promoteFileResource(fileResource.id, fileResource.title)
      deps.onResourceEventRef.current?.(
        resolveFileResourceSelectionId(deps.resourcesRef.current, fileResource.id, deps.workspaceId)
      )
      invalidateResourceQueries(deps.queryClient, deps.workspaceId, 'file', fileResource.id)
    } else if (calledBy !== FILE_SUBAGENT_ID) {
      deps.setResources((rs) => rs.filter((r) => r.id !== 'streaming-file'))
    }
  }
}

/** Hands a client-executed tool call to the executor for its kind. */
function startClientTool(deps: StreamLoopDeps, start: ClientToolStart): void {
  const { toolCallId, toolName, args, eventTs } = start
  switch (start.kind) {
    case 'workflow':
      deps.startClientWorkflowTool(toolCallId, toolName, args)
      return
    case 'localFilesystem':
      deps.startClientLocalFilesystemTool(toolCallId, toolName, args)
      return
    case 'browser':
      deps.startClientBrowserTool(toolCallId, toolName, args, eventTs)
      return
    case 'terminal':
      deps.startClientTerminalTool(toolCallId, toolName, args, eventTs)
      return
  }
}

/**
 * Side effects for tool events. State (the tool node, its status, args, and the
 * apply_file_edit row merge) is owned by `reduceEvent`; this handler routes preview
 * phases, starts client-executed tools, and runs result side effects, then
 * flushes the model-derived snapshot.
 */
export function handleToolEvent(ctx: StreamLoopContext, parsed: ToolEvent): void {
  const { state, ops, deps } = ctx
  const payload = parsed.payload
  const replay =
    ('replay' in payload && payload.replay === true) || deps.options.deferFlushes === true
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
    if (node?.kind === 'tool' && node.result) runToolResultSideEffects(ctx, node, replay)
    ops.flush()
    return
  }

  // Call phase. If a buffered result-before-call was applied to this node by the
  // reducer, run its side effects now (the result event had no node to act on).
  if (node?.kind === 'tool' && node.result) runToolResultSideEffects(ctx, node, replay)

  const start = resolveClientToolStart(parsed, (toolCallId) => {
    if (deps.options.suppressedWorkflowToolStartIds?.has(toolCallId)) return false
    const tool = state.model.nodes.get(resolveToolId(state.model, toolCallId))
    return tool?.kind === 'tool' && tool.status === 'running' && !tool.result
  })
  if (start) startClientTool(deps, start)
  ops.flush()
}
