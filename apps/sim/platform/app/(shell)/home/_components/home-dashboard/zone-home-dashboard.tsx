'use client'

import type { HomeMode } from '@/platform/app/(shell)/_components/model'
import { useInterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import { HomeComposer } from '@/platform/app/(shell)/home/_components/home-composer/home-composer'
import { HomeDashboard } from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard'
import type { HomeActions, HomeView } from '@/platform/app/(shell)/home/_components/model'

const PROMPTS: Record<HomeMode, string> = {
  Build: 'What should we get done?',
  Search: 'Ask about your company’s knowledge.',
}

interface ZoneHomeDashboardProps {
  view: HomeView
  actions: HomeActions
}

/** Home inside this app's shell: the session's mode and hidden widgets, and its own composer. */
export function ZoneHomeDashboard({ view, actions }: ZoneHomeDashboardProps) {
  const preferences = useInterfacePreferences()
  if (!preferences) throw new Error('Home needs interface preferences')
  const { hiddenWidgets, setHiddenWidgets, profileName, homeMode, setHomeMode } = preferences
  const firstName = profileName?.split(/\s/u)[0] || view.firstName
  return (
    <HomeDashboard
      view={{ ...view, firstName }}
      actions={actions}
      mode={homeMode}
      prompt={PROMPTS[homeMode]}
      composer={
        <HomeComposer mode={homeMode} onModeChange={setHomeMode} references={view.references} />
      }
      hiddenWidgets={hiddenWidgets}
      onWidgetHiddenChange={(widget, hidden) =>
        setHiddenWidgets((current) =>
          hidden
            ? current.includes(widget)
              ? current
              : [...current, widget]
            : current.filter((item) => item !== widget)
        )
      }
    />
  )
}
