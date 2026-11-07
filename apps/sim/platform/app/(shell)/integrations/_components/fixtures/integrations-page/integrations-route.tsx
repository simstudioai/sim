import { notFound } from 'next/navigation'
import { IntegrationsPage } from '@/platform/app/(shell)/integrations/_components/fixtures/integrations-page/integrations-page'
import {
  loadIntegrationCatalogEntry,
  loadIntegrationCenterData,
  loadIntegrationsData,
} from '@/platform/fixtures'
import { readScenario } from '@/platform/lib/navigation'

interface IntegrationsRouteProps {
  section?: string
  searchParams: PageProps<'/integrations'>['searchParams']
}

export async function IntegrationsRoute({ section, searchParams }: IntegrationsRouteProps) {
  const query = await searchParams
  const scenario = readScenario(query.state)
  const [data, center, catalog] = await Promise.all([
    loadIntegrationsData(scenario, query.secrets),
    loadIntegrationCenterData(scenario),
    loadIntegrationCatalogEntry(scenario, section),
  ])
  if (
    section &&
    !(section === 'secrets' && data?.genericSecrets) &&
    !data?.integrations.some((item) => item.providerId === section)
  )
    notFound()
  return <IntegrationsPage data={data} center={center} section={section} catalog={catalog} />
}
