import { PageSurface } from '@sim/emcn-platform/surface'
import { IntegrationsRouteFallback } from '@/platform/embedded/app/(shell)/integrations/_components/integrations-page/integrations-route'

export default function IntegrationDetailLoading() {
  return (
    <PageSurface>
      <IntegrationsRouteFallback detail />
    </PageSurface>
  )
}
