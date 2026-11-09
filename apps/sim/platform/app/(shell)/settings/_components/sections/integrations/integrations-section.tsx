import { notFound, redirect } from 'next/navigation'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { OrganizationSources } from '@/platform/app/(shell)/settings/_components/sections/integrations/organization-sources'
import { SourcesView } from '@/platform/app/(shell)/settings/_components/sections/integrations/sources-view'
import { loadSourceSettings } from '@/platform/fixtures'
import { legacyRoutes } from '@/platform/lib/data/organization-model'
import { readScenario } from '@/platform/lib/navigation'

export default async function IntegrationsSection({
  organization,
  subpath,
  query,
}: SettingsSectionProps) {
  if (!organization.viewer.isAdmin) notFound()
  const scenario = readScenario(query.state)
  const inventory = await loadSourceSettings(scenario)
  if (!inventory) {
    const manageHref = legacyRoutes(organization).settingsSection('integrations')
    if (subpath.length) redirect([manageHref, ...subpath.map(encodeURIComponent)].join('/'))
    const { readSourceSettings } = await import('@/platform/lib/data/source-settings')
    const data = await readSourceSettings(organization.organization.id)
    return (
      <OrganizationSources
        sources={data.sources}
        apps={data.apps}
        secret={data.secret}
        manageHref={manageHref}
      />
    )
  }
  if (
    subpath[0] === 'providers' &&
    !inventory.sources.some(
      (source) => source.id === subpath[1] && source.supportedModes.includes('service_account')
    )
  )
    notFound()
  return <SourcesView initial={inventory} subpath={subpath} />
}
