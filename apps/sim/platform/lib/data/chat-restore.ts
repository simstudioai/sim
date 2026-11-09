'use client'

import { useSession } from '@/lib/auth/client'
import { useRestoredChatEntry } from '@/hooks/mothership-chat/use-restored-chat-entry'
import { useHydrated } from '@/hooks/use-hydrated'

const CHAT_PATHS = { agent: /^\/chat\/[^/]+$/, assistant: /^\/search\/chat\/[^/]+$/ }

/** The signed-in viewer's id, from the session the server seeded, so server and browser agree. */
export function useViewerId(): string | undefined {
  return useSession().data?.user?.id
}

/**
 * Whether the live conversation may mount now. It runs only in the browser, past hydration: its
 * hook resumes streams and reads hand-offs the server never has. A new chat also moves its URL in
 * place, so Back or Forward to that entry mounts the new-chat tree at a chat's URL; that entry waits
 * while the router swaps in the chat route.
 */
export function useChatMountable(
  chatId: string | undefined,
  destination: 'agent' | 'assistant'
): boolean {
  const hydrated = useHydrated()
  const restored = useRestoredChatEntry({ chatId, chatPath: CHAT_PATHS[destination] })
  return hydrated && !restored
}
