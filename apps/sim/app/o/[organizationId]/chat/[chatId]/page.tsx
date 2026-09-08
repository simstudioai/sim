import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getAccessibleCopilotChatAuth } from '@/lib/copilot/chat/lifecycle'
import { WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { OrganizationHome } from '@/app/o/[organizationId]/home/organization-home'

export const metadata: Metadata = { title: 'Chat' }

export default async function OrganizationChatPage({
  params,
}: {
  params: Promise<{ organizationId: string; chatId: string }>
}) {
  const { organizationId, chatId } = await params
  const session = await getSession()
  if (!session?.user?.id) notFound()
  const context = await getOrganizationSurfaceContext(organizationId, session.user.id)
  if (!context) notFound()
  if (!context.searchAccess.memberScoped) redirect(WORKSPACE_SETTINGS_PATH)
  const chat = await getAccessibleCopilotChatAuth(chatId, session.user.id, {
    principal: { kind: 'session', userId: session.user.id, sessionId: session.session.id },
  })
  if (!chat || chat.type !== 'mothership' || chat.organizationId !== organizationId) notFound()
  return <OrganizationHome userName={session.user.name ?? undefined} chatId={chatId} />
}
