'use client'

import { useSession } from '@/lib/auth/client'
import { useRestoredChatEntry } from '@/hooks/mothership-chat/use-restored-chat-entry'
import { useHydrated } from '@/hooks/use-hydrated'

const CHAT_PATHS = { agent: /^\/chat\/[^/]+$/, assistant: /^\/search\/chat\/[^/]+$/ }

/**
 * The signed-in viewer's id, or undefined until hydration ends. The session is read only in the
 * browser, so the server never has it; a session that settles before a late route boundary hydrates
 * would otherwise render over empty server markup.
 */
export function useViewerId(): string | undefined {
  const userId = useSession().data?.user?.id
  return useHydrated() ? userId : undefined
}

/**
 * A new chat moves its URL in place, so Back or Forward to that entry mounts the new-chat tree at a
 * chat's URL. Returns whether this mount is that entry, while the router swaps in the chat route.
 */
export function useChatRestore(chatId: string | undefined, destination: 'agent' | 'assistant') {
  return useRestoredChatEntry({ chatId, chatPath: CHAT_PATHS[destination] })
}
