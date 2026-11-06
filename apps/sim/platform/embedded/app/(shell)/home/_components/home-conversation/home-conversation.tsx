'use client'

import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/client'
import { organizationRoutes } from '@/lib/navigation/paths'
import { HOME_ASSISTANT_DRAFT_SLOT, organizationDraftKey } from '@/lib/organizations/draft-key'
import { useOrganization } from '@/lib/organizations/provider'
import { PageConversation } from '@/platform/embedded/app/(shell)/_components/conversation/page-conversation'
import { HomeDashboardSkeleton } from '@/platform/embedded/app/(shell)/home/_components/home-dashboard/home-dashboard-skeleton'
import { LiveHome } from '@/platform/embedded/app/(shell)/home/_components/live-home/live-home'
import { SearchSurfaceHeader } from '@/platform/embedded/app/(shell)/search/_components/search-surface/search-surface-header'
import {
  SEARCH_MODES,
  useSearchViewHref,
  useStartNewConversation,
} from '@/platform/embedded/lib/data/organization-search'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'

interface HomeConversationProps {
  requestMode: 'agent' | 'assistant'
}

/** The real conversation, landing on the dashboard until the first turn takes over. */
export function HomeConversation({ requestMode }: HomeConversationProps) {
  const { organization } = useOrganization()
  const router = useRouter()
  const { data: session } = useSession()
  const { conversationInstance, isStartingNew, startNew, newChatLabel } = useStartNewConversation()
  const searchViewHref = useSearchViewHref()
  // An Assistant chat started here takes its Search address without leaving this page, so it carries
  // Search's controls itself, and they navigate rather than switch a view this page doesn't hold.
  const assistantChatHeader = (
    <SearchSurfaceHeader
      search={{
        activeMode: 'assistant',
        modes: [...SEARCH_MODES],
        changeMode: (mode) => {
          if (mode === 'search') router.push(searchViewHref)
        },
        newLabel: newChatLabel,
        canStartNew: true,
        isStartingNew,
        startNew: () =>
          startNew(organizationRoutes(organization.id).home, () =>
            useMothershipDraftsStore
              .getState()
              .clearDraft(
                organizationDraftKey(session?.user?.id, organization.id, HOME_ASSISTANT_DRAFT_SLOT)
              )
          ),
      }}
    />
  )
  return (
    <PageConversation
      key={conversationInstance}
      requestMode={requestMode}
      draftSlot={requestMode === 'assistant' ? HOME_ASSISTANT_DRAFT_SLOT : undefined}
      chatHeader={requestMode === 'assistant' ? assistantChatHeader : undefined}
      fallback={<HomeDashboardSkeleton />}
      landing={(slot) => <LiveHome {...slot} />}
    />
  )
}
