import { Button } from '@sim/emcn/button'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import Link from 'next/link'
import { DetailHeader } from '@/app/(product)/_components/settings-parts/settings-parts'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import {
  AccountSettingsRows,
  AccountSettingsSubview,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/account/account-section'
import PreferencesSection from '@/app/(product)/o/[organizationId]/settings/_components/sections/preferences/preferences-section'
import PrivacySection from '@/app/(product)/o/[organizationId]/settings/_components/sections/privacy/privacy-section'
import { type SurfaceScope, surfaceHref } from '@/platform/lib/data/organization-model'

type GeneralView = 'privacy' | 'authorized-apps' | 'organization-accounts'

function generalHref(
  scope: SurfaceScope,
  query: SettingsSectionProps['query'],
  view?: GeneralView
) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (key === 'view' || value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item)
  }
  if (view) params.set('view', view)
  const path = surfaceHref(scope, '/settings/general')
  return params.size ? `${path}?${params}` : path
}

export default function GeneralSection(props: SettingsSectionProps) {
  const { organization, query, fixture } = props
  const view = Array.isArray(query.view) ? query.view[0] : query.view
  if (view === 'privacy') {
    return (
      <>
        <DetailHeader
          backLabel='General'
          backHref={generalHref(organization, query)}
          title='Privacy'
        />
        <PrivacySection
          organization={organization}
          subpath={props.subpath}
          query={query}
          fixture={fixture}
        />
      </>
    )
  }
  if (
    !organization.navFlags.anonymous &&
    (view === 'authorized-apps' || view === 'organization-accounts')
  ) {
    return (
      <AccountSettingsSubview
        organization={organization}
        view={view}
        backHref={generalHref(organization, query)}
      />
    )
  }
  return (
    <>
      <PreferencesSection fixture={fixture} />
      <SettingsSection title='Privacy'>
        <SettingsRow label='Privacy settings'>
          <Button
            size='compact'
            render={<Link href={generalHref(organization, query, 'privacy')} />}
          >
            Manage
          </Button>
        </SettingsRow>
      </SettingsSection>
      <AccountSettingsRows
        actionsUnavailable={fixture}
        organization={organization}
        authorizedAppsHref={generalHref(organization, query, 'authorized-apps')}
        organizationAccountsHref={generalHref(organization, query, 'organization-accounts')}
      />
    </>
  )
}
