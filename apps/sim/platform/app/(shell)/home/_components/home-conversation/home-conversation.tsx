'use client'

import { OrganizationConversation } from '@/app/o/[organizationId]/components/organization-conversation'
import { HomeDashboardSkeleton } from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard-skeleton'
import { LiveHome } from '@/platform/app/(shell)/home/_components/live-home/live-home'

/** Search's Assistant keeps its own unsent question; the agent composer keeps the default `home` key. */
const HOME_ASSISTANT_DRAFT_ID = 'home-assistant'

interface HomeConversationProps {
  requestMode: 'agent' | 'assistant'
}

/** The real conversation, landing on the dashboard until the first turn takes over. */
export function HomeConversation({ requestMode }: HomeConversationProps) {
  return (
    <OrganizationConversation
      requestMode={requestMode}
      draftId={requestMode === 'assistant' ? HOME_ASSISTANT_DRAFT_ID : undefined}
      landing={{
        fallback: <HomeDashboardSkeleton requestMode={requestMode} />,
        render: (slot) => <LiveHome {...slot} />,
      }}
    />
  )
}
