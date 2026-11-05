import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { CredentialGroups } from '@/platform/app/(shell)/settings/_components/sections/connected-accounts/credential-groups'
import { readScenario } from '@/platform/design-system/navigation'
import { loadCredentialGroupsData } from '@/platform/fixtures'
import { readCredentialGroups } from '@/platform/lib/data/credential-groups'
import { legacyRoutes } from '@/platform/lib/data/organization-model'

export default async function ConnectedAccountsSection({
  organization,
  fixture,
  query,
}: SettingsSectionProps) {
  const tab = typeof query.tab === 'string' ? query.tab : 'providers'
  const data = fixture
    ? await loadCredentialGroupsData(readScenario(query.state))
    : await readCredentialGroups(organization.organization.id, tab, query)
  if (!data) return null
  return (
    <CredentialGroups
      data={data}
      editable={Boolean(fixture)}
      managementHref={legacyRoutes(organization).settingsSection('connected-accounts')}
    />
  )
}
