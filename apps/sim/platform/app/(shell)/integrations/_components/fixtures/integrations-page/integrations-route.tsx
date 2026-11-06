import { notFound } from 'next/navigation'
import { IntegrationsPage } from '@/platform/app/(shell)/integrations/_components/fixtures/integrations-page/integrations-page'
import { readScenario } from '@/platform/design-system/navigation'
import { loadIntegrationCenterData, loadIntegrationsData } from '@/platform/fixtures'

interface IntegrationsRouteProps {
  section?: string
  searchParams: PageProps<'/integrations'>['searchParams']
}

export async function IntegrationsRoute({ section, searchParams }: IntegrationsRouteProps) {
  const query = await searchParams
  const scenario = readScenario(query.state)
  const [data, center] = await Promise.all([
    loadIntegrationsData(scenario, query.secrets),
    loadIntegrationCenterData(scenario),
  ])
  if (
    section &&
    !(section === 'secrets' && data?.genericSecrets) &&
    !data?.integrations.some((item) => item.providerId === section)
  )
    notFound()
  return <IntegrationsPage data={data} center={center} section={section} />
}
