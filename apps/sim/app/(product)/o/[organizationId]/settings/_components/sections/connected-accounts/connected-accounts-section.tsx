import { HydrationBoundary } from '@tanstack/react-query'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { LiveCredentialGroups } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/live-credential-groups'
import { readScenario } from '@/platform/lib/navigation'

export default async function ConnectedAccountsSection({
  organization,
  query,
}: SettingsSectionProps) {
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const [{ FixtureCredentialGroups }, { loadCredentialGroupsData }] = await Promise.all([
      import(
        '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/fixture-credential-groups'
      ),
      import('@/platform/fixtures'),
    ])
    const data = await loadCredentialGroupsData(readScenario(query.state))
    return (
      <>
        <SettingsPageHeader />
        <FixtureCredentialGroups data={data} />
      </>
    )
  }
  const organizationId = organization.organization.id
  const tab = typeof query.tab === 'string' ? query.tab : 'providers'
  const { readCredentialGroups } = await import('@/platform/lib/data/credential-groups')
  const { data, management, state } = await readCredentialGroups(organizationId, tab, query)
  return (
    <>
      <SettingsPageHeader />
      <HydrationBoundary state={state}>
        <LiveCredentialGroups organizationId={organizationId} data={data} management={management} />
      </HydrationBoundary>
    </>
  )
}
