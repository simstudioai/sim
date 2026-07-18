import { MothershipStreamV1AppEventName } from '@/lib/copilot/generated/mothership-stream-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import { appKeys } from '@/hooks/queries/apps'
import { mothershipChatKeys } from '@/hooks/queries/mothership-chats'

type AppEvent = Extract<PersistedStreamEventEnvelope, { type: 'app' }>

const KNOWN_APP_EVENTS = new Set<string>(Object.values(MothershipStreamV1AppEventName))

function asProjectId(payload: Record<string, unknown> | undefined): string | undefined {
  const projectId = payload?.projectId
  return typeof projectId === 'string' && projectId.length > 0 ? projectId : undefined
}

/**
 * Side effects for typed Full-stack App lifecycle envelopes. The turn model does
 * not render these; they keep App detail/list and linked-chat caches fresh so
 * Home/App builder UI tracks bind/build/publish/revoke/preview without waiting
 * only on generic tool-result invalidation.
 */
export function handleAppEvent(ctx: StreamLoopContext, parsed: AppEvent): void {
  const eventName = parsed.payload?.event
  if (typeof eventName !== 'string' || !KNOWN_APP_EVENTS.has(eventName)) {
    return
  }

  const nested =
    parsed.payload.payload && typeof parsed.payload.payload === 'object'
      ? (parsed.payload.payload as Record<string, unknown>)
      : undefined
  const projectId = asProjectId(nested)
  const { queryClient, workspaceId, chatIdRef } = ctx.deps
  const chatId = chatIdRef.current

  void queryClient.invalidateQueries({ queryKey: appKeys.all })
  void queryClient.invalidateQueries({ queryKey: appKeys.list(workspaceId) })
  if (projectId) {
    void queryClient.invalidateQueries({ queryKey: appKeys.detail(projectId) })
  }
  void queryClient.invalidateQueries({ queryKey: mothershipChatKeys.lists() })
  void queryClient.invalidateQueries({ queryKey: mothershipChatKeys.list(workspaceId) })
  if (chatId) {
    void queryClient.invalidateQueries({ queryKey: mothershipChatKeys.detail(chatId) })
  }

  void eventName
}
