'use client'

import { createContext, memo, type ReactNode, useContext } from 'react'
import type { OrganizationLandingSlot } from '@/app/o/[organizationId]/components/organization-conversation'
import { HomeDashboard } from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard'
import { useLiveHome } from '@/platform/lib/data/home'

const ComposerSlot = createContext<ReactNode>(null)

function ComposerOutlet() {
  return useContext(ComposerSlot)
}

/** The conversation re-renders on every keystroke; through context, only its composer follows. */
const LiveDashboard = memo(function LiveDashboard({
  requestMode,
}: Pick<OrganizationLandingSlot, 'requestMode'>) {
  const { view, actions } = useLiveHome(requestMode === 'assistant')
  return (
    <HomeDashboard
      view={view}
      actions={actions}
      requestMode={requestMode}
      composer={<ComposerOutlet />}
    />
  )
})

export function LiveHome({ requestMode, composer }: OrganizationLandingSlot) {
  return (
    <ComposerSlot.Provider value={composer}>
      <LiveDashboard requestMode={requestMode} />
    </ComposerSlot.Provider>
  )
}
