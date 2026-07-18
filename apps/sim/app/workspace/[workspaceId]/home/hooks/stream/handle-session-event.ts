import { getLiveAssistantMessageId } from '@/lib/copilot/chat/effective-transcript'
import { MothershipStreamV1SessionKind } from '@/lib/copilot/generated/mothership-stream-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import {
  type MothershipChatHistory,
  type MothershipChatMetadata,
  mothershipChatKeys,
} from '@/hooks/queries/mothership-chats'

type SessionEvent = Extract<PersistedStreamEventEnvelope, { type: 'session' }>

export function handleSessionEvent(ctx: StreamLoopContext, parsed: SessionEvent): void {
  const { deps } = ctx
  const payload = parsed.payload
  const payloadChatId =
    payload.kind === MothershipStreamV1SessionKind.chat
      ? payload.chatId
      : typeof parsed.stream?.chatId === 'string'
        ? parsed.stream.chatId
        : undefined

  if (payload.kind === MothershipStreamV1SessionKind.chat && payloadChatId) {
    const isNewChat = !deps.chatIdRef.current
    deps.chatIdRef.current = payloadChatId
    const selected = deps.selectedChatIdRef.current
    if (selected == null) {
      if (isNewChat) {
        deps.setResolvedChatId(payloadChatId)
      }
    } else if (payloadChatId === selected) {
      deps.setResolvedChatId(payloadChatId)
    }
    deps.queryClient.invalidateQueries({ queryKey: mothershipChatKeys.list(deps.workspaceId) })
    if (isNewChat) {
      const userMsg = deps.pendingUserMsgRef.current
      const activeStreamId = deps.streamIdRef.current
      if (userMsg && activeStreamId) {
        const assistantMessage = deps.buildAssistantSnapshotMessage({
          id:
            deps.activeTurnRef.current?.assistantMessageId ??
            getLiveAssistantMessageId(activeStreamId),
          content: deps.streamingContentRef.current,
          contentBlocks: deps.streamingBlocksRef.current,
        })
        const seededMessages = [userMsg, assistantMessage]
        const listMetadata = deps.queryClient
          .getQueryData<MothershipChatMetadata[]>(mothershipChatKeys.list(deps.workspaceId))
          ?.find((chat) => chat.id === payloadChatId)
        deps.queryClient.setQueryData<MothershipChatHistory>(
          mothershipChatKeys.detail(payloadChatId),
          (current) => ({
            id: payloadChatId,
            type: current?.type ?? listMetadata?.type ?? 'mothership',
            title: current?.title ?? null,
            messages: seededMessages,
            activeStreamId,
            resources: deps.resourcesRef.current,
            linkedAppProject: current?.linkedAppProject ?? null,
          })
        )
      }
      deps.setPendingMessages([])
      if (!deps.workflowIdRef.current) {
        window.history.replaceState(
          null,
          '',
          `/workspace/${deps.workspaceId}/chat/${payloadChatId}`
        )
      }
    }
  }

  if (payload.kind === MothershipStreamV1SessionKind.title) {
    deps.queryClient.invalidateQueries({ queryKey: mothershipChatKeys.list(deps.workspaceId) })
    deps.onTitleUpdateRef.current?.()
  }
}
