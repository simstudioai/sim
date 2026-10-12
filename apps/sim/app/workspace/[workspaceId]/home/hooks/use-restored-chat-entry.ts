import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

const CHAT_PATH = /^\/(?:workspace|o)\/[^/]+\/chat\/[^/]+$/

interface UseRestoredChatEntryProps {
  /** The chat the surface was opened for; the new-chat surface has none. */
  chatId: string | undefined
}

/**
 * Hands a restored new-chat history entry back to the router.
 *
 * A new chat moves its URL from the home route to `/chat/<id>` in place, through
 * `history.replaceState`, so the turn streaming on that surface stays mounted. Next keeps
 * the home route's tree in that history entry, so Back or Forward to it mounts the home
 * route at the chat's URL. Replacing the entry through the router resolves the chat route
 * and stores its tree, so later visits to the entry render the chat directly. Only the URL
 * at mount counts: the surface that moved its own URL keeps rendering.
 *
 * @returns Whether this mount is a restored entry; the caller renders its fallback until
 *   the chat route replaces it.
 */
export function useRestoredChatEntry({ chatId }: UseRestoredChatEntryProps): boolean {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [restoredChatUrl] = useState(() => {
    if (chatId || !CHAT_PATH.test(pathname)) return null
    const search = searchParams.toString()
    return search ? `${pathname}?${search}` : pathname
  })

  useEffect(() => {
    if (restoredChatUrl) router.replace(restoredChatUrl, { scroll: false })
  }, [restoredChatUrl, router])

  return restoredChatUrl !== null
}
