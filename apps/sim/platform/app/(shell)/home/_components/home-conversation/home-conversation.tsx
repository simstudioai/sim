'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import { OrganizationConversation } from '@/app/o/[organizationId]/components/organization-conversation'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { SEARCH_MODES } from '@/app/o/[organizationId]/search/use-organization-search'
import { HomeDashboardSkeleton } from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard-skeleton'
import { LiveHome } from '@/platform/app/(shell)/home/_components/live-home/live-home'
import { SearchSurfaceHeader } from '@/platform/app/(shell)/search/_components/search-surface/search-surface-header'

/** Search's Assistant keeps its own unsent question; the agent composer keeps the default `home` key. */
const HOME_ASSISTANT_DRAFT_ID = 'home-assistant'

interface HomeConversationProps {
  requestMode: 'agent' | 'assistant'
}

/** The real conversation, landing on the dashboard until the first turn takes over. */
export function HomeConversation({ requestMode }: HomeConversationProps) {
  const { organization } = useOrganizationContext()
  const router = useRouter()
  const routes = organizationRoutes(organization.id)
  const [conversationInstance, setConversationInstance] = useState(0)
  const [isStartingNew, startNewTransition] = useTransition()
  // An Assistant chat started here takes its Search address without leaving this page, so it carries
  // Search's controls itself, and they navigate rather than switch a view this page doesn't hold.
  const assistantChatHeader = (
    <SearchSurfaceHeader
      search={{
        activeMode: 'assistant',
        modes: [...SEARCH_MODES],
        changeMode: (mode) => {
          if (mode === 'search') router.push(`${routes.search}?mode=search`)
        },
        newLabel: 'New chat',
        canStartNew: true,
        isStartingNew,
        startNew: () =>
          startNewTransition(() => {
            setConversationInstance((current) => current + 1)
            router.push(routes.home, { scroll: false })
          }),
      }}
    />
  )
  return (
    <OrganizationConversation
      key={conversationInstance}
      requestMode={requestMode}
      draftId={requestMode === 'assistant' ? HOME_ASSISTANT_DRAFT_ID : undefined}
      landing={{
        chatHeader: requestMode === 'assistant' ? assistantChatHeader : undefined,
        fallback: <HomeDashboardSkeleton requestMode={requestMode} />,
        render: (slot) => <LiveHome {...slot} />,
      }}
    />
  )
}
