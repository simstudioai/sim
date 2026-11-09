'use client'

import type { HomeWidget } from '@/app/(product)/_components/model'
import { SavedAccountModal } from '@/app/(product)/_components/service-account-modal/saved-account-modal'
import { useInterfacePreferences } from '@/app/(product)/_components/session/interface-preferences'
import { ZoneHomeDashboard } from '@/app/(product)/o/[organizationId]/home/_components/home-dashboard/zone-home-dashboard'
import { useHydrated } from '@/hooks/use-hydrated'
import { useHiddenHomeWidgets, useLiveHome } from '@/platform/lib/data/home'

/** Until the viewer's Customize Home choices are known, every widget they could hide stays unread. */
const UNKNOWN_CHOICES: readonly HomeWidget[] = ['Activity', 'Email', 'Calendar']

function keepChoices() {}

/**
 * The live implementation of Home's view. Fixture sessions never mount it or its reads. The heading,
 * composer and Recents render at once. What the server cannot render waits for hydration: the
 * greeting is in the viewer's zone, and attention ages count from the viewer's clock. The widgets a
 * viewer can hide wait for their Customize Home choices, so a widget they hid never reads.
 */
export function LiveHome() {
  const hydrated = useHydrated()
  const widgets = useHiddenHomeWidgets()
  const preferences = useInterfacePreferences()
  const hiddenWidgets = widgets?.hiddenWidgets ?? UNKNOWN_CHOICES
  const { view, actions, savedConnection } = useLiveHome(
    preferences?.homeMode === 'Search',
    hiddenWidgets
  )
  return (
    <>
      <ZoneHomeDashboard
        view={hydrated ? view : { ...view, greeting: '', attention: { status: 'loading' } }}
        actions={actions}
        hiddenWidgets={hiddenWidgets}
        onWidgetHiddenChange={widgets?.setWidgetHidden ?? keepChoices}
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
