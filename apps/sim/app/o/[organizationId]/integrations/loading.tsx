import { IntegrationsRouteFallback } from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-route'
import { PageSurface } from '@/platform/design-system/components/surface/surface'

export default function IntegrationsLoading() {
  return (
    <PageSurface>
      <IntegrationsRouteFallback detail={false} />
    </PageSurface>
  )
}
