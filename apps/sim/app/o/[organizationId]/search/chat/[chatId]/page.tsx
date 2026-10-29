import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getAccessibleCopilotChatAuth } from '@/lib/mothership/chat/lifecycle'
import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { OrganizationSearch } from '@/app/o/[organizationId]/search/search'
import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'

export const metadata: Metadata = { title: 'Assistant Search' }

export default async function OrganizationSearchChatPage({
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
  if (!context.mothershipAvailable) redirect(organizationRoutes(organizationId).search)
  const chat = await getAccessibleCopilotChatAuth(chatId, session.user.id, {
    principal: { kind: 'session', userId: session.user.id, sessionId: session.session.id },
  })
  if (!chat || chat.type !== 'mothership' || chat.organizationId !== organizationId) notFound()
  if (chat.mode !== 'assistant') redirect(organizationRoutes(organizationId).chat(chatId))
  return (
    <Suspense fallback={<HomeFallback />}>
      <OrganizationSearch userId={session.user.id} chatId={chatId} />
    </Suspense>
  )
}
