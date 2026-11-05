import { notFound } from 'next/navigation'
import { IntegrationsPage } from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-page'
import { readScenario } from '@/platform/design-system/navigation'
import { loadIntegrationsData } from '@/platform/fixtures'

interface IntegrationsRouteProps {
  section?: string
  searchParams: PageProps<'/integrations'>['searchParams']
}

export async function IntegrationsRoute({ section, searchParams }: IntegrationsRouteProps) {
  const query = await searchParams
  const data = await loadIntegrationsData(readScenario(query.state), query.role === 'member')
  if (
    section &&
    section !== 'access' &&
    !data?.providers.some((provider) => provider.id === section)
  )
    notFound()
  return <IntegrationsPage data={data} section={section} />
}
