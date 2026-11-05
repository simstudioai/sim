'use client'

import type { OrganizationLandingSlot } from '@/app/o/[organizationId]/components/organization-conversation'
import { HomeDashboard } from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard'
import { useLiveHome } from '@/platform/lib/data/home'

/** Home's dashboard on live data, around the conversation's own composer. */
export function LiveHome({ requestMode, composer, shortcuts }: OrganizationLandingSlot) {
  const assistant = requestMode === 'assistant'
  const { view, actions } = useLiveHome(assistant)
  return (
    <HomeDashboard
      view={view}
      actions={actions}
      requestMode={requestMode}
      composer={composer}
      shortcuts={assistant ? undefined : shortcuts}
    />
  )
}
