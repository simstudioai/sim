import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getAccessibleCopilotChatAuth } from '@/lib/mothership/chat/lifecycle'
import { WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { OrganizationHome } from '@/app/o/[organizationId]/home/organization-home'
import OrganizationSearchLoading from '@/app/o/[organizationId]/search/loading'
import { OrganizationSearch } from '@/app/o/[organizationId]/search/search'

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
  if (!context.mothershipAvailable && !context.searchAccess.memberScoped)
    redirect(WORKSPACE_SETTINGS_PATH)
  const chat = await getAccessibleCopilotChatAuth(chatId, session.user.id, {
    principal: { kind: 'session', userId: session.user.id, sessionId: session.session.id },
  })
  if (!chat || chat.type !== 'mothership' || chat.organizationId !== organizationId) notFound()
  if (chat.mode === 'assistant') {
    if (!context.searchAccess.memberScoped) redirect(WORKSPACE_SETTINGS_PATH)
    return (
      <Suspense fallback={<OrganizationSearchLoading />}>
        <OrganizationSearch userName={session.user.name ?? undefined} chatId={chatId} />
      </Suspense>
    )
  }
  if (!context.mothershipAvailable) redirect(WORKSPACE_SETTINGS_PATH)
  return (
    <Suspense fallback={<OrganizationSearchLoading />}>
      <OrganizationHome
        userName={session.user.name ?? undefined}
        chatId={chatId}
        requestMode='agent'
      />
    </Suspense>
  )
}
