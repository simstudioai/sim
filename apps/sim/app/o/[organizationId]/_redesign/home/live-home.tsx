'use client'

import { createContext, memo, type ReactNode, useContext } from 'react'
import { useSession } from '@/lib/auth/client'
import type { OrganizationLandingSlot } from '@/app/o/[organizationId]/components/organization-conversation'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'
import { HomeDashboard } from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard'
import { useLiveHome } from '@/platform/lib/data/home'
import {
  type OrganizationHomeWidget,
  useOrganizationHomeStore,
} from '@/stores/organization-home/store'

const NO_WIDGETS: readonly OrganizationHomeWidget[] = []
const COMPOSER_PROMPTS: Record<ChatRequestMode, string> = {
  agent: 'What should we get done?',
  plan: 'What should we understand and plan?',
  assistant: 'Ask about your company’s knowledge.',
}

const ComposerSlot = createContext<ReactNode>(null)

function ComposerOutlet() {
  return useContext(ComposerSlot)
}

/** The conversation re-renders on every keystroke; through context, only its composer follows. */
const LiveDashboard = memo(function LiveDashboard({
  requestMode,
}: Pick<OrganizationLandingSlot, 'requestMode'>) {
  const { organization } = useOrganizationContext()
  const { data: session } = useSession()
  const viewer = `${session?.user?.id}:${organization.id}`
  const hiddenWidgets = useOrganizationHomeStore(
    (state) => state.hiddenWidgets[viewer] ?? NO_WIDGETS
  )
  const setWidgetHidden = useOrganizationHomeStore((state) => state.setWidgetHidden)
  const { view, actions } = useLiveHome(requestMode === 'assistant', hiddenWidgets)
  return (
    <HomeDashboard
      view={view}
      actions={actions}
      mode='Build'
      prompt={COMPOSER_PROMPTS[requestMode]}
      composer={<ComposerOutlet />}
      hiddenWidgets={hiddenWidgets}
      onWidgetHiddenChange={(widget, hidden) => setWidgetHidden(viewer, widget, hidden)}
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
