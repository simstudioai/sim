'use client'

import { organizationRoutes } from '@/lib/navigation/paths'
import { useCaptureWhenReady } from '@/hooks/use-capture-when-ready'
import { DetailHeader } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import {
  AccountSettingsRows,
  AccountSettingsSubview,
} from '@/platform/app/(shell)/settings/_components/sections/account/account-section'
import PreferencesSection from '@/platform/app/(shell)/settings/_components/sections/preferences/preferences-section'
import PrivacySection from '@/platform/app/(shell)/settings/_components/sections/privacy/privacy-section'
import { useAnonymousViewer } from '@/platform/lib/data/organization'

type GeneralView = 'privacy' | 'authorized-apps' | 'organization-accounts'

function generalHref(base: string, query: SettingsSectionProps['query'], view?: GeneralView) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (key === 'view' || key === 'search' || value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item)
  }
  if (view) params.set('view', view)
  return params.size ? `${base}?${params}` : base
}

export default function GeneralSection(props: SettingsSectionProps) {
  const { organization, query } = props
  const anonymous = useAnonymousViewer()
  useCaptureWhenReady('settings_tab_viewed', { plane: 'account', section: 'general' }, 'general')
  const base = organizationRoutes(organization.organization.id).settingsSection('general')
  const view = Array.isArray(query.view) ? query.view[0] : query.view
  if (view === 'privacy') {
    return (
      <>
        <DetailHeader
          backLabel='General'
          backHref={generalHref(base, query)}
          title='Privacy'
          description='Control what Sim collects about how you use it.'
        />
        <PrivacySection organization={organization} subpath={props.subpath} query={query} />
      </>
    )
  }
  if (!anonymous && (view === 'authorized-apps' || view === 'organization-accounts')) {
    return <AccountSettingsSubview view={view} backHref={generalHref(base, query)} />
  }
  return (
    <>
      <PreferencesSection />
      <AccountSettingsRows
        organization={organization}
        privacyHref={generalHref(base, query, 'privacy')}
        authorizedAppsHref={generalHref(base, query, 'authorized-apps')}
        organizationAccountsHref={generalHref(base, query, 'organization-accounts')}
      />
    </>
  )
}
