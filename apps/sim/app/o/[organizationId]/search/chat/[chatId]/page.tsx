import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getAccessibleCopilotChatAuth } from '@/lib/mothership/chat/lifecycle'
import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { requireOrganizationViewer } from '@/app/o/[organizationId]/viewer'
import { ConversationSkeleton } from '@/platform/app/(shell)/_components/conversation/skeletons'
import { OrganizationSearchSurface } from '@/platform/app/(shell)/search/_components/search-surface/search-surface'

export const metadata: Metadata = { title: 'Assistant Search' }

export default async function OrganizationSearchChatPage({
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
    organizationRoutes(organizationId).searchChat(chatId)
  )
  if (!context.searchAccess.memberScoped) redirect(WORKSPACE_SETTINGS_PATH)
  if (!context.mothershipAvailable) redirect(organizationRoutes(organizationId).search)
  const chat = await getAccessibleCopilotChatAuth(chatId, userId, { principal })
  if (!chat || chat.type !== 'mothership' || chat.organizationId !== organizationId) notFound()
  if (chat.mode !== 'assistant') redirect(organizationRoutes(organizationId).chat(chatId))
  return (
    <Suspense fallback={<ConversationSkeleton header={null} />}>
      <OrganizationSearchSurface userId={userId} chatId={chatId} />
    </Suspense>
  )
}
