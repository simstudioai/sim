'use client'

import { useSession } from '@/lib/auth/client'
import { useRestoredChatEntry } from '@/hooks/mothership-chat/use-restored-chat-entry'

const CHAT_PATHS = { agent: /^\/chat\/[^/]+$/, assistant: /^\/search\/chat\/[^/]+$/ }

/** The signed-in viewer's id, or undefined until this component has hydrated. */
export function useViewerId(): string | undefined {
  return useSession().data?.user?.id
}

/**
 * A new chat moves its URL in place, so Back or Forward to that entry mounts the new-chat tree at a
 * chat's URL. Returns whether this mount is that entry, while the router swaps in the chat route.
 */
export function useChatRestore(chatId: string | undefined, destination: 'agent' | 'assistant') {
  return useRestoredChatEntry({ chatId, chatPath: CHAT_PATHS[destination] })
}
