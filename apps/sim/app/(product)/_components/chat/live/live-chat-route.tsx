import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { ChatScreen } from '@/app/(product)/_components/chat/conversation/chat-screen'
import { LiveChat } from '@/app/(product)/_components/chat/live/live-chat'
import { readOpenChat } from '@/platform/lib/data/chat-gate'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

/** The legacy chat page's gates: the viewer may build, and an Assistant chat opens under Search. */
export async function LiveChatRoute({ chatId }: { chatId?: string }) {
  const surface = await readOrganizationSurface()
  // A tab left open on an organization the viewer has left, such as a retired personal one.
  if (surface.status === 'denied') notFound()
  if (surface.status !== 'ok') return null
  const { organization } = surface
  if (!organization.mothershipAvailable || !organization.canBuild)
    redirect(
      surfaceHref(organization, organization.searchAccess.memberScoped ? '/search' : '/settings')
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
