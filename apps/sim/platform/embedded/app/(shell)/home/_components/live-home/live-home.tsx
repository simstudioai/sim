'use client'

import type { ConversationLandingSlot } from '@/platform/embedded/app/(shell)/_components/conversation/page-conversation'
import { HomeDashboard } from '@/platform/embedded/app/(shell)/home/_components/home-dashboard/home-dashboard'
import { useLiveHome } from '@/platform/embedded/lib/data/home'

export function LiveHome({ requestMode, composer }: ConversationLandingSlot) {
  const { view, actions } = useLiveHome(requestMode === 'assistant')
  return (
    <HomeDashboard view={view} actions={actions} requestMode={requestMode} composer={composer} />
  )
}
