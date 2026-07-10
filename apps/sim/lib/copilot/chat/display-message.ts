import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1ToolOutcome,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { isToolHiddenInUi } from '@/lib/copilot/tools/client/hidden-tools'
import {
  type ChatContextKind,
  type ChatMessage,
  type ChatMessageAttachment,
  type ChatMessageContext,
  type ContentBlock,
  ContentBlockType,
  type ToolCallInfo,
  ToolCallStatus,
} from '@/app/workspace/[workspaceId]/home/types'
import { getMothershipAttachmentPreviewUrl } from './attachment-preview'
import type { PersistedContentBlock, PersistedMessage } from './persisted-message'
import { withBlockTiming } from './persisted-message'

const STATE_TO_STATUS: Record<string, ToolCallStatus> = {
  [MothershipStreamV1ToolOutcome.success]: ToolCallStatus.success,
  [MothershipStreamV1ToolOutcome.error]: ToolCallStatus.error,
  [MothershipStreamV1ToolOutcome.cancelled]: ToolCallStatus.cancelled,
  [MothershipStreamV1ToolOutcome.rejected]: ToolCallStatus.rejected,
  [MothershipStreamV1ToolOutcome.skipped]: ToolCallStatus.skipped,
  aborted: ToolCallStatus.cancelled,
  failed: ToolCallStatus.error,
  interrupted: ToolCallStatus.interrupted,
  pending: ToolCallStatus.executing,
  executing: ToolCallStatus.executing,
}

function toToolCallInfo(block: PersistedContentBlock): ToolCallInfo | undefined {
  const tc = block.toolCall
  if (!tc) return undefined
  if (isToolHiddenInUi(tc.name)) return undefined
  const status: ToolCallStatus = STATE_TO_STATUS[tc.state] ?? ToolCallStatus.error
  return {
    id: tc.id,
    name: tc.name,
    status,
    displayTitle: status === ToolCallStatus.cancelled ? 'Stopped by user' : tc.display?.title,
    params: tc.params,
    calledBy: tc.calledBy,
    result: tc.result,
  }
}

function toDisplayBlock(block: PersistedContentBlock): ContentBlock | undefined {
  const displayed = toDisplayBlockBody(block)
  if (!displayed) return undefined
  if (block.parentToolCallId && displayed.parentToolCallId === undefined) {
    displayed.parentToolCallId = block.parentToolCallId
  }
  if (block.spanId && displayed.spanId === undefined) {
    displayed.spanId = block.spanId
  }
  if (block.parentSpanId && displayed.parentSpanId === undefined) {
    displayed.parentSpanId = block.parentSpanId
  }
  return withBlockTiming(displayed, block)
}

function toDisplayBlockBody(block: PersistedContentBlock): ContentBlock | undefined {
  switch (block.type) {
    case MothershipStreamV1EventType.text:
      if (block.lane === 'subagent') {
        if (block.channel === 'thinking') {
          return {
            type: ContentBlockType.subagent_thinking,
            content: block.content,
            ...(block.agent ? { subagent: block.agent } : {}),
          }
        }
        return {
          type: ContentBlockType.subagent_text,
          content: block.content,
          ...(block.agent ? { subagent: block.agent } : {}),
        }
      }
      if (block.channel === 'thinking') {
        return { type: ContentBlockType.thinking, content: block.content }
      }
      return { type: ContentBlockType.text, content: block.content }
    case MothershipStreamV1EventType.tool:
      if (!toToolCallInfo(block)) return undefined
      return { type: ContentBlockType.tool_call, toolCall: toToolCallInfo(block) }
    case MothershipStreamV1EventType.span:
      if (block.lifecycle === MothershipStreamV1SpanLifecycleEvent.end) {
        return { type: ContentBlockType.subagent_end }
      }
      return { type: ContentBlockType.subagent, content: block.content }
    case MothershipStreamV1EventType.complete:
      if (block.status === MothershipStreamV1CompletionStatus.cancelled) {
        return { type: ContentBlockType.stopped }
      }
      return { type: ContentBlockType.text, content: block.content }
    default:
      return { type: ContentBlockType.text, content: block.content }
  }
}

