import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { CredentialGroups } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/credential-groups'
import { loadCredentialGroupsData } from '@/platform/fixtures'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { readScenario } from '@/platform/lib/navigation'

export default async function ConnectedAccountsSection({
  organization,
  fixture,
  query,
}: SettingsSectionProps) {
  const tab = typeof query.tab === 'string' ? query.tab : 'providers'
  const data = fixture
    ? await loadCredentialGroupsData(readScenario(query.state))
    : await import('@/platform/lib/data/credential-groups').then(({ readCredentialGroups }) =>
        readCredentialGroups(organization.organization.id, tab, query)
      )
  if (!data) return null
  return (
    <CredentialGroups
      data={data}
      editable={Boolean(fixture)}
      managementHref={surfaceHref(organization, '/settings/connected-accounts')}
    />
  )
}
