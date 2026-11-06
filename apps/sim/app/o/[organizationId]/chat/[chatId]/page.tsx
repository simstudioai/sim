import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getAccessibleCopilotChatAuth } from '@/lib/mothership/chat/lifecycle'
import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import OrganizationChatLoading from '@/app/o/[organizationId]/chat/[chatId]/loading'
import {
  canUseOrganizationChat,
  getOrganizationBuildRedirect,
} from '@/app/o/[organizationId]/home/home-redirect'
import { requireOrganizationViewer } from '@/app/o/[organizationId]/viewer'
import { ChatRoute } from '@/platform/app/(shell)/_components/conversation/chat-route'

export const metadata: Metadata = { title: 'Chat' }

export default async function OrganizationChatPage({
  params,
}: {
  params: Promise<{ organizationId: string; chatId: string }>
}) {
  const { organizationId, chatId } = await params
  const {
    userId,
    principal,
    surface: context,
  } = await requireOrganizationViewer(
    organizationId,
    organizationRoutes(organizationId).chat(chatId)
  )
  if (!canUseOrganizationChat(context)) {
    const unavailableRedirect = getOrganizationBuildRedirect(context, organizationId)
    if (unavailableRedirect) redirect(unavailableRedirect)
  }
  const chat = await getAccessibleCopilotChatAuth(chatId, userId, { principal })
  if (!chat || chat.type !== 'mothership' || chat.organizationId !== organizationId) notFound()
  if (chat.mode === 'assistant') {
    if (!context.searchAccess.memberScoped) redirect(WORKSPACE_SETTINGS_PATH)
    redirect(organizationRoutes(organizationId).searchChat(chatId))
  }
  const buildRedirect = getOrganizationBuildRedirect(context, organizationId)
  if (buildRedirect) redirect(buildRedirect)

  return (
    <Suspense fallback={<OrganizationChatLoading />}>
      <ChatRoute chatId={chatId} requestMode={chat.mode} />
    </Suspense>
  )
}