function toDisplayAttachment(f: PersistedMessage['fileAttachments']): ChatMessageAttachment[] {
  if (!f || f.length === 0) return []
  return f.map((a) => ({
    id: a.id,
    filename: a.filename,
    media_type: a.media_type,
    size: a.size,
    previewUrl: getMothershipAttachmentPreviewUrl(a),
  }))
}

function toDisplayContexts(
  contexts: PersistedMessage['contexts']
): ChatMessageContext[] | undefined {
  if (!contexts || contexts.length === 0) return undefined
  return contexts.map((c) => ({
    kind: c.kind as ChatContextKind,
    label: c.label,
    ...(c.workflowId ? { workflowId: c.workflowId } : {}),
    ...(c.knowledgeId ? { knowledgeId: c.knowledgeId } : {}),
    ...(c.tableId ? { tableId: c.tableId } : {}),
    ...(c.fileId ? { fileId: c.fileId } : {}),
    ...(c.folderId ? { folderId: c.folderId } : {}),
    ...(c.chatId ? { chatId: c.chatId } : {}),
  }))
}

const WORKSPACE_FILE_TOOL = 'workspace_file'
const EDIT_CONTENT_TOOL = 'edit_content'
const MAIN_SPAN = 'main'

/**
 * Collapses an `edit_content` write into the most-recent `workspace_file` row in
 * the same subagent span, mirroring the live turn-model fold. The live view
 * folds these in `reduceEvent`, but the persisted transcript stores them as two
 * separate tool blocks; without this a reloaded chat splits the file write into
 * "workspace_file" + "edit_content" rows (and a refresh mid-write leaves the
 * second row spinning). The reopened row inherits the edit_content's final
 * status/result, exactly as the live single "writing" row resolves. Every other
 * block is passed through untouched, so this only affects file writes.
 */
function foldFileWriteBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const folded: ContentBlock[] = []
  const workspaceFileIndexBySpan = new Map<string, number>()
  for (const block of blocks) {
    const tc = block.type === ContentBlockType.tool_call ? block.toolCall : undefined
    if (tc) {
      const span = block.spanId ?? MAIN_SPAN
      if (tc.name === EDIT_CONTENT_TOOL) {
        const parentIndex = workspaceFileIndexBySpan.get(span)
        const parent = parentIndex !== undefined ? folded[parentIndex] : undefined
        if (parent?.type === ContentBlockType.tool_call && parent.toolCall) {
          folded[parentIndex!] = {
            ...parent,
            toolCall: { ...parent.toolCall, status: tc.status, result: tc.result },
          }
          continue
        }
      } else if (tc.name === WORKSPACE_FILE_TOOL) {
        workspaceFileIndexBySpan.set(span, folded.length)
      }
    }
    folded.push(block)
  }
  return folded
}

const displayMessageCache = new WeakMap<PersistedMessage, ChatMessage>()

/**
 * Maps a `PersistedMessage` (server wire shape) to a `ChatMessage` (UI shape).
 * Reference-stable: returns the same object for a given `PersistedMessage`
 * instance so `React.memo` boundaries downstream of React Query's structural
 * sharing can short-circuit on identity.
 */
export function toDisplayMessage(msg: PersistedMessage): ChatMessage {
  const cached = displayMessageCache.get(msg)
  if (cached) return cached

  const display: ChatMessage = {
    id: msg.id,
    role: msg.role,
    content: msg.content,
  }

  if (msg.requestId) {
    display.requestId = msg.requestId
  }

  if (msg.contentBlocks && msg.contentBlocks.length > 0) {
    const displayBlocks = msg.contentBlocks
      .map(toDisplayBlock)
      .filter((block): block is ContentBlock => !!block)
    display.contentBlocks = foldFileWriteBlocks(displayBlocks)
  }

  const attachments = toDisplayAttachment(msg.fileAttachments)
  if (attachments.length > 0) {
    display.attachments = attachments
  }

  display.contexts = toDisplayContexts(msg.contexts)

  displayMessageCache.set(msg, display)
  return display
}
