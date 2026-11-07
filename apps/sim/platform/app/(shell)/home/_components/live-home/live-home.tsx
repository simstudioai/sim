'use client'

import { useInterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import { ZoneHomeDashboard } from '@/platform/app/(shell)/home/_components/home-dashboard/zone-home-dashboard'
import { useHomeHydrated, useLiveHome } from '@/platform/lib/data/home'

function HydratedHome() {
  const preferences = useInterfacePreferences()
  const { view, actions } = useLiveHome(
    preferences?.homeMode === 'Search',
    preferences?.hiddenWidgets ?? []
  )
  return <ZoneHomeDashboard view={view} actions={actions} />
}

/**
 * The live implementation of Home's view. Fixture sessions never mount it or its reads. Its dates are
 * in the viewer's zone, which the server cannot render, so it mounts after hydration and paints
 * nothing before. A client navigation is already hydrated and renders it at once.
 */
export function LiveHome() {
  return useHomeHydrated() ? <HydratedHome /> : null
}
