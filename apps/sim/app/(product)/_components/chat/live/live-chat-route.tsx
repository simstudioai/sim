import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { ChatScreen } from '@/app/(product)/_components/chat/conversation/chat-screen'
import { LiveChat } from '@/app/(product)/_components/chat/live/live-chat'
import { readOpenChat } from '@/platform/lib/data/chat-gate'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import {
  deniedSurfaceHref,
  followProductRoute,
  productLocation,
} from '@/platform/lib/data/route-resolution'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

interface LiveChatRouteProps {
  chatId?: string
  searchParams: Record<string, string | string[] | undefined>
}

/**
 * The legacy chat page's gates: route resolution sends a viewer without chat on, and an Assistant
 * chat opens under Search.
 */
export async function LiveChatRoute({ chatId, searchParams }: LiveChatRouteProps) {
  const surface = await readOrganizationSurface()
  // A tab left open on an organization the viewer has left, such as a retired personal one.
  if (surface.status === 'denied') {
    const href = deniedSurfaceHref(surface.retired)
    if (href) redirect(href)
    notFound()
  }
  if (surface.status !== 'ok') return null
  const { organization } = surface
  await followProductRoute(
    organization,
    productLocation(
      surfaceHref(organization, chatId ? `/chat/${encodeURIComponent(chatId)}` : '/chat'),
      searchParams
    )
  )
  const entry = chatId ? await readOpenChat(chatId, organization.organization.id) : null
  if (chatId && !entry) notFound()
  if (entry?.mode === 'assistant') redirect(surfaceHref(organization, `/search/chat/${chatId}`))
  return (
    <ChatScreen>
      <LiveChat chat={entry?.chat} destination='agent' />
    </ChatScreen>
  )
}
