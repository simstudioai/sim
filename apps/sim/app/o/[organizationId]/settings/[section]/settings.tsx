'use client'

import dynamic from 'next/dynamic'
import {
  ORGANIZATION_SETTINGS_ITEMS,
  type OrganizationSettingsSection,
} from '@/components/settings/navigation'
import { SettingsSectionProvider } from '@/components/settings/settings-panel'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'

const OrganizationIntegrationsSettings = dynamic(() =>
  import(
    '@/app/o/[organizationId]/settings/components/integrations/organization-integrations-settings'
  ).then((m) => m.OrganizationIntegrationsSettings)
)
const OrganizationConnectedAccounts = dynamic(() =>
  import('@/ee/credential-groups/components/organization-connected-accounts').then(
    (m) => m.OrganizationConnectedAccounts
  )
)
const OrganizationSearchSlack = dynamic(() =>
  import('@/app/o/[organizationId]/settings/components/organization-search-slack').then(
    (m) => m.OrganizationSearchSlack
  )
)

interface OrganizationSettingsProps {
  section: OrganizationSettingsSection
}

export function OrganizationSettings({ section }: OrganizationSettingsProps) {
  const { organization } = useOrganizationContext()
  const organizationId = organization.id
  const meta = ORGANIZATION_SETTINGS_ITEMS.find(({ id }) => id === section)

  return (
    <SettingsSectionProvider section={section} meta={meta}>
      {section === 'integrations' && <OrganizationIntegrationsSettings />}
      {section === 'connected-accounts' && (
        <OrganizationConnectedAccounts organizationId={organizationId} />
      )}
      {section === 'search-slack' && <OrganizationSearchSlack />}
    </SettingsSectionProvider>
  )
}
