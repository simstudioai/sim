import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getAccessibleCopilotChatAuth } from '@/lib/mothership/chat/lifecycle'
import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import OrganizationChatLoading from '@/app/o/[organizationId]/chat/[chatId]/loading'
import { OrganizationConversation } from '@/app/o/[organizationId]/components/organization-conversation'
import { getOrganizationHomeRedirect } from '@/app/o/[organizationId]/home/home-redirect'

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
  if (!context.mothershipAvailable || (!context.canBuild && !context.searchAccess.memberScoped)) {
    const unavailableRedirect = getOrganizationHomeRedirect(context, organizationId)
    if (unavailableRedirect) redirect(unavailableRedirect)
  }
  const chat = await getAccessibleCopilotChatAuth(chatId, session.user.id, {
    principal: { kind: 'session', userId: session.user.id, sessionId: session.session.id },
  })
  if (!chat || chat.type !== 'mothership' || chat.organizationId !== organizationId) notFound()
  if (chat.mode === 'assistant') {
    if (!context.searchAccess.memberScoped) redirect(WORKSPACE_SETTINGS_PATH)
    redirect(organizationRoutes(organizationId).searchChat(chatId))
  }
  const homeRedirect = getOrganizationHomeRedirect(context, organizationId)
  if (homeRedirect) redirect(homeRedirect)

  return (
    <Suspense fallback={<OrganizationChatLoading />}>
      <OrganizationConversation
        userName={session.user.name ?? undefined}
        chatId={chatId}
        requestMode={chat.mode}
      />
    </Suspense>
  )
}
