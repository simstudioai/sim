import { RedesignPageSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import { IntegrationsRouteFallback } from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-route'

export default function IntegrationsLoading() {
  return (
    <RedesignPageSurface>
      <IntegrationsRouteFallback detail={false} />
    </RedesignPageSurface>
  )
}
