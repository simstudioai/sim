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
import type { PersistedContentBlock, PersistedMessage } from './persisted-message'

const STATE_TO_STATUS: Record<string, ToolCallStatus> = {
  [MothershipStreamV1ToolOutcome.success]: ToolCallStatus.success,
  [MothershipStreamV1ToolOutcome.error]: ToolCallStatus.error,
  [MothershipStreamV1ToolOutcome.cancelled]: ToolCallStatus.cancelled,
  [MothershipStreamV1ToolOutcome.rejected]: ToolCallStatus.rejected,
  [MothershipStreamV1ToolOutcome.skipped]: ToolCallStatus.skipped,
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
  switch (block.type) {
    case MothershipStreamV1EventType.text:
      if (block.lane === 'subagent') {
        if (block.channel === 'thinking') {
          return { type: ContentBlockType.subagent_thinking, content: block.content }
        }
        return { type: ContentBlockType.subagent_text, content: block.content }
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
    previewUrl: a.media_type.startsWith('image/')
      ? `/api/files/serve/${encodeURIComponent(a.key)}?context=mothership`
      : undefined,
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

export function toDisplayMessage(msg: PersistedMessage): ChatMessage {
  const display: ChatMessage = {
    id: msg.id,
    role: msg.role,
    content: msg.content,
  }

  if (msg.requestId) {
    display.requestId = msg.requestId
  }

  if (msg.contentBlocks && msg.contentBlocks.length > 0) {
    display.contentBlocks = msg.contentBlocks
      .map(toDisplayBlock)
      .filter((block): block is ContentBlock => !!block)
  }

  const attachments = toDisplayAttachment(msg.fileAttachments)
  if (attachments.length > 0) {
    display.attachments = attachments
  }

  display.contexts = toDisplayContexts(msg.contexts)

  return display
}
