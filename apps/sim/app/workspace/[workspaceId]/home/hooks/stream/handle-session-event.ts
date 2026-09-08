import { getLiveAssistantMessageId } from '@/lib/copilot/chat/effective-transcript'
import { MothershipStreamV1SessionKind } from '@/lib/copilot/generated/mothership-stream-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import { chatUrl } from '@/app/workspace/[workspaceId]/home/hooks/chat-url'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import { type MothershipChatHistory, mothershipChatKeys } from '@/hooks/queries/mothership-chats'

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
    const selected = deps.selectedChatIdRef.current
    if (isNewChat) {
      // This synchronously migrates provisional browser/terminal ownership
      // before writing chatIdRef. Assigning the ref here first would make the
      // adoption path believe there was no provisional scope to move.
      deps.adoptResolvedChatId(payloadChatId)
    } else {
      deps.chatIdRef.current = payloadChatId
      if (payloadChatId === selected) {
        deps.setResolvedChatId(payloadChatId)
      }
    }
    deps.queryClient.invalidateQueries<readonly unknown[]>({
      queryKey: deps.organizationId
        ? mothershipChatKeys.organizationList(deps.organizationId)
        : mothershipChatKeys.list(deps.workspaceId),
    })
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
        deps.queryClient.setQueryData<MothershipChatHistory>(
          mothershipChatKeys.detail(payloadChatId),
          {
            id: payloadChatId,
            title: null,
            messages: seededMessages,
            activeStreamId,
            resources: deps.resourcesRef.current,
          }
        )
      }
      deps.setPendingMessages([])
      if (!deps.workflowIdRef.current) {
        window.history.replaceState(
          null,
          '',
          chatUrl(
            deps.organizationId ? { organizationId: deps.organizationId } : deps.workspaceId!,
            payloadChatId
          )
        )
      }
    }
  }

  if (payload.kind === MothershipStreamV1SessionKind.title) {
    deps.queryClient.invalidateQueries<readonly unknown[]>({
      queryKey: deps.organizationId
        ? mothershipChatKeys.organizationList(deps.organizationId)
        : mothershipChatKeys.list(deps.workspaceId),
    })
    deps.onTitleUpdateRef.current?.()
  }
}
