'use client'

import { useInterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import { HomeDashboard } from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard'
import { useLiveHome } from '@/platform/lib/data/home'

/** The live implementation of Home's view. Fixture sessions never mount it or its reads. */
export function LiveHome() {
  const homeMode = useInterfacePreferences()?.homeMode ?? 'Build'
  const { view, actions } = useLiveHome(homeMode)
  return <HomeDashboard view={view} actions={actions} />
}
