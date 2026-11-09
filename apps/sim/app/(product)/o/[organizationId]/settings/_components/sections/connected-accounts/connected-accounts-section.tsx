import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { FixtureCredentialGroups } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/fixture-credential-groups'
import { LiveCredentialGroups } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/live-credential-groups'
import { loadCredentialGroupsData } from '@/platform/fixtures'
import { readScenario } from '@/platform/lib/navigation'

export default async function ConnectedAccountsSection({
  organization,
  fixture,
  query,
}: SettingsSectionProps) {
  if (fixture) {
    const data = await loadCredentialGroupsData(readScenario(query.state))
    return data && <FixtureCredentialGroups data={data} />
  }
  const organizationId = organization.organization.id
  const tab = typeof query.tab === 'string' ? query.tab : 'providers'
  const { readCredentialGroups } = await import('@/platform/lib/data/credential-groups')
  const { data, management } = await readCredentialGroups(organizationId, tab, query)
  return (
    <LiveCredentialGroups organizationId={organizationId} data={data} management={management} />
  )
}
