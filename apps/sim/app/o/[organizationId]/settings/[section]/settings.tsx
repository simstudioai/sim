'use client'

import dynamic from 'next/dynamic'
import {
  ORGANIZATION_SETTINGS_ITEMS,
  type OrganizationSettingsSection,
} from '@/components/settings/navigation'
import { SettingsSectionProvider } from '@/components/settings/settings-panel'

const OrganizationSearchSlack = dynamic(() =>
  import('@/app/o/[organizationId]/settings/components/organization-search-slack').then(
    (m) => m.OrganizationSearchSlack
  )
)

interface OrganizationSettingsProps {
  section: OrganizationSettingsSection
}

export function OrganizationSettings({ section }: OrganizationSettingsProps) {
  const meta = ORGANIZATION_SETTINGS_ITEMS.find(({ id }) => id === section)

  return (
    <SettingsSectionProvider section={section} meta={meta}>
      {section === 'search-slack' && <OrganizationSearchSlack />}
    </SettingsSectionProvider>
  )
}
