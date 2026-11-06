import { IntegrationsRouteFallback } from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-route'
import { PageSurface } from '@/platform/design-system/components/surface/surface'

export default function IntegrationDetailLoading() {
  return (
    <PageSurface>
      <IntegrationsRouteFallback detail />
    </PageSurface>
  )
}
