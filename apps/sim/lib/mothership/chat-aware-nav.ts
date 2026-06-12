import type { MothershipResource } from '@/lib/copilot/resources/types'
import { useMothershipStageStore } from '@/stores/mothership-stage/store'

/** Sentinel `?chat=` value for a docked chat that hasn't been created yet. */
const NEW_CHAT_PARAM = 'new'

/**
 * The Mothership chat currently open on screen, read from the live URL:
 * the chat route's path segment, or the workflow route's `?chat=` mirror.
 * Reads `window.location` at call time because both mirrors are written via
 * `replaceState`, which `usePathname`/`useSearchParams` never observe.
 */
export function getOpenMothershipChatId(): string | null {
  if (typeof window === 'undefined') return null
  const url = new URL(window.location.href)
  const chatMatch = url.pathname.match(/^\/workspace\/[^/]+\/chat\/([^/]+)/)
  if (chatMatch) return chatMatch[1]
  const dockedChat = url.searchParams.get('chat')
  if (
    dockedChat &&
    dockedChat !== NEW_CHAT_PARAM &&
    /^\/workspace\/[^/]+\/w\/[^/]+/.test(url.pathname)
  ) {
    return dockedChat
  }
  return null
}

/**
 * Sidebar navigation while a chat is open never leaves the conversation:
 * the clicked destination stages on the chat's resource panel instead, and
 * only the panel switches. Returns false when no chat is open, in which case
 * the caller falls back to regular page navigation.
 */
export function stageResourceForOpenChat(
  workspaceId: string,
  resource: MothershipResource,
  navigate: (href: string) => void
): boolean {
  const chatId = getOpenMothershipChatId()
  if (!chatId) return false
  useMothershipStageStore.getState().setStage(workspaceId, resource)
  const chatPath = `/workspace/${workspaceId}/chat/${chatId}`
  const { pathname } = window.location
  if (pathname !== chatPath && !pathname.startsWith(`${chatPath}/`)) {
    navigate(`${chatPath}?resource=${resource.id}`)
  }
  return true
}
