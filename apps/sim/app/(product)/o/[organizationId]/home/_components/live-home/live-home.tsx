'use client'

import { SavedAccountModal } from '@/app/(product)/_components/service-account-modal/saved-account-modal'
import { useInterfacePreferences } from '@/app/(product)/_components/session/interface-preferences'
import { ZoneHomeDashboard } from '@/app/(product)/o/[organizationId]/home/_components/home-dashboard/zone-home-dashboard'
import {
  type HiddenHomeWidgets,
  useHiddenHomeWidgets,
  useLiveHome,
} from '@/platform/lib/data/home'

function HydratedHome({ widgets }: { widgets: HiddenHomeWidgets }) {
  const preferences = useInterfacePreferences()
  const { view, actions, savedConnection } = useLiveHome(
    preferences?.homeMode === 'Search',
    widgets.hiddenWidgets
  )
  return (
    <>
      <ZoneHomeDashboard
        view={view}
        actions={actions}
        hiddenWidgets={widgets.hiddenWidgets}
        onWidgetHiddenChange={widgets.setWidgetHidden}
      />
      {savedConnection && (
        <SavedAccountModal
          organizationId={savedConnection.organizationId}
          connection={savedConnection.connection}
          onClose={savedConnection.close}
        />
      )}
    </>
  )
}

/**
 * The live implementation of Home's view. Fixture sessions never mount it or its reads. Its dates are
 * in the viewer's zone, which the server cannot render, so it mounts after hydration and paints
 * nothing before. It also waits for the viewer's Customize Home choices, so a widget they hid never
 * reads. A client navigation already has both and renders it at once.
 */
export function LiveHome() {
  const widgets = useHiddenHomeWidgets()
  return widgets ? <HydratedHome widgets={widgets} /> : null
}
