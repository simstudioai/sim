import {
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
  MothershipStreamV1ToolStatus,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { Read as ReadTool, WorkspaceFile } from '@/lib/copilot/generated/tool-catalog-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import {
  extractResourcesFromToolResult,
  isResourceToolName,
} from '@/lib/copilot/resources/extraction'
import { isToolHiddenInUi } from '@/lib/copilot/tools/client/hidden-tools'
import { isWorkflowToolName } from '@/lib/copilot/tools/workflow-tools'
import { invalidateResourceQueries } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type {
  StreamEventScope,
  StreamLoopContext,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import {
  asPayloadRecord,
  DEPLOY_TOOL_NAMES,
  extractResourceFromReadResult,
  FILE_SUBAGENT_ID,
  FOLDER_TOOL_NAMES,
  getToolUI,
  isTerminalToolCallStatus,
  resolveLiveToolStatus,
  resolveStreamingToolDisplayTitle,
  resolveToolDisplayTitle,
  type ToolResultPhasePayload,
  WORKFLOW_MUTATION_TOOL_NAMES,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-helpers'
import { ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'
import { deploymentKeys } from '@/hooks/queries/deployments'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { workflowKeys } from '@/hooks/queries/workflows'

type ToolEvent = Extract<PersistedStreamEventEnvelope, { type: 'tool' }>

function applyToolResult(
  ctx: StreamLoopContext,
  idx: number,
  id: string,
  payload: ToolResultPhasePayload
): void {
  const { state, ops, deps } = ctx
  const tc = state.blocks[idx].toolCall!
  const outputObj = asPayloadRecord(payload.output)
  const isCancelled =
    outputObj?.reason === 'user_cancelled' ||
    outputObj?.cancelledByUser === true ||
    payload.status === MothershipStreamV1ToolOutcome.cancelled
  const status = isCancelled ? ToolCallStatus.cancelled : resolveLiveToolStatus(payload)
  const isSuccess = status === ToolCallStatus.success

  if (status === ToolCallStatus.cancelled) {
    tc.status = ToolCallStatus.cancelled
    tc.displayTitle = 'Stopped by user'
  } else {
    tc.status = status
  }
  tc.streamingArgs = undefined
  tc.result = {
    success: isSuccess,
    output: payload.output,
    error: typeof payload.error === 'string' ? payload.error : undefined,
  }
  ops.stampBlockEnd(state.blocks[idx])
  ops.flush()

  if (tc.name === ReadTool.id && tc.status === 'success') {
    const readArgs = state.toolArgsMap.get(id)
    const resource = extractResourceFromReadResult(
      typeof readArgs?.path === 'string' ? readArgs.path : undefined,
      tc.result.output
    )
    if (resource && deps.addResource(resource)) {
      deps.onResourceEventRef.current?.()
    }
  }

  if (DEPLOY_TOOL_NAMES.has(tc.name) && tc.status === 'success') {
    const output = tc.result?.output as Record<string, unknown> | undefined
    const deployedWorkflowId = (output?.workflowId as string) ?? undefined
    if (deployedWorkflowId && typeof output?.isDeployed === 'boolean') {
      deps.queryClient.invalidateQueries({ queryKey: deploymentKeys.info(deployedWorkflowId) })
      deps.queryClient.invalidateQueries({ queryKey: deploymentKeys.versions(deployedWorkflowId) })
      deps.queryClient.invalidateQueries({ queryKey: workflowKeys.list(deps.workspaceId) })
    }
  }

  if (FOLDER_TOOL_NAMES.has(tc.name) && tc.status === 'success') {
    deps.queryClient.invalidateQueries({ queryKey: folderKeys.list(deps.workspaceId) })
  }
  if (WORKFLOW_MUTATION_TOOL_NAMES.has(tc.name) && tc.status === 'success') {
    deps.queryClient.invalidateQueries({ queryKey: workflowKeys.list(deps.workspaceId) })
  }

  const extractedResources =
    tc.status === 'success' && isResourceToolName(tc.name)
      ? extractResourcesFromToolResult(
          tc.name,
          state.toolArgsMap.get(id) as Record<string, unknown> | undefined,
          tc.result?.output
        )
      : []

  for (const resource of extractedResources) {
    invalidateResourceQueries(deps.queryClient, deps.workspaceId, resource.type, resource.id)
  }

  if ((tc.name === 'edit_content' || tc.name === WorkspaceFile.id) && tc.status === 'success') {
    const editOutput = tc.result?.output as Record<string, unknown> | undefined
    const editData =
      editOutput && typeof editOutput.data === 'object' && editOutput.data !== null
        ? (editOutput.data as Record<string, unknown>)
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

  deps.onToolResultRef.current?.(tc.name, tc.status === 'success', tc.result?.output)

  const workspaceFileOperation =
    tc.name === WorkspaceFile.id && typeof tc.params?.operation === 'string'
      ? tc.params.operation
      : undefined
  const shouldKeepWorkspacePreviewOpen =
    tc.name === WorkspaceFile.id &&
    (workspaceFileOperation === 'append' ||
      workspaceFileOperation === 'update' ||
      workspaceFileOperation === 'patch')

  if (
    (tc.name === WorkspaceFile.id || tc.name === 'edit_content') &&
    !shouldKeepWorkspacePreviewOpen
  ) {
    if (tc.name === WorkspaceFile.id) {
      deps.removePreviewSessionImmediate(id)
    }
    const fileResource = extractedResources.find((r) => r.type === 'file')
    if (fileResource) {
      deps.promoteFileResource(fileResource.id, fileResource.title)
      deps.setActiveResourceId(fileResource.id)
      invalidateResourceQueries(deps.queryClient, deps.workspaceId, 'file', fileResource.id)
    } else if (tc.calledBy !== FILE_SUBAGENT_ID) {
      deps.setResources((rs) => rs.filter((r) => r.id !== 'streaming-file'))
    }
  }
}

export function handleToolEvent(
  ctx: StreamLoopContext,
  parsed: ToolEvent,
  scope: StreamEventScope
): void {
  const { state, ops, deps } = ctx
  const { scopedSubagent, scopedParentToolCallId, spanIdentity } = scope
  const payload = parsed.payload
  const id = payload.toolCallId

  if ('previewPhase' in payload) {
    deps.onPreviewPhase(payload, parsed.stream?.streamId)
    return
  }

  if (payload.phase === MothershipStreamV1ToolPhase.args_delta) {
    const delta = payload.argumentsDelta
    if (!delta) return

    const idx = state.toolMap.get(id)
    if (idx !== undefined && state.blocks[idx].toolCall) {
      const tc = state.blocks[idx].toolCall!
      tc.streamingArgs = (tc.streamingArgs ?? '') + delta
      const displayTitle = resolveStreamingToolDisplayTitle(tc.name, tc.streamingArgs)
      if (displayTitle) tc.displayTitle = displayTitle

      ops.flush()
    }
    return
  }

  if (payload.phase === MothershipStreamV1ToolPhase.result) {
    const idx = state.toolMap.get(id)
    if (idx === undefined || !state.blocks[idx].toolCall) {
      state.pendingToolResults.set(id, payload)
      return
    }
    applyToolResult(ctx, idx, id, payload)
    return
  }

  const name = payload.toolName
  const isPartial =
    payload.partial === true || payload.status === MothershipStreamV1ToolStatus.generating
  if (isToolHiddenInUi(name)) {
    return
  }
  const ui = getToolUI(payload.ui)
  if (ui?.hidden) return
  let displayTitle = ui?.title
  const args = payload.arguments as Record<string, unknown> | undefined

  displayTitle = resolveToolDisplayTitle(name, args) ?? displayTitle

  if (name === 'edit_content') {
    const parentToolCallId = deps.latestPreviewTargetToolCallIdRef.current
    const parentIdx = parentToolCallId !== null ? state.toolMap.get(parentToolCallId) : undefined
    const parentToolCall = parentIdx !== undefined ? state.blocks[parentIdx].toolCall : undefined
    const parentPreviewSession =
      parentToolCallId !== null ? deps.previewSessionsRef.current[parentToolCallId] : undefined
    const canReuseParentRow =
      parentToolCall !== undefined &&
      (!isTerminalToolCallStatus(parentToolCall.status) ||
        (parentToolCall.status === ToolCallStatus.success &&
          parentPreviewSession !== undefined &&
          parentPreviewSession.status !== 'complete'))
    if (parentIdx !== undefined && parentToolCall && canReuseParentRow) {
      state.toolMap.set(id, parentIdx)
      parentToolCall.status = 'executing'
      parentToolCall.result = undefined
      ops.flush()
      return
    }
  }

  const existingToolCall = state.toolMap.has(id)
    ? state.blocks[state.toolMap.get(id)!]?.toolCall
    : undefined
  const isNewToolCall = !existingToolCall
  if (isNewToolCall) {
    ops.stampBlockEnd(state.blocks[state.blocks.length - 1])
    state.toolMap.set(id, state.blocks.length)
    const parentToolCallIdForBlock = ops.resolveParentForSubagentBlock(
      scopedSubagent,
      scopedParentToolCallId
    )
    state.blocks.push({
      type: 'tool_call',
      toolCall: {
        id,
        name,
        status: 'executing',
        displayTitle,
        params: args,
        calledBy: scopedSubagent,
      },
      ...(parentToolCallIdForBlock ? { parentToolCallId: parentToolCallIdForBlock } : {}),
      ...spanIdentity,
      timestamp: Date.now(),
    })
    if (name === ReadTool.id || isResourceToolName(name)) {
      if (args) state.toolArgsMap.set(id, args)
    }
    const pendingResult = state.pendingToolResults.get(id)
    if (pendingResult !== undefined) {
      state.pendingToolResults.delete(id)
      applyToolResult(ctx, state.toolMap.get(id)!, id, pendingResult)
    }
  } else {
    const idx = state.toolMap.get(id)!
    const tc = state.blocks[idx].toolCall
    if (tc) {
      tc.name = name
      if (displayTitle) tc.displayTitle = displayTitle
      if (args) tc.params = args
    }
  }
  ops.flush()

  if (isWorkflowToolName(name) && !isPartial) {
    const shouldStartWorkflowTool =
      !deps.options.suppressedWorkflowToolStartIds?.has(id) &&
      (isNewToolCall ||
        (existingToolCall?.status === ToolCallStatus.executing && !existingToolCall.result))
    if (shouldStartWorkflowTool) {
      deps.startClientWorkflowTool(id, name, args ?? {})
    }
  }
}
