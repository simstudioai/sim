import { notFound, redirect } from 'next/navigation'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { readScenario } from '@/platform/lib/navigation'

export default async function IntegrationsSection({
  organization,
  subpath,
  query,
}: SettingsSectionProps) {
  if (!organization.viewer.isAdmin) notFound()
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const [{ SourcesView }, { loadSourceSettings }] = await Promise.all([
      import(
        '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/sources-view'
      ),
      import('@/platform/fixtures'),
    ])
    const inventory = await loadSourceSettings(readScenario(query.state))
    if (
      subpath[0] === 'providers' &&
      !inventory.sources.some(
        (source) => source.id === subpath[1] && source.supportedModes.includes('service_account')
      )
    )
      notFound()
    return <SourcesView initial={inventory} subpath={subpath} />
  }
  return <LiveIntegrationsSection organization={organization} subpath={subpath} query={query} />
}

/**
 * Sources, a provider's connections, one connection and the organization's Generic Secrets, on live
 * data. Loaded on demand: the live readers import the database, which a fixture build runs without.
 */
async function LiveIntegrationsSection({
  organization,
  subpath,
  query,
}: Omit<SettingsSectionProps, 'fixture'>) {
  const sourcesHref = surfaceHref(organization, '/settings/integrations')
  const [kind, id] = subpath
  if (kind === 'secrets') {
    const { readGenericSecretSourceMode } = await import(
      '@/platform/lib/data/generic-secrets-source'
    )
    if ((await readGenericSecretSourceMode(organization.organization.id)) !== 'organization')
      redirect(sourcesHref)
    const { SecretsEditor } = await import(
      '@/app/(product)/_components/secrets-editor/secrets-editor'
    )
    return (
      <SecretsEditor
        scope={{ kind: 'organization', organizationId: organization.organization.id }}
      />
    )
  }
  if (kind === 'providers') {
    const { resolveProviderRoute } = await import(
      '@/platform/lib/data/search-sources/provider-route'
    )
    const route = resolveProviderRoute(id, query)
    if (route.kind === 'not-found') notFound()
    if (route.kind === 'sources') redirect(sourcesHref)
    if (route.kind === 'people')
      redirect(`${surfaceHref(organization, '/settings/connected-accounts')}?tab=people`)
    const { ProviderDetail } = await import(
      '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/provider-detail'
    )
    return <ProviderDetail connectorType={id} />
  }
  if (kind === 'sources') {
    const { SourceDetail } = await import(
      '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/source-detail'
    )
    return <SourceDetail connectorId={id} />
  }
  const { LiveSources } = await import(
    '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/live-sources'
  )
  return <LiveSources />
}
