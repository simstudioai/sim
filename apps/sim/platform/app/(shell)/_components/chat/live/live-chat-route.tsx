import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { LiveChat } from '@/platform/app/(shell)/_components/chat/live/live-chat'
import { readChatMode } from '@/platform/lib/data/chat-gate'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

/** The legacy chat page's gates: the viewer may build, and an Assistant chat opens under Search. */
export async function LiveChatRoute({ chatId }: { chatId?: string }) {
  const surface = await readOrganizationSurface()
  if (surface.status !== 'ok') return null
  const { organization } = surface
  if (!organization.mothershipAvailable || !organization.canBuild)
    redirect(organization.searchAccess.memberScoped ? '/search' : '/settings')
  if (chatId) {
    const mode = await readChatMode(chatId)
    if (!mode) notFound()
    if (mode === 'assistant') redirect(`/search/chat/${chatId}`)
  }
  return <LiveChat chatId={chatId} destination='agent' />
}
