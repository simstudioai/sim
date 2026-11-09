'use client'

import { SegmentedControl } from '@sim/emcn/segmented-control'
import type { HomeWidget } from '@/app/(product)/_components/model'
import { useInterfacePreferences } from '@/app/(product)/_components/session/interface-preferences'
import { HomeComposer } from '@/app/(product)/o/[organizationId]/home/_components/home-composer/home-composer'
import { HomeDashboard } from '@/app/(product)/o/[organizationId]/home/_components/home-dashboard/home-dashboard'
import type {
  HomeActions,
  HomeView,
} from '@/app/(product)/o/[organizationId]/home/_components/model'

const PROMPT = 'Your company’s knowledge and work, connected by Sim.'

interface ZoneHomeDashboardProps {
  view: HomeView
  actions: HomeActions
  hiddenWidgets: readonly HomeWidget[]
  onWidgetHiddenChange: (widget: HomeWidget, hidden: boolean) => void
}

/**
 * Home inside this app's shell: the session's mode and its own composer. Hidden widgets come from the
 * host, which decides how long a Customize Home choice lasts.
 */
export function ZoneHomeDashboard({
  view,
  actions,
  hiddenWidgets,
  onWidgetHiddenChange,
}: ZoneHomeDashboardProps) {
  const preferences = useInterfacePreferences()
  if (!preferences) throw new Error('Home needs interface preferences')
  const { profileName, homeMode, setHomeMode } = preferences
  const firstName = profileName?.split(/\s/u)[0] || view.firstName
  return (
    <HomeDashboard
      view={{ ...view, firstName }}
      actions={actions}
      mode={homeMode}
      prompt={PROMPT}
      composer={<HomeComposer mode={homeMode} inventory={view.composerInventory} />}
      composerActions={
        <SegmentedControl
          label='Mode'
          options={[
            { value: 'Build', label: 'Build' },
            { value: 'Search', label: 'Search' },
          ]}
          value={homeMode}
          onSelect={setHomeMode}
        />
      }
      hiddenWidgets={hiddenWidgets}
      onWidgetHiddenChange={onWidgetHiddenChange}
    />
  )
}
