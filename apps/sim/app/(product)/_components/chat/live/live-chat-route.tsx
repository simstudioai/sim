import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { LiveChat } from '@/app/(product)/_components/chat/live/live-chat'
import { readChatMode } from '@/platform/lib/data/chat-gate'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

/** The legacy chat page's gates: the viewer may build, and an Assistant chat opens under Search. */
export async function LiveChatRoute({ chatId }: { chatId?: string }) {
  const surface = await readOrganizationSurface()
  if (surface.status !== 'ok') return null
  const { organization } = surface
  if (!organization.mothershipAvailable || !organization.canBuild)
    redirect(
      surfaceHref(organization, organization.searchAccess.memberScoped ? '/search' : '/settings')
    )
  if (chatId) {
    const mode = await readChatMode(chatId, organization.organization.id)
    if (!mode) notFound()
    if (mode === 'assistant') redirect(surfaceHref(organization, `/search/chat/${chatId}`))
  }
  return <LiveChat chatId={chatId} destination='agent' />
}
